import { type Gen, park, sleep } from "./coroutine";
import { type Scheduler } from "./Scheduler";
import { type Spawn } from "./Spawn";

interface Waiter {
  wake: () => void;
  task: Spawn;
  /** set by `release` when the slot has been handed to this waiter */
  granted: boolean;
}

/**
 * A pool that runs at most `maxConcurrency` jobs at the same time (what the `runtime`
 * library module exposes as `Scheduler`). Jobs are ordinary tasks of the global scheduler;
 * the pool only decides *when* each of them may start. No Promises, no timers of its own.
 */
class TaskPool {
  public readonly maxConcurrency: number;

  private readonly scheduler: Scheduler;
  private activeCount = 0;
  private waiting: Waiter[] = [];
  private priorityWaiting: Waiter[] = [];
  private idleWaiters: Array<() => void> = [];
  private tasks = new Set<Spawn>();
  private destroyed = false;

  constructor(scheduler: Scheduler, maxConcurrency = 4) {
    this.scheduler = scheduler;
    this.maxConcurrency = maxConcurrency;
  }

  get queueSize(): number {
    return this.waiting.length + this.priorityWaiting.length;
  }

  get active(): number {
    return this.activeCount;
  }

  get isRunning(): boolean {
    return this.activeCount > 0;
  }

  go<T>(job: () => Gen<T>): Spawn<T> {
    return this.submit(job, false, 0);
  }

  schedule<T>(job: () => Gen<T>): Spawn<T> {
    return this.submit(job, false, 0);
  }

  scheduleFirst<T>(job: () => Gen<T>): Spawn<T> {
    return this.submit(job, true, 0);
  }

  scheduleDelayed<T>(job: () => Gen<T>, delayMs: number): Spawn<T> {
    return this.submit(job, false, delayMs);
  }

  /** Run `job` every `intervalMs` (at most `maxRuns` times) until cancelled. */
  scheduleRepeating(
    job: () => Gen<any>,
    intervalMs: number,
    maxRuns = Infinity,
  ): { cancel: () => void } {
    const self = this;

    const loop = this.scheduler.spawn(
      function* (): Gen<void> {
        for (let run = 0; run < maxRuns; run++) {
          try {
            yield self.runLimited(job, false);
          } catch (error) {
            console.error("Repeating task failed:", error);
            return;
          }

          if (run + 1 < maxRuns) yield sleep(self.scheduler, intervalMs);
        }
      },
      { name: "pool-repeating" },
    );

    this.tasks.add(loop);
    loop.onSettled(() => this.tasks.delete(loop));

    return { cancel: () => loop.cancel() };
  }

  /** Drop jobs that have not started yet. */
  clear(): void {
    for (const { task } of [...this.priorityWaiting, ...this.waiting])
      task.cancel();
    this.priorityWaiting = [];
    this.waiting = [];
    this.notifyIdle();
  }

  /** Cancel every job (queued and running) and every repeating task. */
  cancelAll(): void {
    for (const task of [...this.tasks]) task.cancel();
    this.clear();
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelAll();
  }

  /** Suspend the calling task until the pool has no running and no queued jobs. */
  *waitForIdle(): Gen<void> {
    while (this.activeCount > 0 || this.queueSize > 0) {
      yield park<void>((wake) => {
        const waiter = () => wake();
        this.idleWaiters.push(waiter);

        return () => {
          const index = this.idleWaiters.indexOf(waiter);
          if (index !== -1) this.idleWaiters.splice(index, 1);
        };
      });
    }
  }

  private submit<T>(
    job: () => Gen<T>,
    priority: boolean,
    delayMs: number,
  ): Spawn<T> {
    if (this.destroyed) throw new Error("Scheduler is destroyed");

    const self = this;

    const task = this.scheduler.spawn(
      function* (): Gen<T> {
        if (delayMs > 0) yield sleep(self.scheduler, delayMs);

        return yield self.runLimited(job, priority);
      },
      { name: "pool-job" },
    );

    this.tasks.add(task);
    task.onSettled(() => this.tasks.delete(task));

    return task;
  }

  private *runLimited<T>(job: () => Gen<T>, priority: boolean): Gen<T> {
    yield this.acquire(priority);

    try {
      return yield job();
    } finally {
      this.release();
    }
  }

  private *acquire(priority: boolean): Gen<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return;
    }

    const queue = priority ? this.priorityWaiting : this.waiting;
    const waiter: Waiter = {
      wake: () => {},
      task: this.scheduler.currentTask!,
      granted: false,
    };
    let acquired = false;

    try {
      yield park<void>((wake) => {
        waiter.wake = () => wake();

        if (priority) queue.unshift(waiter);
        else queue.push(waiter);

        return () => {
          const index = queue.indexOf(waiter);
          if (index !== -1) queue.splice(index, 1);
        };
      });

      acquired = true;
    } finally {
      if (!acquired && waiter.granted) this.release();
    }
  }

  private release(): void {
    const next = this.priorityWaiting.shift() ?? this.waiting.shift();

    if (next) {
      next.granted = true;
      next.wake();
      return;
    }

    this.activeCount--;
    this.notifyIdle();
  }

  private notifyIdle(): void {
    if (this.activeCount > 0 || this.queueSize > 0) return;

    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const wake of waiters) wake();
  }
}

export { TaskPool };
