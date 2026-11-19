/**
 * Argument validation shared by every built-in library.
 *
 * Each library used to carry its own `validateString` / `validateNumber` / ... with the
 * same bodies and slightly different messages. They all funnel through here now, so the
 * wording of a type error is identical whichever library produced it.
 *
 * The functions take the builder (for `throwErrorFormatters`) and throw that library's
 * own error type, which keeps the file/package attribution intact.
 */

import { FunctionBuilderCodeError } from "../FunctionBuilder";
import { isTypeArgs } from "../utils/utils";
import { isBinaryLike, isEncoding, ENCODINGS } from "./buffers";

/** The part of a builder these helpers need; avoids a circular import of the class. */
interface Thrower {
  throwErrorFormatters(err: any, format?: Record<string, any>): Error;
}

function failType(
  builder: Thrower,
  name: string | undefined,
  expected: string,
  received: any,
): never {
  if (name === undefined) {
    throw builder.throwErrorFormatters(
      FunctionBuilderCodeError.ArgumentsFirstTypeError,
      { expectType: expected, received: isTypeArgs(received) },
    );
  }

  throw builder.throwErrorFormatters(
    FunctionBuilderCodeError.ArgumentsTypeError,
    { propsName: name, expectType: expected, received: isTypeArgs(received) },
  );
}

function assertString(builder: Thrower, value: any, name?: string): string {
  if (typeof value !== "string") failType(builder, name, "string", value);

  return value;
}

function assertNumber(builder: Thrower, value: any, name?: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    failType(builder, name, "number", value);
  }

  return value;
}

function assertInteger(builder: Thrower, value: any, name?: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    failType(builder, name, "integer", value);
  }

  return value;
}

function assertBoolean(builder: Thrower, value: any, name?: string): boolean {
  if (typeof value !== "boolean") failType(builder, name, "boolean", value);

  return value;
}

function assertArray(builder: Thrower, value: any, name?: string): any[] {
  if (!Array.isArray(value)) failType(builder, name, "array", value);

  return value;
}

function assertObject(
  builder: Thrower,
  value: any,
  name?: string,
): Record<string, any> {
  if (isTypeArgs(value) !== "object") failType(builder, name, "object", value);

  return value;
}

function assertFunction(builder: Thrower, value: any, name?: string): any {
  if (isTypeArgs(value) !== "function") {
    failType(builder, name, "function", value);
  }

  return value;
}

/** Anything `toBuffer` understands: bytes, a buffer, a byte array or a string. */
function assertBinary(builder: Thrower, value: any, name?: string): any {
  if (!isBinaryLike(value)) {
    failType(builder, name, "buffer, bytes or string", value);
  }

  return value;
}

function assertEncoding(
  builder: Thrower,
  value: any,
  name = "encoding",
): BufferEncoding {
  if (!isEncoding(value)) {
    throw builder.throwErrorFormatters(
      new Error(
        `Invalid ${name}: ${String(value)}. Supported: ${ENCODINGS.join(", ")}`,
      ),
    );
  }

  return value.toLowerCase() as BufferEncoding;
}

/** A port number usable by `tcp`, `udp`, `net/http` and `ws`. */
function assertPort(builder: Thrower, value: any, name = "port"): number {
  assertInteger(builder, value, name);

  if (value < 0 || value > 65535) {
    throw builder.throwErrorFormatters(
      new Error(`${name} must be between 0 and 65535, received ${value}`),
    );
  }

  return value;
}

/**
 * `f(x, cb)` / `f(x, options, cb)` / `f(x, options)`: decide which of the two trailing
 * arguments is the callback and which is the options object.
 */
function splitOptional(
  option: any,
  callback: any,
  fallback: any,
): [any, any] {
  if (isTypeArgs(option) === "function") return [fallback, option];

  return [
    option === undefined || option === null ? fallback : option,
    callback,
  ];
}

export {
  assertString,
  assertNumber,
  assertInteger,
  assertBoolean,
  assertArray,
  assertObject,
  assertFunction,
  assertBinary,
  assertEncoding,
  assertPort,
  splitOptional,
  failType,
  type Thrower,
};
