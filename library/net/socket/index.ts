/**
 * A buffered, non-blocking stream socket: the language value behind `tcp.connect`,
 * `tcp.listen`'s accepted clients and `tls.connect`.
 *
 * TCP and TLS differ only in how the connection is established - once it exists, reading,
 * writing, buffering and closing are identical. Keeping that part here means the two
 * libraries cannot drift apart, and a socket from either behaves the same way in a
 * program: same methods, same `symbol.dispose`, same idempotent `close()`.
 *
 * Data arrives whenever the host delivers it, which is rarely when the program asks, so
 * incoming chunks are queued and `read` either takes from the queue or parks for the
 * next chunk. Nothing here blocks the interpreter.
 */

import type net from "node:net";
import { FunctionBuilder } from "../../FunctionBuilder";
import { Environment } from "../../../src/Environment";
import { type StmtType } from "../../../src/ast/StmtType";
import { type Gen, park } from "../../../src/runtime/coroutine";
import {
  createResource,
  type ResourceState,
} from "../../kernel/resource";

/** Which library a socket belongs to, for error attribution. */
interface SocketPkg {
  name: string;
  path: string;
}

/** The builder base a socket's methods extend; each library passes its own package. */
function socketBuilder(pkg: SocketPkg) {
  abstract class SocketMethodBuilder extends FunctionBuilder {
    constructor(args: any[], astArgs: StmtType[], environment: Environment) {
      super(args, astArgs, environment);
    }

    get pkgInfo() {
      return pkg;
    }

    call(): any {
      throw new Error("Call is not implemented");
    }
  }

  return SocketMethodBuilder;
}

/**
 * The buffered state of one connection.
 *
 * Data arrives whenever the host decides to deliver it, which is rarely when the program
 * asks for it, so incoming chunks are queued here and `read` either takes from the queue
 * or parks until the next chunk (or the end of the stream) arrives.
 */
class SocketState {
  readonly chunks: Buffer[] = [];
  ended = false;
  failure: any = null;
  /** Wakes a task parked in `read`. */
  waiter: (() => void) | null = null;

  constructor(public readonly socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.chunks.push(chunk);
      this.notify();
    });

    socket.on("end", () => {
      this.ended = true;
      this.notify();
    });

    socket.on("close", () => {
      this.ended = true;
      this.notify();
    });

    socket.on("error", (error) => {
      this.failure = error;
      this.ended = true;
      this.notify();
    });
  }

  get buffered(): number {
    return this.chunks.reduce((total, chunk) => total + chunk.length, 0);
  }

  private notify(): void {
    const waiter = this.waiter;

    if (!waiter) return;

    this.waiter = null;
    waiter();
  }

  /** Park until there is something to read, the stream ends, or it fails. */
  *wait(): Gen<void> {
    if (this.chunks.length > 0 || this.ended) return;

    yield park<void>((wake) => {
      this.waiter = () => wake();

      return () => {
        this.waiter = null;
      };
    });
  }

  /** Take up to `size` bytes from the queue (everything buffered when `size` is null). */
  take(size: number | null): Buffer {
    if (this.chunks.length === 0) return Buffer.alloc(0);

    if (size === null) {
      const all = Buffer.concat(this.chunks);

      this.chunks.length = 0;

      return all;
    }

    const out: Buffer[] = [];
    let taken = 0;

    while (this.chunks.length > 0 && taken < size) {
      const chunk = this.chunks[0]!;
      const need = size - taken;

      if (chunk.length <= need) {
        out.push(chunk);
        taken += chunk.length;
        this.chunks.shift();
      } else {
        out.push(chunk.subarray(0, need));
        this.chunks[0] = chunk.subarray(need);
        taken = size;
      }
    }

    return Buffer.concat(out);
  }
}

/**
 * Build the language value for a connected socket.
 *
 * `pkg` decides which library errors are attributed to, and `name` what the value calls
 * itself when printed ("Socket" for `tcp`, "TLSSocket" for `tls`).
 */
