import { type CallStack } from "./CallStack";
import { BaseError } from "../errors/BaseError";
import { BreakStatement } from "../ast/statement/BreakStatement";
import { ReturnStatement } from "../ast/statement/ReturnStatement";
import { ContinueStatement } from "../ast/statement/ContinueStatement";
import { Scheduler } from "./Scheduler";
import { TaskContext } from "./TaskContext";
import { security } from "../security";

/** How often memory is sampled while no task is running. */
const MEMORY_SAMPLE_INTERVAL_MS = 50;

class Runtime {
  /** Cooperative scheduler that drives every task (green thread) of the program. */
  readonly scheduler: Scheduler = new Scheduler({
    enter: (ctx) => this.enter(ctx),
    leave: () => this.leave(),
  });
  spawnQueue: Map<string, any> = new Map();

  private ctx: TaskContext = new TaskContext();
  private ctxStack: TaskContext[] = [];
  private _lastRuntimeResult: any = null;
  /** Host timer that aborts the program when `--timeout` elapses while every task is blocked. */
  private deadlineHandle: ReturnType<typeof setTimeout> | null = null;
  /** Host timer that samples memory while no task is running. */
  private memoryHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Begin enforcing `--timeout` / `--max-memory`. The scheduler probes the limits at every
   * task step, and a host timer covers the case where the whole program is blocked on I/O
   * (where no step would ever happen).
   */
  beginLimits(): void {
    const limits = security.limits;

    limits.begin();

    if (limits.unlimited) return;

    this.scheduler.setLimitProbe(() => security.violation());

    // The scheduler only probes the limits between statements, so a program parked on a
    // single large host operation - reading a 2 GB file, say - would not be checked until
    // it came back. This samples memory while that happens.
    if (limits.maxMemory !== null) {
      this.memoryHandle = setInterval(() => {
        const violation = security.violation();

        if (violation) this.scheduler.abort(violation);
      }, MEMORY_SAMPLE_INTERVAL_MS);

      this.memoryHandle.unref?.();
    }

    const remaining = limits.remaining();

    if (remaining !== null) {
      this.deadlineHandle = setTimeout(() => {
        this.deadlineHandle = null;

        const violation = security.violation();

        if (violation) this.scheduler.abort(violation);
      }, remaining + 1);

      // a program that finishes early must not be kept alive by this timer
      this.deadlineHandle.unref?.();
    }
  }

  /** Stop enforcing resource limits (the program finished). */
  endLimits(): void {
    security.limits.end();
    this.scheduler.setLimitProbe(null);

    if (this.deadlineHandle) {
      clearTimeout(this.deadlineHandle);
      this.deadlineHandle = null;
    }

    if (this.memoryHandle) {
      clearInterval(this.memoryHandle);
      this.memoryHandle = null;
    }
  }

  /** Kept for backwards compatibility with code that used the old name. */
  get schedulerStack(): Scheduler {
    return this.scheduler;
  }

  get callStack(): CallStack {
    return this.ctx.callStack;
  }

  /** Called by the scheduler: make `ctx` the active execution context. */
  enter(ctx: TaskContext) {
    this.ctxStack.push(this.ctx);
    this.ctx = ctx;
  }

  /** Called by the scheduler: restore the previously active execution context. */
  leave() {
    this.ctx = this.ctxStack.pop() ?? this.ctx;
  }

  /**
   * Synchronous first half of running the statement on top of the call stack: validates it and
   * returns it, or `null` when the stack is empty. The caller then evaluates the statement
   * (`yield statement.evaluate(environment)`) and finishes with `endResume`.
   * (Split in two so that a statement costs one coroutine frame instead of two.)
   */
  beginResume(): { environment: any; statement: any } | null {
    if (this.callStack.isEmpty()) {
      return null;
    }

    const { environment, statement } = this.callStack.peek();

    if (
      statement instanceof ReturnStatement &&
      this.ctx.functionStack.length === 0
    ) {
      throw new BaseError("return statement can only exit in function body", {
        files: this.getFilePaths(environment),
      });
    }

    if (
      (statement instanceof BreakStatement ||
        statement instanceof ContinueStatement) &&
      !this.isInValidIteration()
    ) {
      const statementType =
        statement instanceof BreakStatement ? "break" : "continue";
      throw new BaseError(
        `${statementType} statement can only exist in iteration block`,
        {
          files: this.getFilePaths(environment),
        },
      );
    }

    return { environment, statement };
  }

