/**
 * `tcp` - TCP clients and servers.
 *
 *     var socket = defer tcp.connect("example.com", 80);
 *     socket.write("GET / HTTP/1.0\r\n\r\n");
 *     var reply = socket.read();
 *     // the socket is closed when the block ends
 *
 *     var server = defer tcp.listen(8080);
 *     server.accept(func(client) {
 *       client.write("hello\n");
 *       client.close();
 *     });
 *
 * A socket and a server are owned resources: both support `symbol.dispose` (so `defer`
 * releases them), both have an idempotent `close()`, and both work with `spawn` / `wait`
 * because every operation on them is a coroutine rather than a blocking call.
 *
 * Reading parks the task until data arrives, so a server can hold many connections at
 * once on the single interpreter thread without any of them blocking the others.
 *
 * Permissions: connecting and listening both need `--allow-net`; a grant may name hosts
 * and ports (`--allow-net=example.com:443,127.0.0.1:8080`).
 */

import net from "node:net";
import fsp from "node:fs/promises";
import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { type Gen, park, hostAwait } from "../../src/runtime/coroutine";
import { createResource, type ResourceState } from "../kernel/resource";
import { makeSocket } from "../net/socket";

const PKG = { name: "tcp", path: __dirname };

abstract class TCPMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return PKG;
  }

  call(): any {
    throw new Error("Call is not implemented");
  }
}

/** `tcp.connect(host, port, options)` - open a connection. */
class Connect extends TCPMethodBuilder {
  override *call(): Gen<any> {
    const [host, port, options] = this.args;

    this.assertString(host, "host");
    this.assertPort(port, "port");
    this.checkPermission("net", `${host}:${port}`);

    const timeout =
      options && typeof options["timeout"] === "number"
        ? options["timeout"]
        : 30000;

    const socket = new net.Socket();

    try {
      yield park<void>((wake, fail) => {
        const onConnect = () => {
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
          fail(new Error(`connection to ${host}:${port} timed out after ${timeout}ms`));
        };

        const cleanup = () => {
          socket.removeListener("connect", onConnect);
          socket.removeListener("error", onError);
          socket.removeListener("timeout", onTimeout);
          socket.setTimeout(0);
        };

        socket.once("connect", onConnect);
        socket.once("error", onError);

        if (timeout > 0) {
          socket.setTimeout(timeout);
          socket.once("timeout", onTimeout);
        }

        socket.connect(port, host);

        return cleanup;
      });
    } catch (error: any) {
      socket.destroy();

      throw this.throwErrorFormatters(
        new Error(`cannot connect to ${host}:${port}: ${error?.message ?? error}`),
      );
    }

    return makeSocket(socket, `${host}:${port}`, PKG);
  }
}

/** Queued connections of a listening server. */
class ServerState {
  readonly pending: net.Socket[] = [];
  waiter: (() => void) | null = null;
  closed = false;

