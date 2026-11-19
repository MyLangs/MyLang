/**
 * `ws` - WebSocket clients and servers.
 *
 *     var socket = defer ws.connect("ws://127.0.0.1:8080/chat");
 *     socket.send("hello");
 *     var message = socket.receive();        // { kind, data, text }
 *
 *     var server = defer ws.listen(8080);
 *     server.accept(func(peer) {
 *       peer.send("welcome");
 *     });
 *
 * A connection is an owned resource: `symbol.dispose` sends a close frame and releases the
 * underlying socket, so `defer` cleans it up however the block ends. Receiving parks the
 * task rather than blocking, so one program can hold many connections at once.
 *
 * Ping/pong is answered automatically, as the protocol requires, and a close frame from
 * the peer ends `receive()` instead of hanging.
 *
 * Permissions: both `connect` and `listen` need `--allow-net`, with the same host and port
 * grammar as `tcp`.
 */

import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import fsp from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { type Gen, park, hostAwait } from "../../src/runtime/coroutine";
import { createResource, type ResourceState } from "../kernel/resource";
import {
  encodeFrame,
  decodeFrame,
  encodeClose,
  decodeClose,
  type Frame,
  type FrameKind,
} from "./frames";

const PKG = { name: "ws", path: __dirname };

/** The fixed string RFC 6455 uses to prove a handshake was understood. */
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKey(key: string): string {
  return createHash("sha1").update(key + GUID).digest("base64");
}

interface Message {
  kind: "text" | "binary";
  payload: Buffer;
}

abstract class WSMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return PKG;
  }

  /**
   * The TLS options for a `wss://` connection or server.
   *
   * `cert`, `key` and `ca` may be inline material or `{ file: "path" }`; a path is read
   * here, so it goes through `--allow-read`. Verification is on unless the program turns
   * it off, which it should only do for a self-signed certificate in development.
   */
  protected *tlsMaterial(options: any, host: string): Gen<Record<string, any>> {
    const mapped: Record<string, any> = { servername: host };

    if (options === undefined || options === null) {
      mapped["rejectUnauthorized"] = true;
      return mapped;
    }

    this.assertObject(options, "options");

    for (const field of ["cert", "key", "ca"]) {
      const value = options[field];

      if (value === undefined || value === null) continue;

      if (
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof value["file"] === "string"
      ) {
        const path = value["file"];

        this.checkPermission("read", path);

        try {
          mapped[field] = yield hostAwait(fsp.readFile(path));
        } catch (error: any) {
          throw this.throwErrorFormatters(
            new Error(
              `cannot read ${field} from "${path}": ${error?.message ?? error}`,
            ),
          );
        }

        continue;
      }

      this.assertBinary(value, field);
      mapped[field] = this.toBuffer(value);
    }

    if (typeof options["servername"] === "string") {
      mapped["servername"] = options["servername"];
    }

    mapped["rejectUnauthorized"] = options["rejectUnauthorized"] !== false;

    return mapped;
  }

  call(): any {
    throw new Error("Call is not implemented");
  }
}

/**
 * One WebSocket connection: frame reassembly, control-frame handling, and the queue a
 * parked `receive()` waits on.
 */
class Connection {
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentKind: "text" | "binary" | null = null;

  readonly messages: Message[] = [];
  closed = false;
  closeCode: number | null = null;
  closeReason = "";
  failure: any = null;
  waiter: (() => void) | null = null;

  constructor(
    readonly socket: net.Socket,
    /** Clients mask what they send, servers do not. */
    readonly maskOutgoing: boolean,
  ) {
    socket.on("data", (chunk: Buffer) => this.feed(chunk));

    socket.on("error", (error) => {
      this.failure = error;
      this.closed = true;
      this.notify();
    });

    socket.on("close", () => {
      this.closed = true;
      this.notify();
    });
  }

  private notify(): void {
    const waiter = this.waiter;

    if (!waiter) return;

    this.waiter = null;
    waiter();
  }

