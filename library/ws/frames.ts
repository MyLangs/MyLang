/**
 * RFC 6455 frame encoding and decoding, shared by the WebSocket client and server.
 *
 * Kept apart from the library surface so that both ends use exactly the same codec: a bug
 * fixed here is fixed for both, and the two can always talk to each other.
 */

import { randomBytes } from "node:crypto";

/** The frame kinds this library handles. */
const OPCODES = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const;

type FrameKind = keyof typeof OPCODES;

interface Frame {
  kind: FrameKind;
  /** Payload bytes; text frames are decoded by the caller. */
  payload: Buffer;
  final: boolean;
}

/** A decoded frame plus how many bytes it consumed, or `null` when more data is needed. */
interface Decoded {
  frame: Frame;
  consumed: number;
}

function opcodeName(opcode: number): FrameKind | null {
  for (const [name, code] of Object.entries(OPCODES)) {
    if (code === opcode) return name as FrameKind;
  }

  return null;
}

/**
 * Encode one frame.
 *
 * `mask` must be true for frames a client sends and false for frames a server sends;
 * RFC 6455 requires exactly that, and peers close the connection when it is wrong.
 */
function encodeFrame(
  kind: FrameKind,
  payload: Buffer,
  mask: boolean,
  final = true,
): Buffer {
  const length = payload.length;
  const header: number[] = [];

  header.push((final ? 0x80 : 0) | OPCODES[kind]);

  const maskBit = mask ? 0x80 : 0;

  if (length < 126) {
    header.push(maskBit | length);
  } else if (length < 65536) {
    header.push(maskBit | 126, (length >> 8) & 0xff, length & 0xff);
  } else {
    header.push(maskBit | 127);

    // 64-bit length, big-endian; the top four bytes are always zero in practice
    const high = Math.floor(length / 2 ** 32);

    header.push(
      (high >> 24) & 0xff,
      (high >> 16) & 0xff,
      (high >> 8) & 0xff,
      high & 0xff,
      (length >> 24) & 0xff,
      (length >> 16) & 0xff,
      (length >> 8) & 0xff,
      length & 0xff,
    );
  }

  if (!mask) return Buffer.concat([Buffer.from(header), payload]);

  const maskKey = randomBytes(4);
  const masked = Buffer.allocUnsafe(length);

  for (let i = 0; i < length; i++) {
    masked[i] = payload[i]! ^ maskKey[i % 4]!;
  }

  return Buffer.concat([Buffer.from(header), maskKey, masked]);
}

/**
 * Decode the first frame in `buffer`.
 * Returns `null` when the buffer does not hold a complete frame yet.
 */
function decodeFrame(buffer: Buffer): Decoded | null {
  if (buffer.length < 2) return null;

  const first = buffer[0]!;
  const second = buffer[1]!;

  const final = (first & 0x80) !== 0;
  const kind = opcodeName(first & 0x0f);

  if (kind === null) {
    throw new Error(`unsupported WebSocket opcode 0x${(first & 0x0f).toString(16)}`);
  }

  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;

    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;

    const value = buffer.readBigUInt64BE(offset);

    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("WebSocket frame is larger than this runtime can address");
    }

    length = Number(value);
    offset += 8;
  }

  const maskKey = masked ? buffer.subarray(offset, offset + 4) : null;

  if (masked) offset += 4;

  if (buffer.length < offset + length) return null;

  const raw = buffer.subarray(offset, offset + length);
  const payload = Buffer.allocUnsafe(length);

  if (maskKey) {
    for (let i = 0; i < length; i++) {
      payload[i] = raw[i]! ^ maskKey[i % 4]!;
    }
  } else {
    raw.copy(payload);
  }

  return {
    frame: { kind, payload, final },
    consumed: offset + length,
  };
}

/** The payload of a close frame: a 2-byte code followed by an optional reason. */
function encodeClose(code: number, reason: string): Buffer {
  const text = Buffer.from(reason, "utf8");
  const payload = Buffer.allocUnsafe(2 + text.length);

  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);

  return payload;
}

function decodeClose(payload: Buffer): { code: number; reason: string } {
  if (payload.length < 2) return { code: 1005, reason: "" };

  return {
    code: payload.readUInt16BE(0),
    reason: payload.toString("utf8", 2),
  };
}

export {
  encodeFrame,
  decodeFrame,
  encodeClose,
  decodeClose,
  OPCODES,
  type Frame,
  type FrameKind,
};
