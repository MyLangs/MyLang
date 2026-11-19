/**
 * The kernel shared by every built-in library.
 *
 * It holds the pieces that used to be copied from library to library: binary conversion,
 * argument validation, non-blocking host bridges, owned-resource plumbing and the
 * permission checks. A library should reach for these instead of re-implementing them, so
 * that a value produced by one library (a `bytes`, a closable handle) is understood by all
 * the others.
 */

export {
  toBuffer,
  toBytes,
  unwrapBuffer,
  isBinaryLike,
  isEncoding,
  ENCODINGS,
  type BinaryLike,
} from "./buffers";

export {
  createResource,
  ResourceState,
  ClosedResourceError,
  type ResourceOptions,
} from "./resource";

export {
  fromCallback,
  fromEvent,
  collectStream,
  writeStream,
  type NodeCallback,
  type EmitterLike,
} from "./async";

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
} from "./validate";

export { security } from "../../src/security";
export type { PermissionKind } from "../../src/security";
