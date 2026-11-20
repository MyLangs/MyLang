import { Environment } from "../Environment";

/**
 * Strict structural equality: the meaning of `==` / `!=` and of `case` in `match`.
 *
 * - Values of different kinds are never equal: `1 == "1"`, `0 == false`, `nil == 0`,
 *   `[1] == ["1"]` are all false. `int` and `float` are one family (`1 == 1.0`), `bigint` is
 *   its own (`10n == 10` is false).
 * - `nan == nan` is true.
 * - Arrays: same length, same items in order. Objects: same set of keys (order does not
 *   matter), same values. `bytes`: same content.
 * - A struct instance equals another of the same struct with equal fields. Its methods are
 *   per-instance objects and are not compared.
 * - Functions and every other host object are equal to themselves only.
 * - Cycles are fine: a pair already being compared is taken as equal.
 *
 * It never throws and allocates nothing for the common case (two primitives).
 */

type Visited = Map<object, Set<object>>;

function unwrapEnumThis(value: any): any {
  if (value?.[Environment.SymbolEnumThis]) {
    const member = Object.values(value).find(
      (item) => item !== null && item !== undefined,
    );

    return member ?? value;
  }

  return value;
}

function isPlainLike(value: object): boolean {
  const proto = Object.getPrototypeOf(value);

  return proto === null || proto === Object.prototype;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

function deepEqualObjects(a: any, b: any, visited: Visited): boolean {
  let partners = visited.get(a);

  if (partners?.has(b)) return true;

  if (partners === undefined) visited.set(a, (partners = new Set()));

  partners.add(b);

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;

    for (let i = 0; i < a.length; i++) {
      if (!equal(a[i], b[i], visited)) return false;
    }

    return true;
  }

  if (Array.isArray(b)) return false;

  const bytesA = a[Environment.SymbolBuffer];
  const bytesB = b[Environment.SymbolBuffer];

  if (bytesA instanceof Uint8Array || bytesB instanceof Uint8Array) {
    return (
      bytesA instanceof Uint8Array &&
      bytesB instanceof Uint8Array &&
      sameBytes(bytesA, bytesB)
    );
  }

  const structA = a[Environment.SymbolStruct] === true;
  const structB = b[Environment.SymbolStruct] === true;

  if (structA || structB) {
    if (!structA || !structB) return false;

    if (a[Environment.SymbolStructType] !== b[Environment.SymbolStructType]) {
      return false;
    }

    const dataA = a[Environment.SymbolStructData];
    const dataB = b[Environment.SymbolStructData];

    if (dataA === undefined || dataB === undefined) return false;

    return equal(dataA, dataB, visited);
  }

  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }

  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size)
      return false;

    for (const [key, value] of a) {
      if (!b.has(key) || !equal(value, b.get(key), visited)) return false;
    }

    return true;
  }

  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size)
      return false;

    for (const item of a) {
      if (!b.has(item)) return false;
    }

    return true;
  }

  if (a instanceof Error || b instanceof Error) {
    return (
      a instanceof Error &&
      b instanceof Error &&
      a.name === b.name &&
      a.message === b.message
    );
  }

  if (!(isPlainLike(a) && isPlainLike(b))) {
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;

    if (!isPlainLike(a)) return false;
  }

  const keysA = Object.keys(a);

  if (keysA.length !== Object.keys(b).length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;

    if (!equal(a[key], b[key], visited)) return false;
  }

  return true;
}

function equal(a: any, b: any, visited: Visited): boolean {
  if (a === b) return true;

  const typeA = typeof a;

  if (a === null || a === undefined) return b === null || b === undefined;

  if (b === null || b === undefined) return false;

  if (typeA !== typeof b) {
    if (typeA === "object" || typeof b === "object") {
      const left = unwrapEnumThis(a);
      const right = unwrapEnumThis(b);

      if (left !== a || right !== b) return equal(left, right, visited);
    }

    return false;
  }

  if (typeA === "number") return a !== a && b !== b;

  if (typeA !== "object") return false;

  const left = unwrapEnumThis(a);
  const right = unwrapEnumThis(b);

  if (left !== a || right !== b) return equal(left, right, visited);

  return deepEqualObjects(a, b, visited);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (
    typeof a !== "object" &&
    typeof b !== "object" &&
    a != null &&
    b != null
  ) {
    return typeof a === "number" && typeof b === "number" && a !== a && b !== b;
  }

  return equal(a, b, new Map());
}

export { deepEqual, unwrapEnumThis };
