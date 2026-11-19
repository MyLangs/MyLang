/**
 * `workers` - running MyLang code on another thread.
 *
 *     var w = defer workers.start("./heavy.ml", { data: 1000000 });
 *     w.post("go");
 *     coreio.print(w.receive());
 *     coreio.print(w.result());
 *
 * The interpreter is single-threaded by design: `spawn` gives concurrency, not
 * parallelism, so one task that computes for a long time holds the thread. A worker is the
 * answer to exactly that case - the file runs on its own thread, with its own interpreter,
 * and the two sides exchange messages.
 *
 * Inside the worker file, a `worker` object is available without importing anything:
 *
 *     worker.data              what `start` passed in
 *     worker.post(value)       send a value back
 *     worker.receive()         take the next value sent to this worker (parks)
 *
 * A worker is an owned resource: `symbol.dispose` terminates it, so `defer` guarantees the
 * thread is not left running when the block exits. Every operation parks instead of
 * blocking, so waiting for a worker never stops the other tasks.
 *
 * Permissions: starting a worker needs `--allow-worker`, and the worker inherits the
 * parent's whole policy - a sandboxed program cannot widen its permissions by starting a
 * thread.
 */

import path from "node:path";
import fs from "node:fs";
import { Worker } from "node:worker_threads";
import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { type Gen, park } from "../../src/runtime/coroutine";
import { createResource, type ResourceState } from "../kernel/resource";
import { marshal, unmarshal } from "./marshal";
import { security } from "../../src/security";

const PKG = { name: "workers", path: __dirname };

/** The compiled runner, next to this file in `dist`. */
const RUNNER = path.join(__dirname, "runner.js");

abstract class WorkersMethodBuilder extends FunctionBuilder {
  /**
   * Check, then start, one thread running `file`.
   *
   * Both `start` and `pool` come through here, so a pool is held to the same checks as a
   * single worker: the same two permissions, the same up-front reporting of a missing
   * file, and the same policy handed to the thread. Only the counted slot is left to the
   * caller, since a pool takes one per thread.
   */
  protected prepareThread(
    file: unknown,
    options: any,
  ): { worker: Worker; state: WorkerState; full: string } {
    this.assertString(file, "file");
    this.checkPermission("worker", String(file));

    const base = this.environment.get("import").base;
    const named = String(file);
    const full = path.isAbsolute(named) ? named : path.resolve(base, named);

    // the worker reads the file, so the program must be allowed to read it
    this.checkPermission("read", full);

    // Deliberately synchronous: two existence checks before the thread is created, so a
    // missing file is reported at once instead of as an obscure failure inside the worker.
    if (!fs.existsSync(full)) {
      throw this.throwErrorFormatters(
        new Error(`worker file not found: ${full}`),
      );
    }

    if (!fs.existsSync(RUNNER)) {
      throw this.throwErrorFormatters(
        new Error(
          "the worker runner is missing from this build; rebuild the interpreter",
        ),
      );
    }

    const limits = security.limits;

    let worker: Worker;

    try {
      worker = new Worker(RUNNER, {
        workerData: {
          file: full,
          data: options?.["data"] ?? null,
          permissions: exportPolicy(),
          limits: {
            maxMemory: limits.maxMemory,
            timeout: limits.timeout,
          },
        },
      });
    } catch (error: any) {
      throw this.throwErrorFormatters(
        new Error(`cannot start worker: ${error?.message ?? error}`),
      );
    }

    return { worker, state: new WorkerState(worker), full };
  }

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

/** Messages and completion state of one worker. */
class WorkerState {
  readonly inbox: any[] = [];
  finished = false;
  result: any = null;
  failure: any = null;
  waiter: (() => void) | null = null;
  endWaiter: (() => void) | null = null;

  constructor(worker: Worker) {
    worker.on("message", (message: any) => {
      if (message?.kind === "message") {
        this.inbox.push(message.value);
      } else if (message?.kind === "done") {
        this.result = message.value;
        this.finished = true;
      } else if (message?.kind === "error") {
        this.failure = new Error(message.message);
        this.finished = true;
      }

      this.notify();
    });

    worker.on("error", (error) => {
      this.failure = error;
      this.finished = true;
      this.notify();
    });

    worker.on("exit", () => {
      this.finished = true;
      this.notify();
    });
  }

  private notify(): void {
    const waiter = this.waiter;

    if (waiter) {
      this.waiter = null;
      waiter();
    }

    if (!this.finished) return;

    const ender = this.endWaiter;

    if (ender) {
      this.endWaiter = null;
      ender();
    }
  }

  /** Park until something arrives from the worker, or it ends. */
  *wait(): Gen<void> {
    if (this.inbox.length > 0 || this.finished) return;

    yield park<void>((wake) => {
      this.waiter = () => wake();

      return () => {
        this.waiter = null;
      };
    });
  }

