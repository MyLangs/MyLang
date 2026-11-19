/**
 * `udp` - datagram sockets.
 *
 *     var sock = defer udp.open(0);          // any free port
 *     sock.send("ping", "127.0.0.1", 9000);
 *     var packet = sock.receive();           // { data, address, port }
 *
 * A socket is an owned resource: `symbol.dispose` closes it, so `defer` releases it at the
 * end of the block, `close()` is idempotent, and every operation is a coroutine, so
 * `spawn` / `wait` work and a socket waiting for a datagram never blocks other tasks.
 *
 * Incoming datagrams are queued as they arrive, because the host delivers them whenever it
 * likes rather than when the program asks; `receive()` takes from that queue or parks for
 * the next one.
 *
 * Permissions: opening a socket and sending both need `--allow-net`, which may name hosts
 * and ports.
 */

import dgram from "node:dgram";
import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { type Gen, park } from "../../src/runtime/coroutine";
import { createResource, type ResourceState } from "../kernel/resource";

const PKG = { name: "udp", path: __dirname };

interface Datagram {
  data: Buffer;
  address: string;
  port: number;
}

abstract class UDPMethodBuilder extends FunctionBuilder {
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

/** Queued datagrams of one socket. */
class SocketState {
  readonly queue: Datagram[] = [];
  failure: any = null;
  closed = false;
  waiter: (() => void) | null = null;

  constructor(socket: dgram.Socket) {
    socket.on("message", (data, info) => {
      this.queue.push({
        data: Buffer.from(data),
        address: info.address,
        port: info.port,
      });

      this.notify();
    });

    socket.on("error", (error) => {
      this.failure = error;
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

  /** Park until a datagram arrives, the socket closes, or it fails. */
  *wait(): Gen<void> {
    if (this.queue.length > 0 || this.closed || this.failure) return;

    yield park<void>((wake) => {
      this.waiter = () => wake();

      return () => {
        this.waiter = null;
      };
    });
  }
}

/**
 * `udp.open(port, options)` - bind a datagram socket.
 *
 * `port` 0 picks a free one; `options.type` is "udp4" (default) or "udp6", and
 * `options.reuseAddr` lets several sockets share the port.
 */
class Open extends UDPMethodBuilder {
  override *call(): Gen<any> {
    const [port = 0, options] = this.args;

    this.assertPort(port, "port");

    const config = options ?? {};
    const type = config["type"] === "udp6" ? "udp6" : "udp4";
    const host =
      typeof config["host"] === "string"
        ? config["host"]
        : type === "udp6"
          ? "::"
          : "0.0.0.0";

    this.checkPermission("net", `${host}:${port}`);

    const socket = dgram.createSocket({
      type,
      reuseAddr: config["reuseAddr"] === true,
    });

    const state = new SocketState(socket);

    try {
      yield park<void>((wake, fail) => {
        const onError = (error: any) => {
          socket.removeListener("listening", onListening);
          fail(error);
        };

        const onListening = () => {
          socket.removeListener("error", onError);
          wake();
        };

        socket.once("error", onError);
        socket.once("listening", onListening);

        socket.bind(port, host);
      });
    } catch (error: any) {
      socket.close();

      throw this.throwErrorFormatters(
        new Error(`cannot bind ${host}:${port}: ${error?.message ?? error}`),
      );
    }

    const bound = socket.address();
    let resourceState: ResourceState;

    const assertUsable = (self: UDPMethodBuilder) => {
      if (resourceState.closed) {
        throw self.throwErrorFormatters(new Error("socket is already closed"));
      }

      if (state.failure) {
        const failure = state.failure;
        state.failure = null;

        throw self.throwErrorFormatters(
          new Error(`socket error: ${failure?.message ?? failure}`),
        );
      }
    };

    const built = createResource({
      name: "Datagram",
      counts: "connection",
      pkg: PKG,
      close: () =>
        new Promise<void>((resolve) => {
          try {
            socket.close(() => resolve());
          } catch {
            resolve();
          }
        }),
      describe: () =>
        `Datagram { ${bound.address}:${bound.port}, closed: ${resourceState.closed}, queued: ${state.queue.length} }`,
      members: {
        port: bound.port,
        address: bound.address,
        family: bound.family,

        /** `send(data, host, port)` - one datagram; returns how many bytes went out. */
        send: class extends UDPMethodBuilder {
          override *call(): Gen<any> {
            const [data, host, targetPort] = this.args;

            assertUsable(this);
            this.assertBinary(data, "data");
            this.assertString(host, "host");
            this.assertPort(targetPort, "port");
            this.checkPermission("net", `${host}:${targetPort}`);

            const payload = this.toBuffer(data);

            yield park<void>((wake, fail) => {
              socket.send(payload, targetPort, host, (error) => {
                if (error) fail(error);
                else wake();
              });
            });

            return payload.length;
          }
        },

        /**
         * `receive()` - the next datagram as `{ data, address, port }`, parking until one
         * arrives. `receive(timeoutMs)` gives up after the timeout and returns `nil`.
         */
        receive: class extends UDPMethodBuilder {
          override *call(): Gen<any> {
            const [timeout] = this.args;

            assertUsable(this);

            if (state.queue.length === 0 && timeout !== undefined && timeout !== null) {
              this.assertInteger(timeout, "timeout");

              const { runtime } =
                require("../../src/runtime/Runtime") as typeof import("../../src/runtime/Runtime");

              let timedOut = false;

              yield park<void>((wake) => {
                const cancel = runtime.scheduler.after(timeout, () => {
                  timedOut = true;
                  state.waiter = null;
                  wake();
                });

                state.waiter = () => {
                  cancel();
                  wake();
                };

                return () => {
                  cancel();
                  state.waiter = null;
                };
              });

              if (timedOut && state.queue.length === 0) return null;
            } else {
              yield state.wait();
            }

            assertUsable(this);

            const packet = state.queue.shift();

            if (!packet) return null;

            return {
              data: this.toBytes(packet.data),
              address: packet.address,
              port: packet.port,
              [Environment.SymbolFormatedText]: `Datagram { ${packet.data.length} bytes from ${packet.address}:${packet.port} }`,
            };
          }
        },

        /** How many datagrams have arrived and are not taken yet. */
        pending: class extends UDPMethodBuilder {
          override call() {
            return state.queue.length;
          }
        },

        /** Allow sending to the broadcast address. */
        setBroadcast: class extends UDPMethodBuilder {
          override call() {
            const [enabled = true] = this.args;

            assertUsable(this);
            socket.setBroadcast(enabled !== false);

            return null;
          }
        },

        joinGroup: class extends UDPMethodBuilder {
          override call() {
            const [group] = this.args;

            assertUsable(this);
            this.assertString(group, "group");
            this.checkPermission("net", group);

            try {
              socket.addMembership(group);
            } catch (error: any) {
              throw this.throwErrorFormatters(error);
            }

            return null;
          }
        },

        leaveGroup: class extends UDPMethodBuilder {
          override call() {
            const [group] = this.args;

            assertUsable(this);
            this.assertString(group, "group");

            try {
              socket.dropMembership(group);
            } catch (error: any) {
              throw this.throwErrorFormatters(error);
            }

            return null;
          }
        },
      },
    });

    resourceState = built.state;

    return built.value;
  }
}

module.exports = {
  open: Open,
  [Environment.SymbolFormatedText]: "udp",
};
