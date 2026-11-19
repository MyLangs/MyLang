import { FunctionBuilder, FunctionBuilderCodeError } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { isTypeArgs } from "../utils/utils";
import { runtime } from "../../src/runtime/Runtime";
import { TaskPool } from "../../src/runtime/TaskPool";
import { convertSpawnState } from "../../src/runtime/SpawnState";
import { type Gen, callNative } from "../../src/runtime/coroutine";

abstract class RuntimeMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return {
      name: "runtime",
      path: __dirname,
    };
  }

  protected validateFunction(func: any, argName: string = "callback"): void {
    if (isTypeArgs(func) !== "function") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "function",
        received: isTypeArgs(func),
      });
    }
  }

  protected validateNumber(value: any, argName: string): void {
    if (isTypeArgs(value) !== "int") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "int",
        received: isTypeArgs(value),
      });
    }
  }

  protected override *executeCallback(callbackFunc: any, args: any[]): Gen<any> {
    if (this.isBuildModuleFunction(callbackFunc)) {
      return yield callNative(new callbackFunc(args, [], this.environment));
    }
    return yield callbackFunc.call(args.map((v: any) => ({ value: v })));
  }

  call() {
    throw new Error("Call is not implemented");
  }
}

abstract class PoolMethodBuilder extends RuntimeMethodBuilder {
  /** Wrap the language callback as a job the pool can run. */
  protected job(callback: any): () => Gen<any> {
    return () => this.executeCallback(callback, []);
  }

  /** Jobs are tasks: hand back a handle the language can `wait` on / cancel. */
  protected handle(task: any) {
    return convertSpawnState(task, this.environment);
  }
}

class SchedulerBuilder extends RuntimeMethodBuilder {
  override call() {
    const [maxConcurrency = 1] = this.args;
    this.validateNumber(maxConcurrency, "maxConcurrency");

    const pool = new TaskPool(runtime.scheduler, maxConcurrency);

    return {
      go: class extends PoolMethodBuilder {
        override call() {
          const [callback] = this.args;
          this.validateFunction(callback);

          return this.handle(pool.go(this.job(callback)));
        }
      },

      schedule: class extends PoolMethodBuilder {
        override call() {
          const [callback] = this.args;
          this.validateFunction(callback);

          return this.handle(pool.schedule(this.job(callback)));
        }
      },

      scheduleFirst: class extends PoolMethodBuilder {
        override call() {
          const [callback] = this.args;
          this.validateFunction(callback);

          return this.handle(pool.scheduleFirst(this.job(callback)));
        }
      },

      scheduleDelayed: class extends PoolMethodBuilder {
        override call() {
          const [callback, delayMs] = this.args;
          this.validateFunction(callback);
          this.validateNumber(delayMs, "delayMs");

          return this.handle(pool.scheduleDelayed(this.job(callback), delayMs));
        }
      },

      scheduleRepeating: class extends PoolMethodBuilder {
        override call() {
          const [callback, intervalMs, maxRuns] = this.args;
          this.validateFunction(callback);
          this.validateNumber(intervalMs, "intervalMs");

          if (maxRuns !== undefined) {
            this.validateNumber(maxRuns, "maxRuns");
          }

          const { cancel } = pool.scheduleRepeating(this.job(callback), intervalMs, maxRuns);

          return {
            cancel: class extends RuntimeMethodBuilder {
              override call() {
                cancel();
                return null;
              }
            },
          };
        }
      },

      clear: class extends RuntimeMethodBuilder {
        override call() {
          pool.clear();
          return null;
        }
      },

      cancelAll: class extends RuntimeMethodBuilder {
        override call() {
          pool.cancelAll();
          return null;
        }
      },

      get queueSize() {
        return pool.queueSize;
      },

      get isRunning() {
        return pool.isRunning;
      },

      waitForIdle: class extends RuntimeMethodBuilder {
        override *call(): Gen<any> {
          yield pool.waitForIdle();
          return null;
        }
      },

      [Environment.SymbolFormatedText]: `Scheduler {concurrency: ${pool.maxConcurrency}, queue: ${pool.queueSize}, active: ${pool.active} }`,
    };
  }
}

// module-level helpers share one default pool
const defaultPool = new TaskPool(runtime.scheduler, 4);

class RuntimeGo extends PoolMethodBuilder {
  override call() {
    const [callback] = this.args;
    this.validateFunction(callback);

    return this.handle(defaultPool.go(this.job(callback)));
  }
}

class RuntimeSchedule extends PoolMethodBuilder {
  override call() {
    const [callback] = this.args;
    this.validateFunction(callback);

    return this.handle(defaultPool.schedule(this.job(callback)));
  }
}

class RuntimeScheduleFirst extends PoolMethodBuilder {
  override call() {
    const [callback] = this.args;
    this.validateFunction(callback);

    return this.handle(defaultPool.scheduleFirst(this.job(callback)));
  }
}

class RuntimeScheduleDelayed extends PoolMethodBuilder {
  override call() {
    const [callback, delayMs] = this.args;
    this.validateFunction(callback);
    this.validateNumber(delayMs, "delayMs");

    return this.handle(defaultPool.scheduleDelayed(this.job(callback), delayMs));
  }
}

class RuntimeWaitForIdle extends RuntimeMethodBuilder {
  override *call(): Gen<any> {
    yield defaultPool.waitForIdle();
    return null;
  }
}

class RuntimeScheduleRepeating extends PoolMethodBuilder {
  override call() {
    const [callback, intervalMs, maxRuns] = this.args;
    this.validateFunction(callback);
    this.validateNumber(intervalMs, "intervalMs");

    if (maxRuns !== undefined) {
      this.validateNumber(maxRuns, "maxRuns");
    }

    const { cancel } = defaultPool.scheduleRepeating(this.job(callback), intervalMs, maxRuns);

    return {
      cancel: class extends RuntimeMethodBuilder {
        override call() {
          cancel();
          return null;
        }
      },
    };
  }
}

/** runtime.Spawn(callback): a task that is created now and started later with `.run()`. */
class RuntimeSpawn extends PoolMethodBuilder {
  override call() {
    const [callbackFunc] = this.args;
    this.validateFunction(callbackFunc);

    const handler = runtime.scheduler.create(this.job(callbackFunc), "runtime-spawn");

    return {
      ...convertSpawnState(handler, this.environment),
      run: class extends RuntimeMethodBuilder {
        override call() {
          runtime.scheduler.start(handler);
          return null;
        }
      },
    };
  }
}

module.exports = {
  Spawn: RuntimeSpawn,
  Scheduler: SchedulerBuilder,
  go: RuntimeGo,
  schedule: RuntimeSchedule,
  scheduleFirst: RuntimeScheduleFirst,
  scheduleDelayed: RuntimeScheduleDelayed,
  waitForIdle: RuntimeWaitForIdle,
  scheduleRepeating: RuntimeScheduleRepeating,
};
