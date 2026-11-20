import { type Gen, type Signal } from "./coroutine";

type Mode = "next" | "throw";

type TrampolineResult<T> =
  { done: true; value: T } | { done: false; signal: Signal };

/**
 * Drives a tree of nested coroutines WITHOUT using the JavaScript call stack.
 *
 * Coroutines call each other by yielding the callee generator (`yield callee()`);
 * the trampoline pushes it on its own heap-allocated frame stack, runs it, and hands its
 * return value (or exception) back to the caller. A language call therefore costs heap
 * memory, not native stack, so recursion depth is only limited by memory - and resuming a
 * suspended task is O(1) instead of re-entering every nested frame.
 *
 * A coroutine yields either another generator (a call) or a `Signal` for the scheduler
 * (`tick` / `park`); signals are returned from `resume` so the scheduler can suspend the task.
 */
class Trampoline<T = any> {
  private readonly frames: Gen[] = [];
  /** frames that still have to be unwound (cancellation); their `finally` blocks must run */
  private pending = new Set<Gen>();

  constructor(root: Gen<T>) {
    this.frames.push(root);
  }

  /**
   * Cancel: every frame that exists right now gets `return()` called on it, top to bottom,
   * so each `finally` block (e.g. `defer`) runs. Frames started by those finalizers run normally.
   */
  unwind(): void {
    for (const frame of this.frames) this.pending.add(frame);
  }

  /** Run until the root finishes or some frame yields a scheduler signal. Throws if the root throws. */
  resume(mode: Mode, input?: any): TrampolineResult<T> {
    const frames = this.frames;
    const pending = this.pending;

    for (;;) {
      const frame = frames[frames.length - 1]!;

      let step: IteratorResult<any, any>;

      try {
        if (pending.size !== 0 && pending.delete(frame)) {
          step = frame.return(undefined);
        } else if (mode === "throw") {
          step = frame.throw(input);
        } else {
          step = frame.next(input);
        }
      } catch (error) {
        frames.pop();

        if (frames.length === 0) throw error;

        mode = "throw";
        input = error;

        continue;
      }

      if (step.done) {
        frames.pop();

        if (frames.length === 0) return { done: true, value: step.value };

        mode = "next";
        input = step.value;

        continue;
      }

      const yielded = step.value;

      if (
        yielded !== null &&
        typeof yielded === "object" &&
        typeof yielded.next === "function" &&
        typeof yielded.throw === "function"
      ) {
        frames.push(yielded);
        mode = "next";
        input = undefined;
        continue;
      }

      if (
        yielded === null ||
        typeof yielded !== "object" ||
        typeof yielded.t !== "string"
      ) {
        frames.pop();

        mode = "throw";
        input = new Error(
          "Internal error: a coroutine yielded something that is not a call or a signal",
        );

        if (frames.length === 0) throw input;

        continue;
      }

      return { done: false, signal: yielded as Signal };
    }
  }
}

export { Trampoline, type TrampolineResult };
