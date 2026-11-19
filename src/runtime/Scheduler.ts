import { BaseError } from "../errors/BaseError";
import { type TaskContext } from "./TaskContext";
import { type Gen, type Signal } from "./coroutine";
import { Trampoline } from "./Trampoline";
import { Spawn } from "./Spawn";
import { security } from "../security";

/**
 * Cooperative, single-threaded scheduler (green threads).
 *
 * - Every `spawn` is a task = a generator + its own execution context.
 * - Tasks run one at a time, round-robin. A task only loses the CPU when it
 *   suspends (`wait`, `sleep`, channel, host I/O) or when its time slice is used
 *   up (`shouldYield()`), so a long-running spawned loop never starves the rest.
 * - Sleeping never blocks the thread: timers are armed on the host event loop and
 *   the scheduler is pumped again when they fire.
 * - Nothing in here uses `async`/`await` or Promises.
 */

interface SchedulerHost {
  enter(ctx: TaskContext): void;
  leave(): void;
}

interface SpawnOptions {
  name?: string;
  /** Start running immediately (like an async function does) instead of only enqueueing. Default: true. */
  eager?: boolean;
  /** Called when the task fails; used for host-initiated tasks that nobody joins. */
  onError?: (error: unknown) => void;
}

interface Timer {
  at: number;
  seq: number;
  callback: () => void;
  cancelled: boolean;
}

class Queue<T> {
  private items: T[] = [];
  private head = 0;

  get length(): number {
    return this.items.length - this.head;
  }

  push(item: T): void {
    this.items.push(item);
  }

  shift(): T | undefined {
    if (this.head >= this.items.length) return undefined;

    const item = this.items[this.head]!;
    this.items[this.head] = undefined as unknown as T;
    this.head++;

    if (this.head > 1024 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }

    return item;
  }
}

/**
 * How long a program aborted by a resource limit may spend releasing what it holds.
 * Long enough for a flush or a graceful close, short enough that a runaway program is
 * still gone promptly.
 */
const ABORT_GRACE_MS = 2000;

class Scheduler {
  /** Statements a task may execute before it is asked to yield to other ready tasks. */
  public timeSlice = 256;
  /** Steps run in one go before control is handed back to the Node.js event loop. */
  public maxStepsPerTurn = 4096;

  private readonly host: SchedulerHost;
  private ready = new Queue<Spawn>();
  private current: Spawn | null = null;
  /** > 0 while a task runs eagerly inside the step of its parent (the parent is waiting on the stack). */
  private nesting = 0;
  private looping = false;
  private liveCount = 0;
  private budget = this.timeSlice;

  /** Every task that has started and not finished; needed to abort the program as a whole. */
  private readonly live = new Set<Spawn>();
  /** Set by `abort`: the program is over; tasks may only run their cleanup. */
  private abortReason: unknown = null;
  /** While aborting: when the cleanup phase stops being allowed to run. */
  private abortDeadline = 0;
  /** Timer that ends the cleanup phase. */
  private abortHandle: ReturnType<typeof setTimeout> | null = null;
  /** Consulted at every step; set by the runtime to enforce `--timeout` / `--max-memory`. */
  private limitProbe: (() => unknown) | null = null;

  private timers: Timer[] = [];
  private timerSeq = 0;
  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private pumpQueued = false;

  constructor(host: SchedulerHost) {
    this.host = host;
  }

  /** The task that is executing right now (null outside of any task). */
  get currentTask(): Spawn | null {
    return this.current;
  }

  /** Number of tasks that have not finished running yet. */
  get liveTasks(): number {
    return this.liveCount;
  }

  /** True once the program was aborted by a resource limit. */
  get aborted(): boolean {
    return this.abortReason !== null;
  }

  /**
   * Install the resource-limit probe. It is called once per task step and must return the
   * violated limit as an error, or a falsy value when everything is within bounds.
   */
  setLimitProbe(probe: (() => unknown) | null): void {
    this.limitProbe = probe;
  }

