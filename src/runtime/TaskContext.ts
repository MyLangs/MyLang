import { CallStack } from "./CallStack";

/**
 * Execution state that used to live in the global `runtime` singleton.
 * Every task (spawned green thread) owns its own context; the scheduler swaps the
 * active context whenever it switches tasks, so `return` / `break` / `continue`
 * flags and call stacks of concurrent tasks can never corrupt each other.
 */
class TaskContext {
  callStack: CallStack = new CallStack();
  isBreak = false;
  isReturn = false;
  isContinue = false;
  functionStack: number[] = [];
  iterationStack: number[] = [];
  lastExecutionResult: any = null;
  /**
   * The struct types whose methods are executing right now, innermost last.
   * A `private` member may only be reached while its own type is on this stack.
   */
  structStack: any[] = [];
}

export { TaskContext };
