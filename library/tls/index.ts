/**
 * `tls` - encrypted TCP.
 *
 *     var socket = defer tls.connect("example.com", 443);
 *     socket.write("GET / HTTP/1.0\r\nHost: example.com\r\n\r\n");
 *     coreio.print(socket.readAll().toString());
 *
 * A TLS socket is a `tcp` socket that happens to be encrypted: reading, writing,
 * buffering, `close()` and `symbol.dispose` are literally the same code (see
 * `library/net/socket`), so anything written against `tcp` works here unchanged. Only
 * establishing the connection differs, and that is what this library adds.
 *
 * Certificates are verified by default. Turning that off (`rejectUnauthorized: false`)
 * makes the encryption decorative - anyone in the middle can read and change everything -
 * so it exists for a self-signed certificate during development and nothing else.
 *
 * Permissions: `connect` and `listen` need `--allow-net`, exactly as in `tcp`; reading a
 * certificate or key from a file needs `--allow-read`.
 */

import tls from "node:tls";
import fsp from "node:fs/promises";
import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { type Gen, park, hostAwait } from "../../src/runtime/coroutine";
import { createResource, type ResourceState } from "../kernel/resource";
import { makeSocket } from "../net/socket";

const PKG = { name: "tls", path: __dirname };

abstract class TLSMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return PKG;
  }

  /**
   * Turn the program's options into the host's.
   *
   * `cert`, `key` and `ca` may be given inline (text or `bytes`) or as a file path. A
   * path is read here, so it goes through `--allow-read` like any other read.
   */
  protected *materialOptions(options: any): Gen<Record<string, any>> {
    if (options === undefined || options === null) return {};

    this.assertObject(options, "options");

    const mapped: Record<string, any> = {};

    for (const field of ["cert", "key", "ca", "pfx"]) {
      const value = options[field];

      if (value === undefined || value === null) continue;

      mapped[field] = yield this.material(value, field);
    }

    if (typeof options["passphrase"] === "string") {
      mapped["passphrase"] = options["passphrase"];
    }

    if (typeof options["servername"] === "string") {
      mapped["servername"] = options["servername"];
    }

    if (Array.isArray(options["alpn"])) {
      mapped["ALPNProtocols"] = options["alpn"].map((entry: any) =>
        this.assertString(entry, "alpn entry"),
      );
    }

    if (typeof options["minVersion"] === "string") {
      mapped["minVersion"] = options["minVersion"];
    }

    if (typeof options["requestCert"] === "boolean") {
      mapped["requestCert"] = options["requestCert"];
    }

    // Verification is on unless the program explicitly turns it off.
    mapped["rejectUnauthorized"] = options["rejectUnauthorized"] !== false;

    return mapped;
  }

  /** One certificate-ish value: inline material, or the contents of a file. */
  protected *material(value: any, field: string): Gen<Buffer | string> {
    // a path, named as such, is read from disk
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const path = (value as Record<string, any>)["file"];

      if (typeof path === "string") {
        this.checkPermission("read", path);

        try {
          return yield hostAwait(fsp.readFile(path));
        } catch (error: any) {
          throw this.throwErrorFormatters(
            new Error(
              `cannot read ${field} from "${path}": ${error?.message ?? error}`,
            ),
          );
        }
      }
    }

    this.assertBinary(value, field);

    return this.toBuffer(value);
  }

  /** The peer's certificate as a plain value, or `nil` when there is none. */
  protected certificateOf(socket: tls.TLSSocket): any {
    const peer = socket.getPeerCertificate();

    if (!peer || Object.keys(peer).length === 0) return null;

    return {
      subject: peer.subject ? { ...peer.subject } : null,
      issuer: peer.issuer ? { ...peer.issuer } : null,
      validFrom: peer.valid_from ?? null,
      validTo: peer.valid_to ?? null,
      fingerprint: peer.fingerprint ?? null,
      fingerprint256: peer.fingerprint256 ?? null,
      serialNumber: peer.serialNumber ?? null,
      [Environment.SymbolFormatedText]: `Certificate { ${peer.subject?.CN ?? "unknown"}, until ${peer.valid_to ?? "?"} }`,
    };
  }

  call(): any {
    throw new Error("Call is not implemented");
  }
}

/** The members a TLS socket has on top of an ordinary one. */
function tlsMembers(socket: tls.TLSSocket, builder: TLSMethodBuilder) {
  return {
    /** The protocol that was negotiated, e.g. "TLSv1.3". */
    protocol: class extends TLSMethodBuilder {
      override call() {
        return socket.getProtocol() ?? null;
      }
    },

    /** The cipher suite in use. */
    cipher: class extends TLSMethodBuilder {
      override call() {
        const cipher = socket.getCipher();

        return cipher ? { name: cipher.name, version: cipher.version } : null;
      }
    },

    /** The ALPN protocol the peer agreed on, or `nil`. */
    alpn: class extends TLSMethodBuilder {
      override call() {
        return (socket as any).alpnProtocol || null;
      }
    },

    /** The peer's certificate. */
    peerCertificate: class extends TLSMethodBuilder {
      override call() {
        return builder["certificateOf"](socket);
      }
    },

    /** Did the peer present a certificate this program accepts? */
    authorized: class extends TLSMethodBuilder {
      override call() {
        return socket.authorized === true;
      }
    },
  };
}