  /**
   * End the whole program: no task may run another ordinary statement.
   *
   * Used for `--timeout` and `--max-memory`, which interpreted code must not be able to
   * survive. The program does not simply vanish, though: every live task is first
   * *unwound*, which runs the `finally` and `defer` of every active frame, so files are
   * flushed, sockets are closed and `symbol.dispose` runs. Cleanup may itself suspend (a
   * flush, a graceful close), so it is given `graceMs` to finish; whatever is still
   * running when that elapses is dropped.
   *
   * Nothing a task does during this phase can keep the program alive: it can only run the
   * cleanup it had already registered, and only until the deadline.
   */
  abort(reason: unknown, graceMs = ABORT_GRACE_MS): void {
    if (this.abortReason !== null) return;

    this.abortReason = reason;
    this.limitProbe = null;
    this.abortDeadline = Date.now() + Math.max(0, graceMs);

    // Timers stay armed: a `defer` that waits for a flush needs them. They are dropped
    // with everything else when the cleanup phase ends.

    for (const task of Array.from(this.live)) {
      this.requestUnwind(task);
    }

    if (this.live.size === 0) {
      this.finishAbort();
      return;
    }

    this.abortHandle = setTimeout(
      () => this.finishAbort(),
      Math.max(1, this.abortDeadline - Date.now()),
    );

    this.abortHandle.unref?.();

    this.requestPump();
  }

  /** Has the cleanup phase run out of time? */
  private abortExpired(): boolean {
    return this.abortReason !== null && Date.now() >= this.abortDeadline;
  }

  /**
   * Ask a task to unwind: its coroutine runs every `finally` / `defer` of every active
   * frame and then ends. A blocked task is released from its suspension first, so it is
   * stepped again instead of waiting for a host callback that will never come.
   */
  private requestUnwind(task: Spawn): void {
    if (task.lifecycle === "finished") return;

    task.cancelRequested = true;

    if (task.lifecycle === "new") {
      this.finish(task, "rejected", this.abortReason);
      return;
    }

    if (task.lifecycle === "blocked") {
      this.releasePark(task);
      task.lifecycle = "ready";
      this.ready.push(task);
    }
  }

  /** Drop one task during an abort, and tidy up when it was the last one. */
  private dropDuringAbort(task: Spawn): void {
    this.releasePark(task);
    this.finish(task, "rejected", this.abortReason);

    if (this.live.size === 0) this.finishAbort();
  }

  /** The cleanup phase is over: drop everything that is left. */
  private finishAbort(): void {
    if (this.abortHandle) {
      clearTimeout(this.abortHandle);
      this.abortHandle = null;
    }

    this.abortDeadline = 0;

    for (const timer of this.timers) timer.cancelled = true;
    this.timers = [];

    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }

    for (const task of Array.from(this.live)) {
      this.releasePark(task);
      this.finish(task, "rejected", this.abortReason);
    }