  constructor(public readonly server: net.Server) {
    server.on("connection", (socket) => {
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
 * `tcp.listen(port, host)` - accept connections.
 *
 * `accept()` returns the next connection (parking until one arrives), and
 * `accept(handler)` runs `handler(socket)` for every connection as its own task, so
 * clients are served concurrently.
 */
/**
 * Everything both servers share: bind, then wrap the result as an owned resource.
 *
 * A TCP server and a unix-socket server differ only in what they bind to, so the waiting,
 * the connection queue, `accept`, the counted slot and the release all live here once.
 */
abstract class ServerBuilder extends TCPMethodBuilder {
  /** Bind the server, parking until the host says it is listening. */
  protected *bind(
    server: net.Server,
    describeTarget: string,
    listen: () => void,
  ): Gen<void> {
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

        listen();
      });
    } catch (error: any) {
      throw this.throwErrorFormatters(
        new Error(
          `cannot listen on ${describeTarget}: ${error?.message ?? error}`,
        ),
      );
    }
  }
}

class Listen extends ServerBuilder {
  override *call(): Gen<any> {
    const [port, host = "127.0.0.1", options] = this.args;

    this.assertPort(port, "port");
    this.assertString(host, "host");
    this.checkPermission("net", `${host}:${port}`);

    const server = net.createServer();
    const backlog =
      options && typeof options["backlog"] === "number"
        ? options["backlog"]
        : 511;

    yield this.bind(server, `${host}:${port}`, () =>
      server.listen(port, host, backlog),
    );

    const state = new ServerState(server);
    const address = server.address();
    const boundPort =
      address && typeof address === "object" ? address.port : port;

    let resourceState: ResourceState;

    const built = createResource({
      name: "Server",
      counts: "connection",
      pkg: PKG,
      close: () => {
        // refuse new connections, then drop the ones still queued
        for (const pending of state.pending) pending.destroy();

        state.pending.length = 0;

        return new Promise<void>((resolve) => server.close(() => resolve()));
      },
      describe: () =>
        `Server { ${host}:${boundPort}, closed: ${resourceState.closed} }`,
      members: {
        port: boundPort,
        host,

        accept: class extends TCPMethodBuilder {
          override *call(): Gen<any> {
            const [handler] = this.args;

            if (resourceState.closed) {
              throw this.throwErrorFormatters(
                new Error("server is already closed"),
              );
            }

            // `accept(handler)`: serve every connection, each as its own task
            if (handler !== undefined && handler !== null) {
              this.assertFunction(handler, "handler");

              server.on("connection", (socket) => {
                // this connection is handled by the callback, not by `accept()`
                const index = state.pending.indexOf(socket);
                if (index !== -1) state.pending.splice(index, 1);

                this.fireCallback(
                  handler,
                  [makeSocket(socket, "accepted", PKG)],
                  "tcp.accept",
                );
              });

              // connections queued before the handler was installed
              const queued = state.pending.splice(0, state.pending.length);

              for (const socket of queued) {
                this.fireCallback(
                  handler,
                  [makeSocket(socket, "accepted", PKG)],
                  "tcp.accept",
                );
              }

              return null;
            }

            // `accept()`: the next connection, parking until one arrives
            yield state.wait();

            const socket = state.pending.shift();

            if (!socket) {
              throw this.throwErrorFormatters(
                new Error("server closed while waiting for a connection"),
              );
            }

            return makeSocket(socket, "accepted", PKG);
          }
        },

        pending: class extends TCPMethodBuilder {
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

/** `tcp.isPortFree(port, host)` - can something bind here right now? */
class IsPortFree extends TCPMethodBuilder {
  override *call(): Gen<any> {
    const [port, host = "127.0.0.1"] = this.args;

    this.assertPort(port, "port");
    this.checkPermission("net", `${host}:${port}`);

    const probe = net.createServer();

    try {
      yield park<void>((wake, fail) => {
        probe.once("error", fail);
        probe.once("listening", () => wake());
        probe.listen(port, host);
      });
    } catch {
      return false;
    }

    // Close the probe and park until it is actually closed. The order matters: waiting
    // for the "close" event before asking it to close meant nothing ever closed it, so a
    // port that really was free parked the task for ever - the one case this is for.
    yield park<void>((wake) => {
      probe.close(() => wake());
    });

    return true;
  }
}

/**
 * `tcp.connectUnix(path, options)` - connect to a unix domain socket.
 *
 * A unix socket is a file rather than a host and port: there is no network involved, and
 * two processes on one machine talk through the filesystem. That is what most database
 * servers and service managers offer locally, and it is faster than a loopback
 * connection because nothing is routed.
 *
 * It is a file, so it needs `--allow-read` for the path rather than `--allow-net`.
 * Everything the returned socket can do is what `tcp.connect` returns.
 */
class ConnectUnix extends TCPMethodBuilder {
  override *call(): Gen<any> {
    const [socketPath, options] = this.args;

    this.assertString(socketPath, "path");
    this.checkPermission("read", socketPath);

    const timeout =
      options && typeof options["timeout"] === "number"
        ? options["timeout"]
        : 30000;

    const socket = new net.Socket();

    try {
      yield park<void>((wake, fail) => {
        const onConnect = () => {
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
          fail(new Error(`connection to ${socketPath} timed out after ${timeout}ms`));
        };

        const cleanup = () => {
          socket.removeListener("connect", onConnect);
          socket.removeListener("error", onError);
          socket.removeListener("timeout", onTimeout);
          socket.setTimeout(0);
        };

        socket.once("connect", onConnect);
        socket.once("error", onError);

        if (timeout > 0) {
          socket.setTimeout(timeout);
          socket.once("timeout", onTimeout);
        }

        socket.connect(socketPath);
      });
    } catch (error: any) {
      socket.destroy();

      throw this.throwErrorFormatters(
        new Error(`cannot connect to ${socketPath}: ${error?.message ?? error}`),
      );
    }

    return makeSocket(socket, socketPath, PKG);
  }
}

/**
 * `tcp.listenUnix(path, options)` - serve on a unix domain socket.
 *
 * The path is created when the server binds. A path left behind by a process that did not
 * shut down cleanly would make binding fail, so `{ force: true }` removes a stale one
 * first; without it an existing path is an error, which is the safer default - it stops
 * one server from quietly taking another's socket.
 *
 * Needs `--allow-write` for the path, since binding creates a file there. Closing the
 * server removes it.
 */
class ListenUnix extends ServerBuilder {
  override *call(): Gen<any> {
    const [socketPath, options] = this.args;

    this.assertString(socketPath, "path");
    this.checkPermission("write", socketPath);

    const backlog =
      options && typeof options["backlog"] === "number"
        ? options["backlog"]
        : 511;

    if (options && options["force"] === true) {
      try {
        yield hostAwait(fsp.unlink(socketPath));
      } catch {
        // nothing was there, which is the usual case
      }
    }

    const server = net.createServer();

    yield this.bind(server, socketPath, () =>
      server.listen(socketPath, backlog),
    );

    const state = new ServerState(server);

    let resourceState: ResourceState;

    const built = createResource({
      name: "UnixServer",
      counts: "connection",
      pkg: PKG,
      close: () => {
        for (const pending of state.pending) pending.destroy();

        state.pending.length = 0;

        return new Promise<void>((resolve) => {
          server.close(() => {
            // the path outlives the server unless it is removed
            fsp.unlink(socketPath).then(
              () => resolve(),
              () => resolve(),
            );
          });
        });
      },
      describe: () =>
        `UnixServer { ${socketPath}, closed: ${resourceState.closed} }`,
      members: {
        path: socketPath,

        accept: class extends TCPMethodBuilder {
          override *call(): Gen<any> {
            const [handler] = this.args;

            if (resourceState.closed) {
              throw this.throwErrorFormatters(
                new Error("server is already closed"),
              );
            }

            if (handler !== undefined && handler !== null) {
              this.assertFunction(handler, "handler");

              server.on("connection", (socket) => {
                const index = state.pending.indexOf(socket);
                if (index !== -1) state.pending.splice(index, 1);

                this.fireCallback(
                  handler,
                  [makeSocket(socket, "accepted", PKG)],
                  "tcp.accept",
                );
              });

              const queued = state.pending.splice(0, state.pending.length);

              for (const socket of queued) {
                this.fireCallback(
                  handler,
                  [makeSocket(socket, "accepted", PKG)],
                  "tcp.accept",
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

            return makeSocket(socket, "accepted", PKG);
          }
        },

        pending: class extends TCPMethodBuilder {
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
  connectUnix: ConnectUnix,
  listen: Listen,
  listenUnix: ListenUnix,
  isPortFree: IsPortFree,
  [Environment.SymbolFormatedText]: "tcp",
};
