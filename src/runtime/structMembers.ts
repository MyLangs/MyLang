/**
 * Access rules for struct members.
 *
 * MyLang2 structs have no inheritance, so visibility is a flat, two-case question:
 *
 *   private  the member exists only for code running inside a method of the same struct
 *            type. It lives on the instance like any other field, but every read, write,
 *            `in` check and `for ... in` from outside behaves as if it were not there.
 *
 *   static   the member belongs to the struct *type*, not to an instance. It is created
 *            once, when the `struct` declaration is evaluated, and is reached through the
 *            type name (`Counter.created`). Instances never carry it.
 *
 * "Inside a method of the same type" is decided by the task's struct stack, which the
 * function call pushes when it enters a struct method (see `FunctionDeclaration.call`).
 * Capturing the instance in a local (`var self = this`) therefore keeps working inside the
 * struct and stays blocked outside it, which a purely syntactic `this.x` rule could not do.
 */

import { Environment } from "../Environment";
import { BaseError } from "../errors/BaseError";

/** Per-member flags collected by the parser. */
interface MemberModifiers {
  private: boolean;
  static: boolean;
}

/** Declared modifiers of a struct, keyed by member name. */
type StructModifiers = Record<string, MemberModifiers>;

/**
 * A member of a struct whose name is a language symbol rather than an identifier:
 *
 *     struct Report {
 *       func [symbol.dispose]() { ... }
 *     }
 *
 * `key` is the expression inside the brackets; it is evaluated once per instance, when
 * the instance is built, and must come out as one of `LANGUAGE_SYMBOL_NAMES` below.
 * `method` is the function itself, named `[symbol.dispose]` for stack traces.
 */
interface StructSymbolMethod {
  key: { evaluate(score: Environment): any };
  method: any;
}

/**
 * The symbols a struct member may be named after, by the member's effect. Only the
 * language's own protocol symbols qualify: a struct cannot hide arbitrary data behind a
 * symbol key, which would be invisible to `for ... in`, `objects.keys` and `json`.
 */
const LANGUAGE_SYMBOL_NAMES: ReadonlyMap<symbol, string> = new Map([
  [Environment.SymbolDeferred, "symbol.dispose"],
  [Environment.SymbolIterator, "symbol.iterator"],
]);

/** Is `value` a symbol a struct member may be named after? */
function isLanguageSymbol(value: unknown): value is symbol {
  return typeof value === "symbol" && LANGUAGE_SYMBOL_NAMES.has(value);
}

/** `symbol.dispose` for the dispose symbol, and so on. */
function languageSymbolName(value: symbol): string {
  return LANGUAGE_SYMBOL_NAMES.get(value) ?? String(value);
}

function noModifiers(): MemberModifiers {
  return { private: false, static: false };
}

/** Is `value` an instance created from a struct type? */
function isStructInstance(value: any): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    value[Environment.SymbolStruct] === true
  );
}

/** The private member names of an instance (empty when it has none). */
function privateNames(instance: any): ReadonlySet<string> {
  const names = instance?.[Environment.SymbolStructPrivate];

  return names instanceof Set ? names : EMPTY;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * May the code running right now reach `key` on `target`?
 * `true` for anything that is not a private struct member.
 */
function canAccessMember(target: any, key: unknown): boolean {
  if (typeof key !== "string") return true;

  if (!isStructInstance(target)) return true;

  if (!privateNames(target).has(key)) return true;

  // lazily required: Runtime imports the AST, which imports this module
  const { runtime } = require("./Runtime") as typeof import("./Runtime");

  return runtime.isInsideStruct(target[Environment.SymbolStructType]);
}

/** Throw unless `key` is reachable on `target` from the current code. */
function assertMemberAccess(target: any, key: unknown, action = "read"): void {
  if (canAccessMember(target, key)) return;

  const typeName = target?.[Environment.SymbolStructType]?.name;

  throw new BaseError(
    `Cannot ${action} private member '${String(key)}'` +
      (typeName ? ` of struct '${typeName}'` : "") +
      " from outside the struct",
  );
}

/** The names a `for key in instance` loop may see. */
function visibleKeys(instance: any, keys: string[]): string[] {
  if (!isStructInstance(instance)) return keys;

  const hidden = privateNames(instance);

  if (hidden.size === 0) return keys;

  // lazily required, as above
  const { runtime } = require("./Runtime") as typeof import("./Runtime");

  if (runtime.isInsideStruct(instance[Environment.SymbolStructType])) {
    return keys;
  }

  return keys.filter((key) => !hidden.has(key));
}

/**
 * The static store of a struct type. Statics are held on the evaluated type node, so every
 * instance and every `TypeName.member` access sees the same values.
 */
function staticsOf(structType: any): Record<string, any> {
  if (!structType) return {};

  if (!structType.statics) structType.statics = Object.create(null);

  return structType.statics;
}

function hasStatic(structType: any, key: unknown): boolean {
  if (typeof key !== "string" || !structType) return false;

  return Object.prototype.hasOwnProperty.call(staticsOf(structType), key);
}

export {
  isStructInstance,
  canAccessMember,
  assertMemberAccess,
  visibleKeys,
  privateNames,
  staticsOf,
  hasStatic,
  noModifiers,
  isLanguageSymbol,
  languageSymbolName,
  LANGUAGE_SYMBOL_NAMES,
  type MemberModifiers,
  type StructModifiers,
  type StructSymbolMethod,
};