  /** Feed incoming bytes through the frame decoder. */
  private feed(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    try {
      for (;;) {
        const decoded = decodeFrame(this.buffer);

        if (!decoded) break;

        this.buffer = this.buffer.subarray(decoded.consumed);

        this.handle(decoded.frame);
      }
    } catch (error) {
      this.failure = error;
      this.closed = true;
    }

    this.notify();
  }

  private handle(frame: Frame): void {
    switch (frame.kind) {
      case "ping":
        // answering a ping is mandatory, and the program should not have to do it
        this.sendRaw("pong", frame.payload);
        return;

      case "pong":
        return;

      case "close": {
        const { code, reason } = decodeClose(frame.payload);

        this.closeCode = code;
        this.closeReason = reason;
        this.closed = true;

        // echo the close frame, then let the socket go
        try {
          this.sendRaw("close", encodeClose(code === 1005 ? 1000 : code, ""));
          this.socket.end();
        } catch {
          // the peer may already be gone
        }

        return;
      }

      case "text":
      case "binary": {
        if (frame.final) {
          this.messages.push({ kind: frame.kind, payload: frame.payload });
          return;
        }

        this.fragmentKind = frame.kind;
        this.fragments = [frame.payload];

        return;
      }

      case "continuation": {
        if (this.fragmentKind === null) return;

        this.fragments.push(frame.payload);

        if (frame.final) {
          this.messages.push({
            kind: this.fragmentKind,
            payload: Buffer.concat(this.fragments),
          });

          this.fragments = [];
          this.fragmentKind = null;
        }

        return;
      }
    }
  }

  /** Write a frame without waiting for it to flush (used for control frames). */
  sendRaw(kind: FrameKind, payload: Buffer): void {
    if (this.socket.destroyed) return;

    this.socket.write(encodeFrame(kind, payload, this.maskOutgoing));
  }

  /** Park until a message arrives, the peer closes, or the connection fails. */
  *wait(): Gen<void> {
    if (this.messages.length > 0 || this.closed || this.failure) return;

    yield park<void>((wake) => {
      this.waiter = () => wake();

      return () => {
        this.waiter = null;
      };
    });
  }
}

/** Build the language value for a connection. */
function makeConnection(
  connection: Connection,
  describeAs: string,
): Record<string | symbol, any> {
  let resourceState: ResourceState;

  const assertUsable = (self: WSMethodBuilder) => {
    if (resourceState.closed) {
      throw self.throwErrorFormatters(
        new Error("WebSocket connection is already closed"),
      );
    }

    if (connection.failure) {
      const failure = connection.failure;
      connection.failure = null;

      throw self.throwErrorFormatters(
        new Error(`WebSocket error: ${failure?.message ?? failure}`),
      );
    }
  };

  const built = createResource({
    name: "WebSocket",
    counts: "connection",
    pkg: PKG,
    close: () => {
      try {
        if (!connection.closed) {
          connection.sendRaw("close", encodeClose(1000, ""));
        }
      } catch {
        // closing a connection that is already gone is not an error
      }

      connection.socket.destroy();
    },
    describe: () =>
      `WebSocket { ${describeAs}, closed: ${resourceState.closed}, queued: ${connection.messages.length} }`,
    members: {
      /** `send(data)` - text goes out as a text frame, bytes as a binary frame. */
      send: class extends WSMethodBuilder {
        override *call(): Gen<any> {
          const [data] = this.args;

          assertUsable(this);
          this.assertBinary(data, "data");

          const isText = typeof data === "string";
          const payload = this.toBuffer(data);

          yield park<void>((wake, fail) => {
            connection.socket.write(
              encodeFrame(
                isText ? "text" : "binary",
                payload,
                connection.maskOutgoing,
              ),
              (error) => {
                if (error) fail(error);
                else wake();
              },
            );
          });

          return payload.length;
        }
      },

      /**
       * `receive()` - the next message as `{ kind, data, text }`, parking until one
       * arrives. Returns `nil` once the peer has closed the connection.
       */
      receive: class extends WSMethodBuilder {
        override *call(): Gen<any> {
          assertUsable(this);

          while (connection.messages.length === 0) {
            if (connection.closed) return null;

            yield connection.wait();

            assertUsable(this);
          }

          const message = connection.messages.shift()!;

          return {
            kind: message.kind,
            data: this.toBytes(message.payload),
            text:
              message.kind === "text" ? message.payload.toString("utf8") : null,
            [Environment.SymbolFormatedText]: `Message { ${message.kind}, ${message.payload.length} bytes }`,
          };
        }
      },

      /** `ping(data)` - the peer answers with a pong, which this library absorbs. */
      ping: class extends WSMethodBuilder {
        override call() {
          const [data = ""] = this.args;

          assertUsable(this);
          connection.sendRaw("ping", this.toBuffer(data));

          return null;
        }
      },

      /** How many messages have arrived and are not taken yet. */
      pending: class extends WSMethodBuilder {
        override call() {
          return connection.messages.length;
        }
      },

      /** Has the peer closed the connection? */
      ended: class extends WSMethodBuilder {
        override call() {
          return connection.closed;
        }
      },

      /** The close code the peer sent, or `nil`. */
      closeCode: class extends WSMethodBuilder {
        override call() {
          return connection.closeCode;
        }
      },

      closeReason: class extends WSMethodBuilder {
        override call() {
          return connection.closeReason;
        }
      },
    },
  });

  resourceState = built.state;

  return built.value;
}

