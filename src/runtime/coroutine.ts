/**
 * Coroutine primitives of the interpreter.
 *
 * The interpreter is single-threaded and uses no `async`/`await` and no Promises.
 * Every `evaluate()` / native `call()` that may need to suspend is a generator (`Gen<T>`)
 * driven by a `Trampoline` (see Trampoline.ts).
 *
 * A coroutine yields one of two things:
 *
 *   - another coroutine  -> "call it and give me its result"   (`const v = yield callee()`)
 *   - a `Signal`         -> "suspend me":
 *        `tick`  : my time slice is used up, let somebody else run (preemption point)
 *        `park`  : I am blocked until `wake()` / `fail()` is called (wait, sleep, channels, host I/O)
 *
 * IMPORTANT: coroutines are always called with `yield`, never with `yield*`. `yield*` would
 * nest generators on the JavaScript call stack and cap recursion depth at a few hundred calls.
 */

import { BaseError } from "../errors/BaseError";
import type { Scheduler } from "./Scheduler";
import { Trampoline } from "./Trampoline";

type Wake = (value?: any) => void;
type Fail = (error: any) => void;

/** `register` may return a cleanup function that is called if the parked task is cancelled. */
type ParkRegister = (wake: Wake, fail: Fail) => void | (() => void);

type Signal =
  | { readonly t: "tick" }
  | { readonly t: "park"; readonly register: ParkRegister };

/** A coroutine. `yield <Gen>` calls a sub-coroutine, `yield <Signal>` suspends the task. */
type Gen<T = any> = Generator<Signal | Gen<any>, T, any>;

const TICK: Signal = Object.freeze({ t: "tick" } as const);

function isGenerator(value: any): value is Gen {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.next === "function" &&
    typeof value.throw === "function" &&
    typeof value.return === "function" &&
    typeof value[Symbol.iterator] === "function"
  );
}

/** Suspend the current task until `register` calls `wake`/`fail`. */
function* park<T = any>(register: ParkRegister): Gen<T> {
  return yield { t: "park", register };
}

/** Let other tasks run, then continue. */
function* tick(): Gen<void> {
  yield TICK;
}

/** Suspend for `ms` milliseconds without blocking other tasks. */
function* sleep(scheduler: Scheduler, ms: number): Gen<void> {
  yield park<void>((wake) => scheduler.after(ms, () => wake()));
}

/**
 * Bridge to the Node.js event loop. This is the ONLY way for interpreted code to
 * wait for a real host operation (network, `fetch`, dynamic `import()`).
 * The task is parked; the scheduler resumes it when the promise settles.
 */
function* hostAwait<T>(promise: PromiseLike<T>): Gen<T> {
  return yield park<T>((wake, fail) => {
    promise.then(wake, fail);
  });
}

/**
 * Uniform adapter: runs a generator, bridges a host Promise, or returns a plain value.
 * Used wherever a native function may return any of the three.
 */
function* lift<T = any>(value: any): Gen<T> {
  if (isGenerator(value)) return yield value;
  if (value instanceof Promise) return yield hostAwait(value);
  return value;
}

/** Run a native function builder (`new fn(args, astArgs, env)`) which may be sync or a generator. */
function* callNative<T = any>(builder: { call(): any }): Gen<T> {
  return yield lift<T>(builder.call());
}

/**
 * Drive a generator to completion right now, for host algorithms that need a plain value
 * (e.g. numeric routines that call a user function). Time-slice ticks are simply ignored;
 * a callback that tries to really suspend (wait, sleep, channel, host I/O) cannot be
 * honoured here and fails with a clear error instead of silently returning a Generator.
 */
function runSync<T = any>(value: any): T {
  if (!isGenerator(value)) return value;

  const trampoline = new Trampoline<T>(value);
  let step = trampoline.resume("next");

  while (!step.done) {
    if (step.signal.t === "tick") {
      step = trampoline.resume("next");
      continue;
    }

    trampoline.unwind();
    try {
      trampoline.resume("next");
    } catch {
      // unwinding a callback that wanted to wait; the error below is what matters
    }

    throw new BaseError(
      "A callback used here must finish immediately: it cannot wait, sleep or use channels",
    );
  }

  return step.value;
}

export {
  runSync,
  type Signal,
  type Gen,
  type Wake,
  type Fail,
  type ParkRegister,
  TICK,
  isGenerator,
  park,
  tick,
  sleep,
  hostAwait,
  lift,
  callNative,
};
