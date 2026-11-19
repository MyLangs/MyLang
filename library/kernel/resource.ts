/**
 * Owned resources: the shared implementation of `symbol.dispose` for every library that
 * holds something which must be released (open files, sockets, servers, workers, archives,
 * watchers).
 *
 * A resource built here always behaves the same way:
 *
 *   - `res.close()`            closes it; calling it twice is not an error
 *   - `res.closed`             `true` once it was closed
 *   - `defer open(...)`        closes it when the enclosing block ends
 *   - `wait spawn res.close()` works, because closing may suspend like any other call
 *
 * Closing is idempotent and never throws for an already-closed resource, so a `defer` after
 * an explicit `close()` is harmless - which is what makes the two styles mix safely.
 */

import { Environment } from "../../src/Environment";
import { security, type CountedKind } from "../../src/security";
import { FunctionBuilder } from "../FunctionBuilder";
import { type StmtType } from "../../src/ast/StmtType";
import { type Gen, lift } from "../../src/runtime/coroutine";

/** What a resource's `close` may return: nothing, a promise, or a coroutine. */
type CloseResult = void | PromiseLike<any> | Gen<any> | any;

interface ResourceOptions {
  /** Shown in error messages and in the formatted text of the value. */
  name: string;
  /**
   * Which `--max-*` count this resource is held against, if any. The count is taken
   * before the resource is built and given back when it is closed, so a program cannot
   * hold more open files or connections than its policy allows.
   */
  counts?: CountedKind;
  /** Library the resource belongs to, for error attribution. */
  pkg: { name: string; path: string };
  /** Releases the underlying host handle. Called at most once. */
  close: () => CloseResult;
  /** Language-visible members of the resource (methods, data). */
  members?: Record<string | symbol, any>;
  /** Text shown when the value is printed. */
  describe?: () => string;
}

/** Thrown by `state.assertOpen()`; libraries turn it into their own error. */
class ClosedResourceError extends Error {
  constructor(name: string) {
    super(`${name} is already closed`);
    this.name = "ClosedResourceError";
  }
}

/** The bookkeeping half of a resource: lets the owning library check its own state. */
class ResourceState {
  private _closed = false;

  constructor(public readonly name: string) {}

  get closed(): boolean {
    return this._closed;
  }

  /** Marks the resource closed. Returns `false` when it already was. */
  markClosed(): boolean {
    if (this._closed) return false;

    this._closed = true;

    return true;
  }

  assertOpen(): void {
    if (this._closed) throw new ClosedResourceError(this.name);
  }
}

/**
 * Build the language value for an owned resource.
 * Returns the value itself plus the state object the library keeps for its own checks.
 */
function createResource(options: ResourceOptions): {
  value: Record<string | symbol, any>;
  state: ResourceState;
} {
  const state = new ResourceState(options.name);
  const pkg = options.pkg;
  const counts = options.counts;

  // The host handle already exists by the time a library gets here - a socket is bound,
  // a file is open - so a refused count has to release it, or the program would be left
  // holding something it can never reach, and the process would never exit.
  if (counts) {
    try {
      security.acquire(counts);
    } catch (error) {
      try {
        const closing = options.close() as any;

        // a close that returns a promise would otherwise reject unobserved
        if (closing && typeof closing.then === "function") {
          closing.then(
            () => undefined,
            () => undefined,
          );
        }
      } catch {
        // the handle is unreachable either way; the count error is the useful one
      }

      throw error;
    }
  }

  /** Runs the host close exactly once; safe to call from `close()` and from `defer`. */
  function* release(): Gen<null> {
    if (!state.markClosed()) return null;

    try {
      yield lift(options.close());
    } finally {
      // the slot is given back even when the host close failed: the resource is gone
      // either way, and leaking the count would be worse than leaking the handle
      if (counts) security.release(counts);
    }

    return null;
  }

  class Close extends FunctionBuilder {
    constructor(args: any[], astArgs: StmtType[], environment: Environment) {
      super(args, astArgs, environment);
    }

    get pkgInfo() {
      return pkg;
    }

    override *call(): Gen<null> {
      return yield release();
    }
  }

  const value: Record<string | symbol, any> = {
    ...(options.members ?? {}),

    close: Close,

    get closed() {
      return state.closed;
    },

    // `defer res = open(...)` releases it at the end of the block
    [Environment.SymbolDeferred]: Close,
  };

  // A getter, never a computed string: `describe` usually closes over the resource's own
  // state, which does not exist yet while this function is still running.
  Object.defineProperty(value, Environment.SymbolFormatedText, {
    get: () =>
      options.describe
        ? options.describe()
        : `${options.name} { closed: ${state.closed} }`,
    enumerable: true,
    configurable: true,
  });

  return { value, state };
}

export {
  createResource,
  ResourceState,
  ClosedResourceError,
  type ResourceOptions,
  type CloseResult,
};