/** `ws.connect(url, options)` - open a client connection. */
class Connect extends WSMethodBuilder {
  override *call(): Gen<any> {
    const [url, options] = this.args;

    this.assertString(url, "url");

    const parsed = this.parseUrl(url);

    this.checkPermission("net", `${parsed.host}:${parsed.port}`);

    const key = randomBytes(16).toString("base64");
    const headers = (options ?? {})["headers"] ?? {};
    const timeout =
      options && typeof options["timeout"] === "number"
        ? options["timeout"]
        : 30000;

    // `wss://` is the same protocol over TLS: the transport differs, the framing and
    // everything after the handshake does not.
    const tlsConfig: Record<string, any> = parsed.secure
      ? yield this.tlsMaterial(options, parsed.host)
      : {};

    const sniHost =
    typeof tlsConfig["servername"] === "string"
      ? tlsConfig["servername"]
      : parsed.host;

    const socket: net.Socket = parsed.secure
      ? tls.connect({
        ...tlsConfig,
        host: parsed.host,
        port: parsed.port,
        servername: net.isIP(sniHost) ? "" : sniHost,
      })
    : new net.Socket();

    const established = parsed.secure ? "secureConnect" : "connect";

    try {
      yield park<void>((wake, fail) => {
        const onError = (error: any) => {
          cleanup();
          fail(error);
        };

        const onTimeout = () => {
          cleanup();
          socket.destroy();
          fail(new Error(`handshake with ${parsed.host}:${parsed.port} timed out`));
        };

        const onReady = () => {
          cleanup();
          wake();
        };

        const cleanup = () => {
          socket.removeListener("error", onError);
          socket.removeListener("timeout", onTimeout);
          socket.removeListener(established, onReady);
          socket.setTimeout(0);
        };

        socket.once("error", onError);
        socket.once(established, onReady);

        if (timeout > 0) {
          socket.setTimeout(timeout);
          socket.once("timeout", onTimeout);
        }

        if (!parsed.secure) socket.connect(parsed.port, parsed.host);

        return cleanup;
      });
    } catch (error: any) {
      socket.destroy();

      throw this.throwErrorFormatters(
        new Error(
          `cannot connect to ${parsed.host}:${parsed.port}: ${error?.message ?? error}`,
        ),
      );
    }

    if (
      parsed.secure &&
      tlsConfig["rejectUnauthorized"] !== false &&
      !(socket as tls.TLSSocket).authorized
    ) {
      const reason =
        (socket as tls.TLSSocket).authorizationError ??
        "the certificate was rejected";

      socket.destroy();

      throw this.throwErrorFormatters(
        new Error(`${parsed.host}:${parsed.port} presented a certificate that was not accepted: ${reason}`),
      );
    }

    const request =
      `GET ${parsed.path} HTTP/1.1\r\n` +
      `Host: ${parsed.host}:${parsed.port}\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\n` +
      `Sec-WebSocket-Version: 13\r\n` +
      Object.keys(headers)
        .map((name) => `${name}: ${headers[name]}\r\n`)
        .join("") +
      `\r\n`;

    socket.write(request);

    // read until the end of the response headers, keeping any frame bytes that follow
    let received = Buffer.alloc(0);

    try {
      yield park<void>((wake, fail) => {
        const onData = (chunk: Buffer) => {
          received = Buffer.concat([received, chunk]);

          const end = received.indexOf("\r\n\r\n");

          if (end === -1) return;

          cleanup();
          wake();
        };

        const onError = (error: any) => {
          cleanup();
          fail(error);
        };

        const onClose = () => {
          cleanup();
          fail(new Error("the server closed the connection during the handshake"));
        };

        const cleanup = () => {
          socket.removeListener("data", onData);
          socket.removeListener("error", onError);
          socket.removeListener("close", onClose);
        };

        socket.on("data", onData);
        socket.once("error", onError);
        socket.once("close", onClose);

        return cleanup;
      });
    } catch (error: any) {
      socket.destroy();

      throw this.throwErrorFormatters(
        new Error(`WebSocket handshake failed: ${error?.message ?? error}`),
      );
    }

    const headerEnd = received.indexOf("\r\n\r\n");
    const responseText = received.toString("utf8", 0, headerEnd);
    const rest = received.subarray(headerEnd + 4);

    if (!/^HTTP\/1\.1 101/.test(responseText)) {
      socket.destroy();

      throw this.throwErrorFormatters(
        new Error(
          `WebSocket handshake refused: ${responseText.split("\r\n")[0] ?? "no status line"}`,
        ),
      );
    }

    const accepted = /sec-websocket-accept:\s*(\S+)/i.exec(responseText);

    if (!accepted || accepted[1] !== acceptKey(key)) {
      socket.destroy();

      throw this.throwErrorFormatters(
        new Error("WebSocket handshake failed: the server's accept key is wrong"),
      );
    }

    const connection = new Connection(socket, true);

    // frames that arrived in the same packet as the handshake response
    if (rest.length > 0) socket.emit("data", rest);

    return makeConnection(connection, `${parsed.host}:${parsed.port}`);
  }

