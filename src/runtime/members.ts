/**
 * Native member access.
 *
 * Interpreted code must never be able to see or reach JavaScript: not `Function`,
 * not prototype methods (`"x".toUpperCase`, `[].push`, `{}.hasOwnProperty`), not
 * `constructor` / `__proto__`, not host objects (Node `Buffer`, `Date`, servers, the
 * environment, AST nodes...).
 *
 * Instead of letting the engine resolve `value[key]` (which walks the JS prototype
 * chain), every member read / write / `in` check of the language goes through this
 * module, which resolves members *by hand*:
 *
 *   - language values (plain objects, arrays, strings, errors) expose only their OWN
 *     properties - the prototype chain is never consulted;
 *   - built-in host types that the language may legitimately see (typed arrays, Map, Set,
 *     Date...) expose exactly the members listed in `NATIVE_TYPES`, implemented here;
 *   - function / struct values expose only `name`;
 *   - every other host object is opaque: it has no members at all;
 *   - the only symbol keys language code may use are the language's own protocol symbols.
 */

import { BaseError } from "../errors/BaseError";
import { Environment } from "../Environment";
import { StmtType } from "../ast/StmtType";
import { isSubclassOfByName } from "../utils/isSubclassOfByName";
import {
  canAccessMember,
  visibleKeys,
  hasStatic,
  staticsOf,
} from "./structMembers";

type MemberKey = string | number | symbol;

/** Names that interpreted code may never read or write, whatever the target is. */
const FORBIDDEN_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "eval",
  "Function",
  "require",
  "process",
  "global",
  "window",
]);

/** The prototype-pollution trio (plus the `__` prefix) can never be *written*. */
const FORBIDDEN_WRITE_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** Symbols that are part of the language's own protocols (`symbol.iterator`, `symbol.dispose`). */
const LANGUAGE_SYMBOLS: ReadonlySet<symbol> = new Set([
  Environment.SymbolIterator,
  Environment.SymbolDeferred,
]);