  /**
   * Park until the worker's program ends, whatever is still queued.
   *
   * `wait()` returns at once while a message is unread, which is right for `receive()`
   * and wrong for waiting on the end: a loop built on it would spin without ever
   * yielding to the host, so the message saying the worker finished would never be
   * delivered and the wait would never end. This parks on that one event instead.
   */
  *waitForEnd(): Gen<void> {
    if (this.finished) return;

    yield park<void>((wake) => {
      this.endWaiter = () => wake();

      return () => {
        this.endWaiter = null;
      };
    });
  }
}

/**
 * The parent's policy, in the plain shape the worker can rebuild it from.
 *
 * The grants are handed over exactly as they stand, paths and hosts included. Collapsing
 * them to one boolean per kind would be wrong in both directions: a thread started under
 * `--allow-read=./data` would either lose the grant entirely or gain the whole disk.
 */
function exportPolicy(): Record<string, any> {
  return security.permissions.serialize();
}

/**
 * `workers.start(file, options)` - run a MyLang file on another thread.
 *
 * `options.data` is handed to the worker as `worker.data`; it is copied, not shared, so
 * the two sides never see each other's objects.
 */
class Start extends WorkersMethodBuilder {
  override *call(): Gen<any> {
    const [file, options] = this.args;

    const { worker, state, full } = this.prepareThread(file, options);

    let resourceState: ResourceState;

    const built = createResource({
      name: "Worker",
      counts: "worker",
      pkg: PKG,
      close: () => worker.terminate().then(() => undefined),
      describe: () =>
        `Worker { "${path.basename(full)}", running: ${!state.finished}, queued: ${state.inbox.length} }`,
      members: {
        file: full,

        /**
         * `post(value, options)` - send a value to the worker.
         *
         * Plain data and `bytes` both cross. By default the bytes are copied, so the
         * value stays usable here; `post(value, { transfer: true })` hands the memory
         * over instead, which costs nothing for a large buffer but leaves this side's
         * copy empty. Use it when the value is being given away, not shared.
         */
        post: class extends WorkersMethodBuilder {
          override call() {
            const [value, options] = this.args;

            if (resourceState.closed) {
              throw this.throwErrorFormatters(
                new Error("worker is already terminated"),
              );
            }

            const handOver = Boolean(options && options["transfer"] === true);

            try {
              const prepared = marshal(value ?? null, handOver);

              worker.postMessage(
                prepared.value,
                prepared.transfer.length > 0 ? prepared.transfer : undefined,
              );
            } catch (error: any) {
              throw this.throwErrorFormatters(
                new Error(
                  `cannot send this value to a worker (only plain data and bytes cross the boundary): ${error?.message ?? error}`,
                ),
              );
            }

            return null;
          }
        },

        /**
         * `receive()` - the next value the worker posted, parking until there is one.
         * Returns `nil` once the worker has finished and sent nothing more.
         */
        receive: class extends WorkersMethodBuilder {
          override *call(): Gen<any> {
            while (state.inbox.length === 0) {
              if (state.finished) return null;

              yield state.wait();
            }

            return unmarshal(state.inbox.shift(), this.environment);
          }
        },

        /** `result()` - park until the worker's program finishes, then its value. */
        result: class extends WorkersMethodBuilder {
          override *call(): Gen<any> {
            while (!state.finished) {
              yield state.waitForEnd();
            }

            if (state.failure) {
              throw this.throwErrorFormatters(
                new Error(
                  `worker failed: ${state.failure?.message ?? state.failure}`,
                ),
              );
            }

            return unmarshal(state.result, this.environment);
          }
        },

        pending: class extends WorkersMethodBuilder {
          override call() {
            return state.inbox.length;
          }
        },

        running: class extends WorkersMethodBuilder {
          override call() {
            return !state.finished;
          }
        },
      },
    });

    resourceState = built.state;

    return built.value;
  }
}

/** `workers.isWorker()` - is this code running inside a worker thread? */
/**
 * `workers.pool(file, size, options)` - a fixed set of threads sharing a queue of work.
 *
 *     var pool = defer workers.pool("./hash.ml", 4);
 *     var tasks = [];
 *     for (var file in files) { tasks[length(tasks)] = spawn pool.run(file) }
 *     var hashes = wait.all(tasks);
 *
 * `start` gives one thread per call, which is the wrong shape for many small jobs: a
 * thread costs several milliseconds to create and a few megabytes to keep, so starting
 * one per item spends more than the work. A pool creates its threads once and hands each
 * one job at a time, so the cost is paid once however many jobs follow.
 *
 * The worker file is written as a loop over `worker.receive()`: for every value it
 * receives it posts one answer back. `run(value)` sends a value, parks until the answer
 * comes, and returns it - so from the caller's side it reads like an ordinary call, and
 * several of them in `spawn` tasks fill the pool without any of them blocking the others.
 *
 * Needs `--allow-worker`, like `start`, and counts against `--max-workers` once per
 * thread. `close()` - which `defer` calls - ends every thread.
 */
class Pool extends WorkersMethodBuilder {
  override *call(): Gen<any> {
    const [file, size = 2, options] = this.args;

    this.assertString(file, "file");
    this.assertInteger(size, "size");

    if (size < 1) {
      throw this.throwErrorFormatters(
        new Error(`a pool needs at least one thread, received ${size}`),
      );
    }

    /** One member of the pool: its thread, its state, and whether it has a job. */
    interface Member {
      worker: Worker;
      state: WorkerState;
      full: string;
      busy: boolean;
    }

    const members: Member[] = [];
    /** Jobs waiting for a thread, each resuming its own task when one frees up. */
    const queue: Array<() => void> = [];

    // Every thread goes through the same preparation as a single worker, so a pool is not
    // a way around the permission checks or the policy hand-over. Each also takes a
    // counted slot, so `--max-workers` counts threads rather than pools; if the pool
    // cannot have all of them, the threads it did start are ended before reporting, so a
    // refusal leaves nothing running.
    let acquired = 0;

    try {
      for (let i = 0; i < size; i++) {
        security.acquire("worker");
        acquired++;

        members.push({
          ...this.prepareThread(file, options),
          busy: false,
        });
      }
    } catch (error: any) {
      for (const member of members) member.worker.terminate();

      for (let i = 0; i < acquired; i++) security.release("worker");

      throw this.throwErrorFormatters(error);
    }

    let resourceState: ResourceState;

    const built = createResource({
      name: "Pool",
      pkg: PKG,
      close: () => {
        // waiting tasks would park forever once the threads are gone
        const waiting = queue.splice(0, queue.length);

        for (const resume of waiting) resume();

        return Promise.all(
          members.map((member) => member.worker.terminate()),
        ).then(() => {
          // the slots were taken one per thread, so they go back the same way
          for (const _member of members) security.release("worker");
        });
      },
      describe: () => {
        const busy = members.filter((member) => member.busy).length;

        return `Pool { ${path.basename(String(file))}, ${busy}/${members.length} busy, closed: ${resourceState.closed} }`;
      },
      members: {
        size: size,
        file: String(file),

        /**
         * `run(value, options)` - give one job to a free thread and park for its answer.
         *
         * `options` is passed to the thread the same way `post` takes it, so
         * `{ transfer: true }` hands binary over instead of copying it.
         */
        run: class extends WorkersMethodBuilder {
          override *call(): Gen<any> {
            const [value, postOptions] = this.args;

            if (resourceState.closed) {
              throw this.throwErrorFormatters(
                new Error("pool is already closed"),
              );
            }

            // wait for a free thread, keeping the order jobs arrived in
            let mine = members.find((member) => !member.busy);

            while (mine === undefined) {
              yield park<void>((wake) => {
                const resume = () => wake();

                queue.push(resume);

                return () => {
                  const at = queue.indexOf(resume);
                  if (at !== -1) queue.splice(at, 1);
                };
              });

              if (resourceState.closed) {
                throw this.throwErrorFormatters(
                  new Error("pool was closed while this job was waiting"),
                );
              }

              mine = members.find((member) => !member.busy);
            }

            const member = mine;

            member.busy = true;

            try {
              const prepared = marshal(
                value ?? null,
                Boolean(postOptions && postOptions["transfer"] === true),
              );

              member.worker.postMessage(
                prepared.value,
                prepared.transfer.length > 0 ? prepared.transfer : undefined,
              );

              while (member.state.inbox.length === 0) {
                if (member.state.finished) {
                  if (member.state.failure) {
                    throw new Error(
                      `a pool thread failed: ${member.state.failure?.message ?? member.state.failure}`,
                    );
                  }

                  throw new Error(
                    "a pool thread ended before answering; a pool worker should loop " +
                      "over worker.receive() and post one answer for each job",
                  );
                }

                yield member.state.wait();
              }

              return unmarshal(member.state.inbox.shift(), this.environment);
            } catch (error: any) {
              throw this.throwErrorFormatters(error);
            } finally {
              member.busy = false;

              // hand the thread to whoever has been waiting longest
              const next = queue.shift();

              if (next) next();
            }
          }
        },

        /** `busy()` - how many threads are working right now. */
        busy: class extends WorkersMethodBuilder {
          override call() {
            return members.filter((member) => member.busy).length;
          }
        },

        /** `queued()` - how many jobs are waiting for a free thread. */
        queued: class extends WorkersMethodBuilder {
          override call() {
            return queue.length;
          }
        },
      },
    });

    resourceState = built.state;

    return built.value;
  }
}

class IsWorker extends WorkersMethodBuilder {
  override call() {
    const { isMainThread } =
      require("node:worker_threads") as typeof import("node:worker_threads");

    return !isMainThread;
  }
}

/** `workers.cpus()` - how many threads the machine can usefully run. Needs `--allow-sys`. */
class Cpus extends WorkersMethodBuilder {
  override call() {
    this.checkPermission("sys", "cpus");

    const os = require("node:os") as typeof import("node:os");

    return os.cpus().length;
  }
}

module.exports = {
  start: Start,
  pool: Pool,
  isWorker: IsWorker,
  cpus: Cpus,
};
