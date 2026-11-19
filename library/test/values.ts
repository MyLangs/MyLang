/**
 * Value formatting and strict deep equality used by the assertions.
 *
 * The language `==` is loose (`1 == "1"` is true), so assertions never use it: `deepEq`
 * compares types first and only treats `int` and `float` as the same family.
 */

import { Environment } from "../../src/Environment";
import { isTypeArgs } from "../utils/utils";
import { unwrapBuffer } from "../kernel/buffers";

const MAX_STRING = 160;
const MAX_ITEMS = 12;
const MAX_DEPTH = 4;

function isNumberType(type: string): boolean {
  return type === "int" || type === "float";
}

/** Readable one-line form of any language value, for failure messages. */
function show(value: any, depth = 0): string {
  const type = isTypeArgs(value);

  switch (type) {
    case "nil":
      return "nil";

    case "string": {
      const text = value as string;

      return text.length > MAX_STRING
        ? `"${text.slice(0, MAX_STRING)}…" (${text.length} chars)`
        : `"${text}"`;
    }

    case "int":
    case "float":
    case "boolean":
    case "nan":
    case "infinity":
      return String(value);

    case "bigint":
      return `${value}n`;

    case "error":
      return `<error ${value.message}>`;

    case "function":
      return `<function${value?.name ? " " + value.name : ""}>`;

    case "array": {
      if (depth > MAX_DEPTH) return "[...]";

      const items = (value as any[]).slice(0, MAX_ITEMS).map((item) => show(item, depth + 1));

      if (value.length > MAX_ITEMS) {
        items.push(`… ${value.length - MAX_ITEMS} more`);
      }

      return `[${items.join(", ")}]`;
    }

    case "object": {
      if (depth > MAX_DEPTH) return "{...}";

      const bytes = unwrapBuffer(value);

      if (bytes) return `bytes(${bytes.length})`;

      const keys = Object.keys(value);
      const items = keys
        .slice(0, MAX_ITEMS)
        .map((key) => `${key}: ${show(value[key], depth + 1)}`);

      if (keys.length > MAX_ITEMS) {
        items.push(`… ${keys.length - MAX_ITEMS} more`);
      }

      return `{${items.join(", ")}}`;
    }

    default:
      return `<${type}>`;
  }
}

/** Strict structural equality: same type family, same shape, same values. */
function deepEq(a: any, b: any, seen = new Map<any, any>()): boolean {
  const typeA = isTypeArgs(a);
  const typeB = isTypeArgs(b);

  if (isNumberType(typeA) && isNumberType(typeB)) return a === b;

  if (typeA !== typeB) return false;

  if (typeA === "nan") return true;

  if (typeA === "array") {
    if (a.length !== b.length) return false;

    if (seen.get(a) === b) return true;
    seen.set(a, b);

    for (let i = 0; i < a.length; i++) {
      if (!deepEq(a[i], b[i], seen)) return false;
    }

    return true;
  }

  if (typeA === "object") {
    const bytesA = unwrapBuffer(a);
    const bytesB = unwrapBuffer(b);

    if (bytesA || bytesB) {
      if (!bytesA || !bytesB) return false;
      if (bytesA.length !== bytesB.length) return false;

      for (let i = 0; i < bytesA.length; i++) {
        if (bytesA[i] !== bytesB[i]) return false;
      }

      return true;
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    if (seen.get(a) === b) return true;
    seen.set(a, b);

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEq(a[key], b[key], seen)) return false;
    }

    return true;
  }

  if (typeA === "error") return a.message === b.message;

  return a === b;
}

/** The message of a thrown value, whatever its kind. */
function errorText(error: any): string {
  if (isTypeArgs(error) === "error") return String(error.message);

  return show(error);
}

/** `name: message` for an error, `threw <value>` for anything else. */
function describeThrown(error: any): string {
  if (isTypeArgs(error) === "error") {
    if (error.name === "AssertionError") return String(error.message);

    return `${error.name}: ${error.message}`;
  }

  return `threw ${show(error)}`;
}

/** The language `in`/`includes` semantics used by `assert.includes`. */
function contains(container: any, item: any): boolean | null {
  const type = isTypeArgs(container);

  if (type === "string") return (container as string).includes(String(item));

  if (type === "array") {
    return (container as any[]).some((element) => deepEq(element, item));
  }

  if (type === "object") {
    return Object.prototype.hasOwnProperty.call(container, String(item));
  }

  return null;
}

export {
  show,
  deepEq,
  errorText,
  describeThrown,
  contains,
  isNumberType,
  Environment,
};