    this.ready = new Queue<Spawn>();
  }

  /** Clear a blocked task's registration so its host callback can no longer resume it. */
  private releasePark(task: Spawn): void {
    const cleanup = task.parkCleanup;

    task.parkCleanup = null;
    task.activePark = null;

    try {
      cleanup?.();
    } catch {
      // a failing cleanup must not stop the abort
    }
  }

  /**
   * Create a task. By default it starts immediately and runs until its first suspension
   * (same observable behaviour as calling an async function), then the caller continues.
   */
  spawn<T>(factory: () => Gen<T>, options: SpawnOptions = {}): Spawn<T> {
    const task = this.create(factory, options.name);

    this.start(task, options);

    return task;
  }

  /** Create a task without starting it (see `start`). */
  create<T>(factory: () => Gen<T>, name?: string): Spawn<T> {
    const task = new Spawn<T>(factory, name);
    task.scheduler = this;

    return task;
  }

  /** Start a task created with `create`. Starting twice (or a cancelled task) is a no-op. */
  start(task: Spawn, options: Omit<SpawnOptions, "name"> = {}): void {
    if (task.lifecycle !== "new") return;

    // The program is over and cleanup has ended: the task settles without ever running.
    // While cleanup is still allowed, spawning works, because `defer` may need it
    // (`wait spawn resource.close()`).
    if (this.abortExpired()) {
      task.lifecycle = "finished";
      task.settle("rejected", this.abortReason);
      return;
    }

    // `--max-tasks`: refused before the task starts, so nothing has to be unwound
    security.acquire("task");

    task.lifecycle = "ready";
    this.liveCount++;
    this.live.add(task);

    if (options.onError) {
      const onError = options.onError;
      task.onSettled(() => {
        if (task.status === "rejected") {
          try {
            onError(task.error);
          } catch {
            // an error handler must never take the scheduler down
          }
        }
      });
    }

    if (options.eager !== false && this.looping && this.current) {
      this.step(task);
    } else {
      this.ready.push(task);
      this.requestPump();
      if (options.eager !== false) this.pump();
    }
  }

  /**
   * Time-slice check; called at statement/iteration boundaries.
   *
   * This is also where the resource limits are enforced, because a task that never
   * suspends - a tight `while (true)` - is otherwise executed entirely inside a single
   * scheduler step and would never be checked again.
   */
  shouldYield(): boolean {
    if (--this.budget > 0) return false;

    this.budget = this.timeSlice;

    // Cleanup ran out of time: force the task back to the scheduler, which drops it.
    // Without this a `defer` holding an endless loop would never be cut off, because
    // nothing else is ready and the host timer cannot fire while it runs.
    if (this.abortExpired()) return true;

    if (this.limitProbe) {
      const violation = this.limitProbe();

      if (violation) {
        this.abort(violation);
        return true;
      }
    }

    // a parent suspended under an eager child counts as waiting work, too
    return this.ready.length > 0 || this.nesting > 0 || this.hasDueTimer();
  }

  /** Run `callback` after `ms` milliseconds on the scheduler's clock. Returns a canceller. */
  after(ms: number, callback: () => void): () => void {
    const timer: Timer = {
      at: Date.now() + Math.max(0, ms),
      seq: ++this.timerSeq,
      callback,
      cancelled: false,
    };

    this.timers.push(timer);

    if (!this.looping) this.armTimer();

    return () => {
      timer.cancelled = true;
    };
  }

  /** Run every ready task until nothing is runnable (bounded per turn, see maxStepsPerTurn). */
  pump(): void {
    if (this.looping) return;

    this.looping = true;
    let steps = 0;

    try {
      for (;;) {
        this.fireDueTimers();

        const task = this.ready.shift();
        if (!task) break;

        this.step(task);

        if (++steps >= this.maxStepsPerTurn) {
          this.requestImmediate();
          break;
        }
      }
    } finally {
      this.looping = false;
    }

    this.armTimer();
  }

  /** Cancel a task: it settles as "cancelled" right away and unwinds (runs `defer`s) in the background. */
  cancel(task: Spawn): void {
    if (task.cancelRequested || task.lifecycle === "finished") return;

    task.cancelRequested = true;
    task.settle("cancelled");

    // never started: nothing to unwind
    if (task.lifecycle === "new") {
      task.lifecycle = "finished";
      return;
    }

    if (task.lifecycle === "blocked") {
      const cleanup = task.parkCleanup;
      task.parkCleanup = null;
      task.activePark = null;

      try {
        cleanup?.();
      } catch {
        // ignore cleanup failures of the blocked operation
      }

      task.lifecycle = "ready";
      this.ready.push(task);
      this.requestPump();
    }
  }

  // ---------------------------------------------------------------- internals

  private step(task: Spawn): void {
    if (task.lifecycle === "finished") return;

    // Aborting: the task may run its cleanup (`cancelRequested` makes the coroutine
    // unwind) until the deadline, and not a statement more.
    if (this.abortExpired()) {
      this.dropDuringAbort(task);
      return;
    }

    if (this.limitProbe) {
      const violation = this.limitProbe();

      if (violation) {
        this.abort(violation);

        // This task was taken out of the ready queue to be stepped, and `abort` only
        // re-queues tasks that were blocked - so without this it would be dropped on the
        // floor, the program would never settle, and the run would be reported as a
        // deadlock instead of as the limit it hit.
        // `abort` may already have settled it, so the state is re-read rather than
        // trusted from the check at the top of this method
        if ((task.lifecycle as string) !== "finished") {
          task.lifecycle = "ready";
          this.ready.push(task);
          this.requestPump();
        }

        return;
      }
    }

    const previous = this.current;
    const nested = previous !== null;

    this.current = task;
    task.lifecycle = "running";
    this.host.enter(task.ctx);
    if (nested) this.nesting++;

    let result: { done: true; value: any } | { done: false; signal: Signal };

    try {
      if (!task.co) {
        task.markStarted();
        task.co = new Trampoline(task.factory());
      }

      if (task.cancelRequested && !task.unwinding) {
        // run every `finally` / `defer` of every active frame, top to bottom
        task.unwinding = true;
        task.co.unwind();
        result = task.co.resume("next");
      } else if (task.resumeError) {
        const { error } = task.resumeError;
        task.resumeError = null;
        result = task.co.resume("throw", error);
      } else {
        const value = task.resumeValue;
        task.resumeValue = undefined;
        result = task.co.resume("next", value);
      }
    } catch (error) {
      this.leaveStep(previous, nested);
      this.finish(task, "rejected", error);
      return;
    }

    this.leaveStep(previous, nested);

    if (result.done) {
      if (this.abortReason !== null) {
        // the last task has released what it held: stop waiting for the deadline
        this.dropDuringAbort(task);
        return;
      }

      this.finish(task, "fulfilled", result.value);
      return;
    }

    this.handleSignal(task, result.signal);
  }

  private leaveStep(previous: Spawn | null, nested: boolean): void {
    this.host.leave();
    this.current = previous;
    if (nested) this.nesting--;
  }

  private handleSignal(task: Spawn, signal: Signal): void {
    // The cleanup phase is over: nothing may be queued or parked again.
    if (this.abortExpired()) {
      task.co = null;
      this.dropDuringAbort(task);
      return;
    }

    // A task that was cancelled while running must not start a new suspension: unwind it.
    if (task.cancelRequested && !task.unwinding) {
      task.lifecycle = "ready";
      this.ready.push(task);
      return;
    }

    if (signal && signal.t === "tick") {
      task.lifecycle = "ready";
      this.ready.push(task);
      return;
    }

    if (signal && signal.t === "park") {
      task.lifecycle = "blocked";

      const park = {};
      task.activePark = park;

      const resume = (apply: () => void) => {
        if (task.activePark !== park) return;

        task.activePark = null;
        task.parkCleanup = null;
        apply();
        task.lifecycle = "ready";
        this.ready.push(task);
        this.requestPump();
      };

      const wake = (value?: any) =>
        resume(() => {
          task.resumeValue = value;
        });

      const fail = (error: any) =>
        resume(() => {
          task.resumeError = { error };
        });

      try {
        const cleanup = signal.register(wake, fail);

        if (typeof cleanup === "function" && task.activePark === park) {
          task.parkCleanup = cleanup;
        }
      } catch (error) {
        fail(error);
      }

      return;
    }

    // Anything else means some code yielded a non-generator, non-signal value (e.g. a string) by mistake.
    task.co = null;
    this.finish(
      task,
      "rejected",
      new BaseError(
        "Internal error: a task yielded an invalid signal to the scheduler",
      ),
    );
  }

  private finish(
    task: Spawn,
    status: "fulfilled" | "rejected",
    value: any,
  ): void {
    task.lifecycle = "finished";
    task.co = null;
    task.activePark = null;

    if (this.live.delete(task)) {
      this.liveCount--;
      security.release("task");
    }

    task.settle(status, value);
  }

  private hasDueTimer(): boolean {
    const next = this.peekTimer();
    return next !== null && next.at <= Date.now();
  }

  private peekTimer(): Timer | null {
    let best: Timer | null = null;

    for (const timer of this.timers) {
      if (timer.cancelled) continue;
      if (
        !best ||
        timer.at < best.at ||
        (timer.at === best.at && timer.seq < best.seq)
      ) {
        best = timer;
      }
    }

    return best;
  }

  private fireDueTimers(): void {
    if (this.timers.length === 0) return;

    const now = Date.now();
    const due: Timer[] = [];
    const rest: Timer[] = [];

    for (const timer of this.timers) {
      if (timer.cancelled) continue;
      (timer.at <= now ? due : rest).push(timer);
    }

    this.timers = rest;

    due.sort((a, b) => a.at - b.at || a.seq - b.seq);

    for (const timer of due) {
      if (!timer.cancelled) timer.callback();
    }
  }

  private armTimer(): void {
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }

    if (this.ready.length > 0) return;

    const next = this.peekTimer();
    if (!next) return;

    this.timerHandle = setTimeout(
      () => {
        this.timerHandle = null;
        this.pump();
      },
      Math.max(0, next.at - Date.now()),
    );
  }

  /** Called when something outside the run loop (timer, host callback) made a task ready. */
  private requestPump(): void {
    if (this.looping || this.pumpQueued) return;

    this.pumpQueued = true;
    queueMicrotask(() => {
      this.pumpQueued = false;
      this.pump();
    });
  }

  /** Hand control back to the Node.js event loop, then continue with the remaining ready tasks. */
  private requestImmediate(): void {
    if (this.pumpQueued) return;

    this.pumpQueued = true;
    setImmediate(() => {
      this.pumpQueued = false;
      this.pump();
    });
  }
}

export { Scheduler, type SpawnOptions, type SchedulerHost };