const hasOwn = (target: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

/** Description of a built-in host type and the members the language may see on it. */
interface NativeType {
  test(value: any): boolean;
  /** named members, e.g. `length` */
  members?: Record<string, (value: any) => any>;
  /** integer-indexed access, e.g. `typedArray[3]` */
  index?: (value: any, index: number) => any;
  /** number of valid indices (used to bound-check `index`) */
  size?: (value: any) => number;
}

const NATIVE_TYPES: NativeType[] = [
  {
    // Buffer / Uint8Array / Float64Array ...
    test: (value) => ArrayBuffer.isView(value) && !(value instanceof DataView),
    members: {
      length: (value) => value.length,
      byteLength: (value) => value.byteLength,
    },
    index: (value, index) => value[index],
    size: (value) => value.length,
  },
  {
    test: (value) => value instanceof Map || value instanceof Set,
    members: { size: (value) => value.size },
  },
  {
    test: (value) => value instanceof Date,
  },
];

/** Let a library describe a host type the language may see. Everything else stays opaque. */
function registerNativeType(type: NativeType): void {
  NATIVE_TYPES.push(type);
}

type Kind =
  | "primitive"
  | "string"
  | "array"
  | "error"
  | "plain"
  | "node"
  | "native"
  | "opaque";

function classify(target: any): { kind: Kind; native?: NativeType } {
  switch (typeof target) {
    case "string":
      return { kind: "string" };
    case "number":
    case "bigint":
    case "boolean":
    case "symbol":
    case "undefined":
      return { kind: "primitive" };
    case "function":
      // native language functions (FunctionBuilder classes) and raw JS functions: no members
      return { kind: "opaque" };
  }

  if (target === null) return { kind: "primitive" };
  if (Array.isArray(target)) return { kind: "array" };
  if (target instanceof Error) return { kind: "error" };
  if (target instanceof StmtType) return { kind: "node" };

  const proto = Object.getPrototypeOf(target);

  if (proto === Object.prototype || proto === null) return { kind: "plain" };

  for (const native of NATIVE_TYPES) {
    if (native.test(target)) return { kind: "native", native };
  }

  return { kind: "opaque" };
}

/** `5n`, `"x"`, `3` are fine; other primitives are stringified; foreign symbols are rejected. */
function normalizeKey(key: unknown): MemberKey | undefined {
  switch (typeof key) {
    case "string":
    case "number":
      return key;
    case "bigint":
      return String(key);
    case "symbol":
      if (LANGUAGE_SYMBOLS.has(key)) return key;
      throw new BaseError("Access to symbol property is not allowed");
    case "undefined":
      return undefined;
    default:
      return key === null ? undefined : String(key);
  }
}

function isIndexKey(key: MemberKey): key is number | string {
  if (typeof key === "number") return Number.isInteger(key) && key >= 0;
  return typeof key === "string" && /^(0|[1-9]\d*)$/.test(key);
}

function assertReadable(key: MemberKey): void {
  if (typeof key !== "string") return;

  if (FORBIDDEN_NAMES.has(key) || key.startsWith("__")) {
    throw new BaseError(`Access to property '${key}' is not allowed`);
  }
}

function assertWritable(key: MemberKey): void {
  if (typeof key !== "string") return;

  if (FORBIDDEN_WRITE_NAMES.has(key) || key.startsWith("__")) {
    throw new Error(`Access to property '${key}' is not allowed`);
  }
}

/** A value may leave `getMember` only if it is not a raw JavaScript function. */
function guardValue(value: any, key: MemberKey): any {
  if (
    typeof value === "function" &&
    !isSubclassOfByName(value, "FunctionBuilder")
  ) {
    throw new BaseError(`Access to function '${String(key)}' is not allowed`);
  }

  return value;
}

/**
 * Read `target[key]` natively. Returns `undefined` when the member does not exist
 * (or when the target has no accessible members). Throws for forbidden names / symbols.
 */
function getMember(target: any, rawKey: unknown): any {
  const key = normalizeKey(rawKey);

  if (key === undefined) return undefined;

  assertReadable(key);

  // A `private` struct member simply does not exist for code outside its struct.
  // `MemberExpression` checks access separately so it can report a precise reason.
  if (!canAccessMember(target, key)) return undefined;

  const { kind, native } = classify(target);

  switch (kind) {
    case "primitive":
    case "opaque":
      return undefined;

    case "node":
      // Functions and struct types reveal their name; a struct type additionally
      // reveals its `static` members, which belong to the type rather than to an
      // instance. Everything else about an AST node stays invisible.
      if (key === "name" && hasOwn(target, "name")) return target.name;

      if (hasStatic(target, key)) return staticsOf(target)[key as string];

      return undefined;

    case "native": {
      if (
        typeof key === "string" &&
        native!.members &&
        hasOwn(native!.members, key)
      ) {
        return guardValue(native!.members[key]!(target), key);
      }

      if (native!.index && isIndexKey(key)) {
        const index = Number(key);

        if (index < (native!.size?.(target) ?? 0))
          return native!.index(target, index);
      }

      return undefined;
    }

    case "error":
      // `name` lives on the prototype of every error class: expose it natively, as text only
      if (key === "name" && !hasOwn(target, "name")) return String(target.name);

      return hasOwn(target, key) ? guardValue(target[key], key) : undefined;

    // string, array, plain: OWN properties only. The prototype chain is never read,
    // so `"x".toUpperCase`, `[].push`, `{}.toString` simply do not exist.
    default:
      return hasOwn(target, key) ? guardValue(target[key], key) : undefined;
  }
}

/** Like `getMember`, but never throws: inaccessible members are just `undefined`. */
function lookupMember(target: any, rawKey: unknown): any {
  try {
    return getMember(target, rawKey);
  } catch (error) {
    if (error instanceof BaseError) return undefined;
    throw error;
  }
}

/** The language `in` operator: does `target` have a member called `key`? */
function hasMember(target: any, rawKey: unknown): boolean {
  const key = normalizeKey(rawKey);

  if (key === undefined) return false;

  // a `private` struct member does not exist for code outside its struct
  if (!canAccessMember(target, key)) return false;

  const { kind, native } = classify(target);

  switch (kind) {
    case "primitive":
    case "opaque":
      return false;

    case "node":
      return (
        (key === "name" && hasOwn(target, "name")) || hasStatic(target, key)
      );

    case "error":
      return key === "name" || hasOwn(target, key);

    case "native":
      return (
        (typeof key === "string" &&
          !!native!.members &&
          hasOwn(native!.members, key)) ||
        (!!native!.index &&
          isIndexKey(key) &&
          Number(key) < (native!.size?.(target) ?? 0))
      );

    default:
      return hasOwn(target, key);
  }
}

/** Own, enumerable, string keys that the language is allowed to see (`for k in obj`). */
function memberKeys(target: any): string[] {
  const { kind } = classify(target);

  if (
    kind !== "plain" &&
    kind !== "array" &&
    kind !== "error" &&
    kind !== "string"
  )
    return [];

  // `private` struct members are left out unless the struct's own code is iterating
  return visibleKeys(
    target,
    Object.keys(target).filter(
      (key) => !FORBIDDEN_NAMES.has(key) && !key.startsWith("__"),
    ),
  );
}

/**
 * Write `target[key] = value` natively. Only the language's own containers (plain
 * objects and arrays) are writable; the prototype can never be reached or replaced.
 */
function setMember(target: any, rawKey: unknown, value: any): void {
  const key = normalizeKey(rawKey);

  if (key === undefined) {
    throw new Error("Invalid property key");
  }

  assertWritable(key);

  const { kind } = classify(target);

  if (kind !== "plain" && kind !== "array" && kind !== "error") {
    throw new Error(`Cannot assign property '${String(key)}' on this value`);
  }

  if (
    typeof value === "function" &&
    !isSubclassOfByName(value, "FunctionBuilder")
  ) {
    throw new Error(`Access to function '${String(key)}' is not allowed`);
  }

  target[key] = value;
}

/**
 * Create / replace an own data property without ever invoking the `__proto__` setter.
 * Used when the interpreter builds language objects (object literals, module exports).
 */
function defineMember(target: object, key: MemberKey, value: any): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

export {
  defineMember,
  assertWritable as assertWritableKey,
  getMember,
  lookupMember,
  hasMember,
  memberKeys,
  setMember,
  registerNativeType,
  type NativeType,
  type MemberKey,
};
