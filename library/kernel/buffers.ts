/**
 * The one place where binary data is converted between the language and the host.
 *
 * Every library that moves bytes around (`fs`, `bytes`, `crypto`, `compress`, `archive`,
 * `binary`, `tcp`, `udp`, `ws`, `fs/stream`, `net/http`) uses these helpers instead of
 * carrying its own copy, so a `bytes` value produced by one library is always understood
 * by every other one.
 */

import { Environment } from "../../src/Environment";

type BinaryLike =
  | string
  | Buffer
  | Uint8Array
  | ArrayBuffer
  | number[]
  | { [Environment.SymbolBuffer]?: Buffer | Uint8Array }
  | null
  | undefined;

/** True for anything `toBuffer` accepts without throwing. */
function isBinaryLike(value: any): boolean {
  if (value === null || value === undefined) return false;

  return (
    typeof value === "string" ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    Array.isArray(value) ||
    value?.[Environment.SymbolBuffer] instanceof Uint8Array
  );
}

/** The raw view behind a language `bytes` value, or `null` when it is not one. */
function unwrapBuffer(value: any): Uint8Array | null {
  const buffer = value?.[Environment.SymbolBuffer];

  return buffer instanceof Uint8Array ? buffer : null;
}

/**
 * Have these bytes been handed over to a worker?
 *
 * `post(value, { transfer: true })` gives the memory away rather than copying it, which
 * leaves this side holding a view onto nothing. The host reports that as an obscure error
 * about a detached buffer the first time anything touches it, so this is checked up front
 * and said plainly instead.
 */
function isHandedOver(binary: Uint8Array): boolean {
  return binary.byteLength === 0 && binary.buffer.byteLength === 0;
}

/**
 * Normalise any binary-ish value to a Node `Buffer`.
 * Throws a plain `TypeError`; callers wrap it in their own library error.
 */
function toBuffer(value: BinaryLike, encoding: BufferEncoding = "utf8"): Buffer {
  if (value === null || value === undefined) return Buffer.alloc(0);

  const unwrapped = unwrapBuffer(value);

  if (unwrapped) {
    return Buffer.from(
      unwrapped.buffer,
      unwrapped.byteOffset,
      unwrapped.byteLength,
    );
  }

  if (Buffer.isBuffer(value)) return value;

  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }

  if (value instanceof ArrayBuffer) return Buffer.from(value);

  if (typeof value === "string") return Buffer.from(value, encoding);

  if (Array.isArray(value)) return Buffer.from(value as number[]);

  throw new TypeError(
    "expected bytes, a buffer, an array of byte values or a string",
  );
}

/**
 * Wrap host bytes in the language's `bytes` value.
 * Lazily required: `library/bytes/Bytes` imports the builder stack, which imports this file.
 */
function toBytes(value: BinaryLike, environment: Environment): any {
  const { Bytes } =
    require("../bytes/Bytes") as typeof import("../bytes/Bytes");

  return new Bytes([toBuffer(value)], [], environment).call();
}

/** `"utf8"`, `"hex"`, `"base64"`... validated against what Node actually supports. */
const ENCODINGS: readonly string[] = [
  "utf8",
  "utf-8",
  "ascii",
  "latin1",
  "binary",
  "hex",
  "base64",
  "base64url",
  "ucs2",
  "ucs-2",
  "utf16le",
];

function isEncoding(value: any): value is BufferEncoding {
  return typeof value === "string" && ENCODINGS.includes(value.toLowerCase());
}

export {
  toBuffer,
  toBytes,
  unwrapBuffer,
  isHandedOver,
  isBinaryLike,
  isEncoding,
  ENCODINGS,
  type BinaryLike,
};
