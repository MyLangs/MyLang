/**
 * The `symbol.dispose` protocol.
 *
 * A value is *disposable* when it carries a `symbol.dispose` member. `defer <expression>`
 * registers that member to be called when the enclosing block ends, whichever way it ends
 * (normal exit, `return`, `break`, `continue`, a thrown error, task cancellation).
 *
 * The disposer may be either kind of callable the language knows:
 *
 *   - a language function  (`[symbol.dispose]: func() { ... }`)
 *   - a native builder     (a `FunctionBuilder` subclass, as every built-in resource uses)
 *
 * Both are invoked here, so no caller has to care which one it got.
 */

import { Environment } from "../Environment";
import { BaseError } from "../errors/BaseError";
import { isSubclassOfByName } from "../utils/isSubclassOfByName";
import { lift, type Gen } from "./coroutine";

/** Does `value` carry a `symbol.dispose` member? */
function isDisposable(value: any): boolean {
  if (value === null || value === undefined) return false;

  if (typeof value !== "object" && typeof value !== "function") return false;

  return (
    (value as any)[Environment.SymbolDeferred] !== undefined &&
    (value as any)[Environment.SymbolDeferred] !== null
  );
}

/** The disposer of `value`, or `null` when it has none. */
function getDisposer(value: any): any {
  if (!isDisposable(value)) return null;

  return (value as any)[Environment.SymbolDeferred];
}

/**
 * Call the disposer of `resource`. Must be `yield`ed: disposing may suspend (closing a
 * socket, flushing a file) exactly like any other call.
 */
function* dispose(resource: any, environment: Environment): Gen<any> {
  const disposer = getDisposer(resource);

  if (disposer === null) return null;

  // a native resource: `class Close extends FunctionBuilder`
  if (
    typeof disposer === "function" &&
    isSubclassOfByName(disposer, "FunctionBuilder")
  ) {
    return yield lift(new disposer([resource], [], environment).call());
  }

  // a language function: `func() { ... }`
  if (typeof disposer?.call === "function") {
    return yield lift(disposer.call([{ value: resource }], environment));
  }

  throw new BaseError("symbol.dispose must be a function", { files: [] });
}

export { dispose, isDisposable, getDisposer };