function makeSocket(
  socket: net.Socket,
  describeAs: string,
  pkg: SocketPkg,
  name = "Socket",
  extraMembers: Record<string, any> = {},
): Record<string | symbol, any> {
  const SocketMethodBuilder = socketBuilder(pkg);
  const state = new SocketState(socket);
  let resourceState: ResourceState;

  const assertUsable = (self: any) => {
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
    name,
    counts: "connection",
    pkg,
    close: () => {
      socket.destroy();
    },
    describe: () =>
      `${name} { ${describeAs}, closed: ${resourceState.closed}, buffered: ${state.buffered} }`,
    members: {
      ...extraMembers,

      remoteAddress: socket.remoteAddress ?? null,
      remotePort: socket.remotePort ?? null,
      localPort: socket.localPort ?? null,

      /**
       * `read()` - the next chunk of data, as `bytes`.
       * `read(n)` - at most `n` bytes.
       * Returns empty `bytes` once the peer has closed its side.
       */
      read: class extends SocketMethodBuilder {
        override *call(): Gen<any> {
          const [size] = this.args;

          assertUsable(this);

          const limit =
            size === undefined || size === null
              ? null
              : this.assertInteger(size, "size");

          yield state.wait();

          assertUsable(this);

          return this.toBytes(state.take(limit));
        }
      },

      /** `readExactly(n)` - exactly `n` bytes, or an error if the peer closes first. */
      readExactly: class extends SocketMethodBuilder {
        override *call(): Gen<any> {
          const [size] = this.args;

          assertUsable(this);
          this.assertInteger(size, "size");

          const parts: Buffer[] = [];
          let have = 0;

          while (have < size) {
            if (state.chunks.length === 0) {
              if (state.ended) {
                throw this.throwErrorFormatters(
                  new Error(
                    `connection closed after ${have} of ${size} byte(s)`,
                  ),
                );
              }

              yield state.wait();
              assertUsable(this);

              continue;
            }

            const chunk = state.take(size - have);

            parts.push(chunk);
            have += chunk.length;
          }

          return this.toBytes(Buffer.concat(parts));
        }
      },

      /** `readAll()` - everything until the peer closes its side. */
      readAll: class extends SocketMethodBuilder {
        override *call(): Gen<any> {
          assertUsable(this);

          const parts: Buffer[] = [];

          for (;;) {
            const chunk = state.take(null);

            if (chunk.length > 0) parts.push(chunk);

            if (state.ended) break;

            yield state.wait();

            if (state.failure) break;
          }

          return this.toBytes(Buffer.concat(parts));
        }
      },

      /** `write(data)` - send bytes or text; parks until the chunk is flushed. */
      write: class extends SocketMethodBuilder {
        override *call(): Gen<any> {
          const [data] = this.args;

          assertUsable(this);
          this.assertBinary(data, "data");

          const payload = this.toBuffer(data);

          yield park<void>((wake, fail) => {
            socket.write(payload, (error) => {
              if (error) fail(error);
              else wake();
            });
          });

          return payload.length;
        }
      },

      /** Stop sending, but keep reading what the peer still sends. */
      end: class extends SocketMethodBuilder {
        override *call(): Gen<any> {
          if (resourceState.closed) return null;

          yield park<void>((wake) => {
            socket.end(() => wake());
          });

          return null;
        }
      },

      /** How many bytes have arrived and are not read yet. */
      buffered: class extends SocketMethodBuilder {
        override call() {
          return state.buffered;
        }
      },

      /** Has the peer closed its side? */
      ended: class extends SocketMethodBuilder {
        override call() {
          return state.ended;
        }
      },

      setTimeout: class extends SocketMethodBuilder {
        override call() {
          const [ms] = this.args;

          this.assertInteger(ms, "ms");
          socket.setTimeout(ms);

          return null;
        }
      },

      setNoDelay: class extends SocketMethodBuilder {
        override call() {
          const [enabled = true] = this.args;

          socket.setNoDelay(enabled !== false);

          return null;
        }
      },

      /**
       * `socket.setKeepAlive(enabled, delay)` - ask the system to probe an idle peer.
       *
       * A peer that disappears without closing - a cable pulled, a machine that lost
       * power - leaves a socket that looks open and never produces anything. Keep-alive
       * probes make the system notice and fail the socket instead of waiting forever.
       * `delay` is how long the socket may be idle, in milliseconds, before the first
       * probe; it defaults to the system's own setting.
       */
      setKeepAlive: class extends SocketMethodBuilder {
        override call() {
          const [enabled = true, delay] = this.args;

          if (delay !== undefined && delay !== null) {
            this.assertInteger(delay, "delay");
          }

          socket.setKeepAlive(
            enabled !== false,
            typeof delay === "number" ? delay : 0,
          );

          return null;
        }
      },

      /** Where this socket is connected: `{host, port}`, or `{path}` for a unix socket. */
      address: class extends SocketMethodBuilder {
        override call() {
          const remote = socket.remoteAddress;

          if (remote === undefined) {
            return { path: String(describeAs) };
          }

          return { host: remote, port: socket.remotePort ?? 0 };
        }
      },
    },
  });

  resourceState = built.state;

  return built.value;
}


export {
  SocketState,
  makeSocket,
  socketBuilder,
  type SocketPkg,
};
