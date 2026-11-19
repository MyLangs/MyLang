import { TaskContext } from "./TaskContext";
import { type Gen, park } from "./coroutine";
import { type Trampoline } from "./Trampoline";
import { type Scheduler } from "./Scheduler";

type SpawnStatus = "pending" | "fulfilled" | "rejected" | "cancelled";

/**
 * A spawned task (green thread). It owns a generator (the running program), its own
 * execution context, and notifies joiners when it settles. No Promises involved.
 */
class Spawn<T = any> {
  private static seq = 0;

  public readonly id = ++Spawn.seq;
  public readonly ctx: TaskContext = new TaskContext();

  // ---- scheduler-owned bookkeeping (never reachable from the language) ----
  public scheduler!: Scheduler;
  public co: Trampoline<T> | null = null;
  public lifecycle: "new" | "ready" | "running" | "blocked" | "finished" =
    "new";
  public resumeValue: any = undefined;
  public resumeError: { error: any } | null = null;
  public parkCleanup: (() => void) | null = null;
  public activePark: object | null = null;
  public cancelRequested = false;
  public unwinding = false;

  // ---- observable state ----
  private _status: SpawnStatus = "pending";
  private _result: T | undefined;
  private _error: any = null;
  private _started = false;
  private _startTime = 0;
  private _endTime = 0;
  private _settledCallbacks: Array<() => void> = [];

  constructor(
    public readonly factory: () => Gen<T>,
    public readonly name: string = "task",
  ) {}

  /** Called once by the scheduler right before the first step. */
  markStarted(): void {
    if (this._started) return;
    this._started = true;
    this._startTime = Date.now();
  }

  /** Settle the task. Idempotent: the first settle wins (so `cancel()` is final). */
  settle(status: Exclude<SpawnStatus, "pending">, value?: any): void {
    if (this._status !== "pending") return;

    this._status = status;
    this._endTime = Date.now();

    if (status === "fulfilled") this._result = value;
    if (status === "rejected") this._error = value;

    const callbacks = this._settledCallbacks;
    this._settledCallbacks = [];
    for (const callback of callbacks) callback();
  }

  /**
   * Run `callback` when this task settles (immediately if it already has).
   * Returns a function that unsubscribes.
   */
  onSettled(callback: () => void): () => void {
    if (this._status !== "pending") {
      callback();
      return () => {};
    }

    this._settledCallbacks.push(callback);

    return () => {
      const index = this._settledCallbacks.indexOf(callback);
      if (index !== -1) this._settledCallbacks.splice(index, 1);
    };
  }

  /** Suspend the *calling* task until this task has settled. Never throws for a failed task. */
  *join(): Gen<void> {
    if (this._status !== "pending") return;
    yield park<void>((wake) => this.onSettled(() => wake()));
  }

  cancel(): void {
    if (this._status !== "pending") return;
    this.scheduler.cancel(this);
  }

  get done(): boolean {
    return this._status === "fulfilled" || this._status === "rejected";
  }

  get result(): any {
    return this._result === undefined ? null : this._result;
  }

  get error(): unknown {
    return this._error || null;
  }

  get status(): SpawnStatus {
    return this._status;
  }

  get elapsed(): number | null {
    if (!this._started) return null;
    return (
      (this._status !== "pending" ? this._endTime : Date.now()) -
      this._startTime
    );
  }

  isCancelled() {
    return this._status === "cancelled";
  }

  isFinished() {
    return this._status !== "pending";
  }
}

export { Spawn, type SpawnStatus };
