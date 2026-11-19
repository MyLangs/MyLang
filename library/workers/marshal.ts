/**
 * Getting values across a worker boundary.
 *
 * The host copies a message with structured clone, which handles plain data but not a
 * MyLang value that carries methods: a `bytes` value holds its own member classes, and a
 * class cannot be cloned, so sending one used to fail outright. These two functions make
 * the crossing explicit - binary is reduced to its raw bytes on the way out and rebuilt
 * on the way in, so what the other side receives is a `bytes` value again rather than a
 * shape that merely looks like one.
 *
 * Binary can also be *transferred* rather than copied. A transfer hands the memory over
 * instead of duplicating it, which is what makes passing a large buffer to a worker cheap,
 * but the sender's copy is emptied in the process. That is a surprise worth asking for, so
 * it only happens when the caller passes `{ transfer: true }`; the default stays a copy.
 *
 * A transfer is also refused quietly - as a copy - for a value that does not own its whole
 * block of memory, because the host pools small allocations and handing over a pooled block
 * would empty unrelated values with it. So `{ transfer: true }` is a request, not a
 * guarantee: it is honoured where it saves something and ignored where it would be unsafe.
 */

import { unwrapBuffer, toBytes } from "../kernel/buffers";
import { type Environment } from "../../src/Environment";

/**
 * Replace a handed-over value's members with one explanation.
 *
 * Its memory now belongs to the other thread, so every member that would read the bytes
 * is looking at nothing. Reporting that once, from whichever member is called, beats
 * each one quietly answering as if the value were empty. Only the value that was
 * actually transferred is touched, so an ordinary `bytes` value carries none of this.
 *
 * The members are replaced rather than hidden: a member that disappears is reported as an
 * unknown function, which says nothing about what happened to it.
 */
function markHandedOver(value: any): void {
  const { FunctionBuilder } =
    require("../FunctionBuilder") as typeof import("../FunctionBuilder");

  class HandedOver extends FunctionBuilder {
    get pkgInfo() {
      return { name: "workers", path: __dirname };
    }

    call(): never {
      throw this.throwErrorFormatters(
        new Error(
          "these bytes were handed to a worker with { transfer: true }, so they are no " +
            "longer available here. Post them without transfer if this side still " +
            "needs them.",
        ),
      );
    }
  }

  for (const key of Object.keys(value)) {
    try {
      if (typeof value[key] === "function") {
        value[key] = HandedOver;
      } else if (typeof value[key] === "number") {
        // a size that is no longer here reads as nothing left
        value[key] = 0;
      }
    } catch {
      // a member that cannot be replaced keeps reading the emptied memory, which the
      // shared accessor in `bytes` reports anyway
    }
  }
}

/** Marks binary inside a message, so the other side knows to rebuild it. */
const BINARY_MARK = "__mylang_bytes__";

interface Marshalled {
  /** The message, with every binary value reduced to a marker. */
  value: any;
  /** Buffers to hand over rather than copy; empty unless a transfer was asked for. */
  transfer: ArrayBuffer[];
}

/**
 * Prepare a value for `postMessage`.
 *
 * Walks the value once, replacing binary with `{[BINARY_MARK]: Uint8Array}`. With
 * `transfer`, each buffer's memory is listed for handover instead of being copied, which
 * leaves the sender's own `bytes` empty - the caller asked for that by passing the flag.
 */
function marshal(value: any, transfer = false): Marshalled {
  const handover: ArrayBuffer[] = [];
  const seen = new Map<any, any>();

  const walk = (current: any): any => {
    if (current === null || current === undefined) return null;

    if (typeof current !== "object") {
      // a function cannot cross; everything else scalar copies as it is
      return typeof current === "function" ? null : current;
    }

    const already = seen.get(current);

    if (already !== undefined) return already;

    const binary = unwrapBuffer(current);

    if (binary !== null) {
      // Handing over memory is only safe when this value owns all of it. The host
      // allocates small buffers out of a shared pool, so several unrelated values can
      // sit in one block: transferring that block would empty them too. A value that
      // spans its whole buffer is its own, and a value that does not is small enough
      // that copying it costs nothing worth saving.
      const owned =
        binary.byteOffset === 0 &&
        binary.byteLength === binary.buffer.byteLength;

      if (transfer && owned) {
        handover.push(binary.buffer as ArrayBuffer);
        markHandedOver(current);

        return { [BINARY_MARK]: binary };
      }

      return { [BINARY_MARK]: new Uint8Array(binary) };
    }

    if (Array.isArray(current)) {
      const out: any[] = [];

      seen.set(current, out);

      for (const item of current) out.push(walk(item));

      return out;
    }

    const out: Record<string, any> = {};

    seen.set(current, out);

    for (const key of Object.keys(current)) {
      const member = current[key];

      // a member class is part of the value's interface, not its data
      if (typeof member === "function") continue;

      out[key] = walk(member);
    }

    return out;
  };

  return { value: walk(value), transfer: handover };
}

/**
 * Rebuild a received message, turning every marker back into a `bytes` value.
 *
 * `environment` is needed because `bytes` is a language value: it has to be built in the
 * interpreter that will use it, not in the one that sent it.
 */
function unmarshal(value: any, environment: Environment): any {
  if (value === null || value === undefined) return null;

  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => unmarshal(item, environment));
  }

  const binary = (value as Record<string, any>)[BINARY_MARK];

  if (binary !== undefined) return toBytes(binary, environment);

  const out: Record<string, any> = {};

  for (const key of Object.keys(value)) {
    out[key] = unmarshal(value[key], environment);
  }

  return out;
}

export { marshal, unmarshal, BINARY_MARK, type Marshalled };