  /** Second half of `beginResume`: record control-flow effects and pop the statement. */
  endResume(statement: any, value: any): void {
    this._lastRuntimeResult = value;

    if (statement instanceof ReturnStatement) {
      this.ctx.isReturn = true;
      this.ctx.lastExecutionResult = value;
    }

    if (statement instanceof BreakStatement) {
      this.ctx.isBreak = true;
    }

    if (statement instanceof ContinueStatement) {
      this.ctx.isContinue = true;
    }

    this.callStack.pop();
  }

  get isBreak() {
    return this.ctx.isBreak;
  }

  get isContinue() {
    return this.ctx.isContinue;
  }

  get isReturn() {
    return this.ctx.isReturn;
  }

  /**
   * Restore control-flow flags of the active task. Used by blocks that must run
   * deferred code in the middle of a `return` / `break` / `continue`.
   */
  restoreFlags(flags: {
    isBreak: boolean;
    isReturn: boolean;
    isContinue: boolean;
    result: any;
  }) {
    this.ctx.isBreak = flags.isBreak;
    this.ctx.isReturn = flags.isReturn;
    this.ctx.isContinue = flags.isContinue;
    this.ctx.lastExecutionResult = flags.result;
  }

  markFunctionCallPosition() {
    this.ctx.functionStack.push(this.callStack.getCursor());
  }

  /** Entering a struct method: its type may now reach its own private members. */
  enterStruct(structType: any): void {
    this.ctx.structStack.push(structType);
  }

  /** Leaving a struct method. */
  leaveStruct(): void {
    this.ctx.structStack.pop();
  }

  /** Is a method of `structType` currently running in this task? */
  isInsideStruct(structType: any): boolean {
    if (!structType) return false;

    const stack = this.ctx.structStack;

    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i] === structType) return true;
    }

    return false;
  }

  markIterationCallPosition() {
    this.ctx.iterationStack.push(this.callStack.getCursor());
  }

  finishIteration() {
    if (this.ctx.iterationStack.length > 0) {
      this.ctx.iterationStack.pop();
    }
  }

  finishFunction() {
    if (this.ctx.functionStack.length > 0) {
      this.ctx.functionStack.pop();
    }
  }

  getLastExecutionResult(): any {
    return this.ctx.lastExecutionResult;
  }

  getLastRuntimeExecutionResult(): any {
    return this._lastRuntimeResult;
  }

  resetLastExecutionResult() {
    this.ctx.isReturn = false;
    this.ctx.lastExecutionResult = null;
  }

  resetBreak() {
    this.ctx.isBreak = false;
  }

  resetContinue() {
    this.ctx.isContinue = false;
  }

  resetAll() {
    this.ctx.isBreak = false;
    this.ctx.isReturn = false;
    this.ctx.isContinue = false;
    this.ctx.lastExecutionResult = null;
  }

  private isInValidIteration(): boolean {
    const { iterationStack, functionStack } = this.ctx;

    if (iterationStack.length === 0) {
      return false;
    }

    if (functionStack.length === 0) {
      return true;
    }

    const lastFunction = functionStack[functionStack.length - 1]!;
    const lastIteration = iterationStack[iterationStack.length - 1]!;

    return lastIteration > lastFunction;
  }

  private getFilePaths(environment: any): string[] {
    try {
      // @ts-ignore
      return (
        environment?.values?.["import"]?.paths ||
        // @ts-ignore
        environment?.parent?.values?.["import"]?.paths ||
        []
      );
    } catch {
      return [];
    }
  }
}

const runtime = new Runtime();

export { runtime };