/** `tls.connect(host, port, options)` - open an encrypted connection. */
class Connect extends TLSMethodBuilder {
  override *call(): Gen<any> {
    const [host, port, options] = this.args;

    this.assertString(host, "host");
    this.assertPort(port, "port");
    this.checkPermission("net", `${host}:${port}`);

    const material = yield this.materialOptions(options);
    const timeout =
      options && typeof options["timeout"] === "number"
        ? options["timeout"]
        : 30000;

    const socket = tls.connect({
      host,
      port,
      servername: material["servername"] ?? host,
      ...material,
    });

    try {
      yield park<void>((wake, fail) => {
        const onReady = () => {
          cleanup();
          wake();
        };

        const onError = (error: any) => {
          cleanup();
          fail(error);
        };

        const onTimeout = () => {
          cleanup();
          socket.destroy();
          fail(
            new Error(`TLS handshake with ${host}:${port} timed out after ${timeout}ms`),
          );
        };

        const cleanup = () => {
          socket.removeListener("secureConnect", onReady);
          socket.removeListener("error", onError);
          socket.removeListener("timeout", onTimeout);
          socket.setTimeout(0);
        };

        socket.once("secureConnect", onReady);
        socket.once("error", onError);

        if (timeout > 0) {
          socket.setTimeout(timeout);
          socket.once("timeout", onTimeout);
        }

        return cleanup;
      });
    } catch (error: any) {
      socket.destroy();

      throw this.throwErrorFormatters(
        new Error(
          `cannot connect to ${host}:${port} over TLS: ${error?.message ?? error}`,
        ),
      );
    }

    // the certificate was already verified by the handshake unless that was turned off
    if (material["rejectUnauthorized"] !== false && !socket.authorized) {
      const reason = socket.authorizationError ?? "the certificate was rejected";

      socket.destroy();

      throw this.throwErrorFormatters(
        new Error(`${host}:${port} presented a certificate that was not accepted: ${reason}`),
      );
    }

    return makeSocket(
      socket,
      `${host}:${port}`,
      PKG,
      "TLSSocket",
      tlsMembers(socket, this),
    );
  }
}

/** Connections waiting to be accepted by a TLS server. */
class ServerState {
  readonly pending: tls.TLSSocket[] = [];
  waiter: (() => void) | null = null;
  closed = false;

  constructor(server: tls.Server) {
    server.on("secureConnection", (socket) => {
      this.pending.push(socket);
      this.notify();
    });

    server.on("close", () => {
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
 * `tls.listen(port, host, options)` - accept encrypted connections.
 *
 * `options.cert` and `options.key` are required: a TLS server has nothing to present
 * without them. Both may be inline material or `{ file: "path" }`.
 */
class Listen extends TLSMethodBuilder {
  override *call(): Gen<any> {
    const [port, host = "127.0.0.1", options] = this.args;

    this.assertPort(port, "port");
    this.assertString(host, "host");
    this.checkPermission("net", `${host}:${port}`);

    const material = yield this.materialOptions(options);

    if (!material["cert"] || !material["key"]) {
      throw this.throwErrorFormatters(
        new Error(
          'a TLS server needs options.cert and options.key (inline, or { file: "path" })',
        ),
      );
    }

    const server = tls.createServer(material);

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

    const state = new ServerState(server);
    const address = server.address();
    const boundPort =
      address && typeof address === "object" ? address.port : port;

    let resourceState: ResourceState;

    const built = createResource({
      name: "TLSServer",
      counts: "connection",
      pkg: PKG,
      close: () => {
        for (const pending of state.pending) pending.destroy();

        state.pending.length = 0;

        return new Promise<void>((resolve) => server.close(() => resolve()));
      },
      describe: () =>
        `TLSServer { ${host}:${boundPort}, closed: ${resourceState.closed} }`,
      members: {
        port: boundPort,
        host,

        accept: class extends TLSMethodBuilder {
          override *call(): Gen<any> {
            const [handler] = this.args;

            if (resourceState.closed) {
              throw this.throwErrorFormatters(
                new Error("server is already closed"),
              );
            }

            if (handler !== undefined && handler !== null) {
              this.assertFunction(handler, "handler");

              server.on("secureConnection", (socket) => {
                const index = state.pending.indexOf(socket);
                if (index !== -1) state.pending.splice(index, 1);

                this.fireCallback(
                  handler,
                  [
                    makeSocket(
                      socket,
                      "accepted",
                      PKG,
                      "TLSSocket",
                      tlsMembers(socket, this),
                    ),
                  ],
                  "tls.accept",
                );
              });

              const queued = state.pending.splice(0, state.pending.length);

              for (const socket of queued) {
                this.fireCallback(
                  handler,
                  [
                    makeSocket(
                      socket,
                      "accepted",
                      PKG,
                      "TLSSocket",
                      tlsMembers(socket, this),
                    ),
                  ],
                  "tls.accept",
                );
              }

              return null;
            }

            yield state.wait();

            const socket = state.pending.shift();

            if (!socket) {
              throw this.throwErrorFormatters(
                new Error("server closed while waiting for a connection"),
              );
            }

            return makeSocket(
              socket,
              "accepted",
              PKG,
              "TLSSocket",
              tlsMembers(socket, this),
            );
          }
        },

        pending: class extends TLSMethodBuilder {
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

/** `tls.rootCertificates()` - the certificate authorities the host trusts. */
class RootCertificates extends TLSMethodBuilder {
  override call() {
    this.checkPermission("sys", "root-certificates");

    return [...tls.rootCertificates];
  }
}

module.exports = {
  connect: Connect,
  listen: Listen,
  rootCertificates: RootCertificates,
};
