import { TimeMethodBuilder } from "./TimeBuilder";
import { Environment } from "../../src/Environment";
import { runtime } from "../../src/runtime/Runtime";
import { type Spawn } from "../../src/runtime/Spawn";
import { convertSpawnState } from "../../src/runtime/SpawnState";
import { type Gen, sleep as sleepFor } from "../../src/runtime/coroutine";

/** Cancels a pending scheduler timer. */
type CancelTimer = () => void;

class Sleep extends TimeMethodBuilder {
  /** Suspends only the calling task; every other task keeps running. */
  override *call(): Gen<void> {
    const [ms = 1000] = this.args;
    this.validateNumber(ms, "milliseconds");

    if (ms < 0) {
      throw this.throwErrorFormatters(new Error("Sleep time cannot be negative"));
    }

    yield sleepFor(runtime.scheduler, ms);
  }
}

class Delay extends TimeMethodBuilder {
  override call() {
    const [callback, ms = 0] = this.args;
    this.validateFunction(callback, "callback");
    this.validateNumber(ms, "delay");

    let task: Spawn<any> | null = null;

    return {
      // starts the delay and returns a task handle (wait it / cancel it)
      start: class extends TimeMethodBuilder {
        override call() {
          const owner = this;

          task = runtime.scheduler.spawn(
            function* (): Gen<any> {
              yield sleepFor(runtime.scheduler, ms);

              return yield owner.executeCallback(callback, []);
            },
            { name: "delay" },
          );

          return convertSpawnState(task, this.environment);
        }
      },

      cancel: class extends TimeMethodBuilder {
        override call() {
          if (task && !task.isFinished()) {
            task.cancel();
            return true;
          }
          return false;
        }
      },

      [Environment.SymbolFormatedText]: `Delay { ${ms}ms }`,
    };
  }
}

class Debounce extends TimeMethodBuilder {
  override call() {
    const [func, wait = 300, immediate = false] = this.args;
    this.validateFunction(func, "function");
    this.validateNumber(wait, "wait");

    let timeout: CancelTimer | null = null;
    // the arguments of the latest `execute`, used by the delayed call and by `flush`
    let latestArgs: any[] = [];

    return {
      execute: class extends TimeMethodBuilder {
        override call() {
          const callNow = immediate && !timeout;

          if (timeout) {
            timeout();
          }

          latestArgs = this.args;

          timeout = runtime.scheduler.after(wait, () => {
            timeout = null;
            if (!immediate) {
              this.fireCallback(func, latestArgs, "debounce");
            }
          });

          if (callNow) {
            this.fireCallback(func, this.args, "debounce");
          }

          return null;
        }
      },

      cancel: class extends TimeMethodBuilder {
        override call() {
          if (timeout) {
            timeout();
            timeout = null;
            return true;
          }
          return false;
        }
      },

      flush: class extends TimeMethodBuilder {
        override call() {
          if (timeout) {
            timeout();
            timeout = null;
            this.fireCallback(func, latestArgs, "debounce");
            return true;
          }
          return false;
        }
      },

      pending: class extends TimeMethodBuilder {
        override call() {
          return timeout !== null;
        }
      },

      [Environment.SymbolFormatedText]: `Debounce { wait: ${wait}ms, immediate: ${immediate} }`,
    };
  }
}

class Throttle extends TimeMethodBuilder {
  override call() {
    const [func, limit = 100] = this.args;
    this.validateFunction(func, "function");
    this.validateNumber(limit, "limit");

    let lastCall = 0;
    let timeout: CancelTimer | null = null;
    // the trailing call must see the most recent arguments, not the first deferred ones
    let latestArgs: any[] = [];

    return {
      execute: class extends TimeMethodBuilder {
        override call() {
          const now = Date.now();

          if (now - lastCall >= limit) {
            lastCall = now;
            this.fireCallback(func, this.args, "throttle");
          } else {
            latestArgs = this.args;

            if (!timeout) {
              timeout = runtime.scheduler.after(limit - (now - lastCall), () => {
                lastCall = Date.now();
                this.fireCallback(func, latestArgs, "throttle");
                timeout = null;
              });
            }
          }

          return null;
        }
      },

      cancel: class extends TimeMethodBuilder {
        override call() {
          if (timeout) {
            timeout();
            timeout = null;
            return true;
          }
          return false;
        }
      },

      [Environment.SymbolFormatedText]: `Throttle { limit: ${limit}ms }`,
    };
  }
}

class Interval extends TimeMethodBuilder {
  override call() {
    const [callback, ms = 1000] = this.args;
    this.validateFunction(callback, "callback");
    this.validateNumber(ms, "interval");

    let cancelTimer: CancelTimer | null = null;
    let isRunning = false;
    let executionCount = 0;

    return {
      start: class extends TimeMethodBuilder {
        override call() {
          if (isRunning) {
            return false;
          }

          isRunning = true;

          // fixed-rate ticks: each run is its own task, so a slow callback never delays the clock
          const tick = () => {
            if (!isRunning) return;

            executionCount++;
            this.fireCallback(callback, [executionCount], "interval");
            cancelTimer = runtime.scheduler.after(ms, tick);
          };

          cancelTimer = runtime.scheduler.after(ms, tick);

          return true;
        }
      },

      stop: class extends TimeMethodBuilder {
        override call() {
          if (cancelTimer) {
            cancelTimer();
            cancelTimer = null;
            isRunning = false;
            return true;
          }
          return false;
        }
      },

      reset: class extends TimeMethodBuilder {
        override call() {
          if (cancelTimer) {
            cancelTimer();
            cancelTimer = null;
          }
          isRunning = false;
          executionCount = 0;
          return null;
        }
      },

      isRunning: class extends TimeMethodBuilder {
        override call() {
          return isRunning;
        }
      },

      executionCount: class extends TimeMethodBuilder {
        override call() {
          return executionCount;
        }
      },

      [Environment.SymbolFormatedText]: `Interval { ${ms}ms, running: ${isRunning}, executions: ${executionCount} }`,
    };
  }
}

class Timeout extends TimeMethodBuilder {
  override call() {
    const [callback, ms = 0] = this.args;
    this.validateFunction(callback, "callback");
    this.validateNumber(ms, "timeout");

    let cancelTimer: CancelTimer | null = null;
    let hasExecuted = false;
    let isCancelled = false;

    return {
      start: class extends TimeMethodBuilder {
        override call() {
          if (cancelTimer || hasExecuted || isCancelled) {
            return false;
          }

          cancelTimer = runtime.scheduler.after(ms, () => {
            hasExecuted = true;
            this.fireCallback(callback, [], "timeout");
          });

          return true;
        }
      },

      cancel: class extends TimeMethodBuilder {
        override call() {
          if (cancelTimer && !hasExecuted) {
            cancelTimer();
            cancelTimer = null;
            isCancelled = true;
            return true;
          }
          return false;
        }
      },

      hasExecuted: class extends TimeMethodBuilder {
        override call() {
          return hasExecuted;
        }
      },

      isCancelled: class extends TimeMethodBuilder {
        override call() {
          return isCancelled;
        }
      },

      isPending: class extends TimeMethodBuilder {
        override call() {
          return cancelTimer !== null && !hasExecuted && !isCancelled;
        }
      },

      [Environment.SymbolFormatedText]: `Timeout { ${ms}ms, executed: ${hasExecuted}, cancelled: ${isCancelled} }`,
    };
  }
}

export { Sleep, Delay, Debounce, Throttle, Interval, Timeout };