  /** `ws://host:port/path` -> its parts, with the usual default ports. */
  protected parseUrl(url: string): {
    host: string;
    port: number;
    path: string;
    secure: boolean;
  } {
    const match = /^(ws|wss):\/\/([^/:?#]+)(?::(\d+))?([^?#]*)(\?[^#]*)?/.exec(url);

    if (!match) {
      throw this.throwErrorFormatters(
        new Error(`not a WebSocket URL: "${url}" (expected ws://host[:port][/path])`),
      );
    }

    const secure = match[1] === "wss";

    return {
      host: match[2]!,
      port: match[3] ? Number(match[3]) : secure ? 443 : 80,
      path: (match[4] || "/") + (match[5] || ""),
      secure,
    };
  }
}

/** Connections waiting to be accepted. */
class ServerState {
  readonly pending: Array<{ connection: Connection; path: string }> = [];
  waiter: (() => void) | null = null;
  closed = false;

  notify(): void {
    const waiter = this.waiter;

    if (!waiter) return;

    this.waiter = null;
    waiter();
  }

  *wait(): Gen<void> {
    if (this.pending.length > 0 || this.closed) return;

    yield park<void>((wake) => {
      this.waiter = () => wake();

      return () => {
        this.waiter = null;
      };
    });
  }
}

/**
 * `ws.listen(port, host, options)` - accept WebSocket connections.
 *
 * `accept()` returns the next connection; `accept(handler)` runs `handler(peer)` for each
 * one as its own task, so several clients are served at the same time.
 *
 * Giving `options.cert` and `options.key` makes it a `wss://` server: the same protocol
 * over TLS, so clients connect with `wss://` and nothing else about it changes.
 */
class Listen extends WSMethodBuilder {
  override *call(): Gen<any> {
    const [port, host = "127.0.0.1", options] = this.args;

    this.assertPort(port, "port");
    this.assertString(host, "host");
    this.checkPermission("net", `${host}:${port}`);

    const secure =
      options !== undefined &&
      options !== null &&
      (options["cert"] !== undefined || options["key"] !== undefined);

    const material = secure ? yield this.tlsMaterial(options, host) : {};

    if (secure && (!material["cert"] || !material["key"])) {
      throw this.throwErrorFormatters(
        new Error(
          'a wss:// server needs both options.cert and options.key (inline, or { file: "path" })',
        ),
      );
    }

    const server: http.Server = secure
      ? https.createServer({
          cert: material["cert"],
          key: material["key"],
          ...(material["ca"] ? { ca: material["ca"] } : {}),
        })
      : http.createServer();

    const state = new ServerState();

    // a plain HTTP request to a WebSocket port is answered, not left hanging
    server.on("request", (_request, response) => {
      response.writeHead(426, { "Content-Type": "text/plain" });
      response.end("This endpoint speaks WebSocket only\n");
    });

    server.on("upgrade", (request, socket, head) => {
      const key = request.headers["sec-websocket-key"];

      if (
        String(request.headers["upgrade"]).toLowerCase() !== "websocket" ||
        typeof key !== "string"
      ) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }

      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
      );

      const connection = new Connection(socket as net.Socket, false);

      if (head && head.length > 0) socket.emit("data", head);

      state.pending.push({ connection, path: request.url ?? "/" });
      state.notify();
    });

    try {
      yield park<void>((wake, fail) => {
        const onError = (error: any) => {
          server.removeListener("listening", onListening);
          fail(error);
        };

        const onListening = () => {
          server.removeListener("error", onError);
          wake();
        };

        server.once("error", onError);
        server.once("listening", onListening);

        server.listen(port, host);
      });
    } catch (error: any) {
      throw this.throwErrorFormatters(
        new Error(`cannot listen on ${host}:${port}: ${error?.message ?? error}`),
      );
    }

    const address = server.address();
    const boundPort =
      address && typeof address === "object" ? address.port : port;

    let resourceState: ResourceState;
    let handlerInstalled = false;

    const built = createResource({
      name: "WebSocketServer",
      counts: "connection",
      pkg: PKG,
      close: () => {
        state.closed = true;

        for (const entry of state.pending) entry.connection.socket.destroy();

        state.pending.length = 0;
        state.notify();

        return new Promise<void>((resolve) => server.close(() => resolve()));
      },
      describe: () =>
        `WebSocketServer { ${secure ? "wss" : "ws"}://${host}:${boundPort}, closed: ${resourceState.closed} }`,
      members: {
        port: boundPort,
        host,
        secure,

        accept: class extends WSMethodBuilder {
          override *call(): Gen<any> {
            const [handler] = this.args;

            if (resourceState.closed) {
              throw this.throwErrorFormatters(
                new Error("server is already closed"),
              );
            }

            if (handler !== undefined && handler !== null) {
              this.assertFunction(handler, "handler");

              const serve = (entry: { connection: Connection; path: string }) => {
                this.fireCallback(
                  handler,
                  [makeConnection(entry.connection, `path ${entry.path}`)],
                  "ws.accept",
                );
              };

              if (!handlerInstalled) {
                handlerInstalled = true;

                server.on("upgrade", () => {
                  // the queue is filled by the upgrade handler above; drain it next tick
                  setImmediate(() => {
                    while (state.pending.length > 0) serve(state.pending.shift()!);
                  });
                });
              }

              while (state.pending.length > 0) serve(state.pending.shift()!);

              return null;
            }

            yield state.wait();

            const entry = state.pending.shift();

            if (!entry) {
              throw this.throwErrorFormatters(
                new Error("server closed while waiting for a connection"),
              );
            }

            return makeConnection(entry.connection, `path ${entry.path}`);
          }
        },

        pending: class extends WSMethodBuilder {
          override call() {
            return state.pending.length;
          }
        },
      },
    });

    resourceState = built.state;

    return built.value;
  }
}

module.exports = {
  connect: Connect,
  listen: Listen,
  [Environment.SymbolFormatedText]: "ws",
};
