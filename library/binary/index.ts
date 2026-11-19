/**
 * `binary` - reading and writing structured binary data.
 *
 * `bytes` holds binary data; `binary` gives it a cursor and typed accessors, which is what
 * parsing a file header or framing a network message actually needs:
 *
 *     var r = binary.reader(data);          // big-endian by default
 *     var magic = r.string(4);
 *     var version = r.u16();
 *
 *     var w = binary.writer();
 *     w.string("MLNG").u16(1).u32(length(payload)).bytes(payload);
 *     tcp.write(socket, w.build());
 *
 * Everything here is pure computation: no permissions, nothing to wait for, no resources
 * to release. Values come in and go out as the shared `bytes` value, so a buffer produced
 * here can be handed straight to `fs`, `crypto`, `compress`, `tcp`, `udp` or `ws`.
 */

import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { toBuffer } from "../kernel/buffers";

const PKG = { name: "binary", path: __dirname };

type Endian = "be" | "le";

abstract class BinaryMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return PKG;
  }

  protected assertEndian(value: any, fallback: Endian = "be"): Endian {
    if (value === undefined || value === null) return fallback;

    const text = String(value).toLowerCase();

    if (text !== "be" && text !== "le") {
      throw this.throwErrorFormatters(
        new Error(`endianness must be "be" or "le", received "${value}"`),
      );
    }

    return text;
  }

  call(): any {
    throw new Error("Call is not implemented");
  }
}

/** Shared cursor state of a reader. */
interface ReaderState {
  buffer: Buffer;
  offset: number;
  endian: Endian;
}

/** Shared state of a writer. */
interface WriterState {
  chunks: Buffer[];
  length: number;
  endian: Endian;
}

/**
 * `binary.reader(source, endian)` - a cursor over binary data.
 * Every read advances the cursor and fails loudly past the end, so a truncated message is
 * reported where it happens instead of silently producing zeros.
 */
class Reader extends BinaryMethodBuilder {
  override call() {
    const [source, endian] = this.args;

    const state: ReaderState = {
      buffer: this.toBuffer(source),
      offset: 0,
      endian: this.assertEndian(endian),
    };

    const self = this;

    /** Bounds-check and advance. */
    function take(builder: BinaryMethodBuilder, size: number): number {
      if (state.offset + size > state.buffer.length) {
        throw builder.throwErrorFormatters(
          new Error(
            `read past the end: needed ${size} byte(s) at offset ${state.offset} of ${state.buffer.length}`,
          ),
        );
      }

      const at = state.offset;
      state.offset += size;

      return at;
    }

    /** A fixed-width numeric read, named by its Buffer method pair. */
    const number = (size: number, be: string, le: string) =>
      class extends BinaryMethodBuilder {
        override call() {
          const at = take(this, size);
          const method = state.endian === "be" ? be : le;

          return (state.buffer as any)[method](at, size);
        }
      };

    /** Buffer's 64-bit readers take no byte count. */
    const bigNumber = (size: number, be: string, le: string) =>
      class extends BinaryMethodBuilder {
        override call() {
          const at = take(this, size);
          const method = state.endian === "be" ? be : le;

          return (state.buffer as any)[method](at);
        }
      };

    return {
      u8: class extends BinaryMethodBuilder {
        override call() {
          return state.buffer.readUInt8(take(this, 1));
        }
      },

      i8: class extends BinaryMethodBuilder {
        override call() {
          return state.buffer.readInt8(take(this, 1));
        }
      },

      u16: number(2, "readUIntBE", "readUIntLE"),
      i16: number(2, "readIntBE", "readIntLE"),
      u32: number(4, "readUIntBE", "readUIntLE"),
      i32: number(4, "readIntBE", "readIntLE"),

      u64: bigNumber(8, "readBigUInt64BE", "readBigUInt64LE"),
      i64: bigNumber(8, "readBigInt64BE", "readBigInt64LE"),

      f32: bigNumber(4, "readFloatBE", "readFloatLE"),
      f64: bigNumber(8, "readDoubleBE", "readDoubleLE"),

      /** `bytes(n)` - the next `n` bytes, or the rest when `n` is omitted. */
      bytes: class extends BinaryMethodBuilder {
        override call() {
          const [count] = this.args;
          const size =
            count === undefined || count === null
              ? state.buffer.length - state.offset
              : this.assertInteger(count, "count");

          const at = take(this, size);

          return this.toBytes(state.buffer.subarray(at, at + size));
        }
      },

      /** `string(n, encoding)` - `n` bytes decoded as text ("utf8" by default). */
      string: class extends BinaryMethodBuilder {
        override call() {
          const [count, encoding = "utf8"] = this.args;
          const size =
            count === undefined || count === null
              ? state.buffer.length - state.offset
              : this.assertInteger(count, "count");

          const at = take(this, size);

          return state.buffer.toString(
            this.assertEncoding(encoding),
            at,
            at + size,
          );
        }
      },

      /** LEB128 unsigned varint, as used by many container formats. */
      varint: class extends BinaryMethodBuilder {
        override call() {
          let result = 0;
          let shift = 0;

          for (;;) {
            const at = take(this, 1);
            const byte = state.buffer[at]!;

            result += (byte & 0x7f) * Math.pow(2, shift);

            if ((byte & 0x80) === 0) break;

            shift += 7;

            if (shift > 56) {
              throw this.throwErrorFormatters(
                new Error("varint is too large for a safe integer"),
              );
            }
          }

          return result;
        }
      },

      /** Move the cursor to an absolute position. */
      seek: class extends BinaryMethodBuilder {
        override call() {
          const [position] = this.args;

          this.assertInteger(position, "position");

          if (position < 0 || position > state.buffer.length) {
            throw this.throwErrorFormatters(
              new Error(
                `seek out of range: ${position} (length ${state.buffer.length})`,
              ),
            );
          }

          state.offset = position;

          return null;
        }
      },

      /** Move the cursor by a relative amount. */
      skip: class extends BinaryMethodBuilder {
        override call() {
          const [count] = this.args;

          this.assertInteger(count, "count");
          take(this, count);

          return null;
        }
      },

      position: class extends BinaryMethodBuilder {
        override call() {
          return state.offset;
        }
      },

      remaining: class extends BinaryMethodBuilder {
        override call() {
          return state.buffer.length - state.offset;
        }
      },

      eof: class extends BinaryMethodBuilder {
        override call() {
          return state.offset >= state.buffer.length;
        }
      },

      length: state.buffer.length,

      get [Environment.SymbolFormatedText]() {
        void self;
        return `BinaryReader { position: ${state.offset}, length: ${state.buffer.length}, endian: "${state.endian}" }`;
      },
    };
  }
}

/**
 * `binary.writer(endian)` - builds binary data.
 * Every write returns the writer, so calls chain; `build()` produces the `bytes` value.
 */
class Writer extends BinaryMethodBuilder {
  override call() {
    const [endian] = this.args;

    const state: WriterState = {
      chunks: [],
      length: 0,
      endian: this.assertEndian(endian),
    };

    // the value is built first so each method can return it for chaining
    const value: Record<string | symbol, any> = {};

    const push = (chunk: Buffer) => {
      state.chunks.push(chunk);
      state.length += chunk.length;

      return value;
    };

    /** A fixed-width numeric write. */
    const number = (size: number, be: string, le: string, big = false) =>
      class extends BinaryMethodBuilder {
        override call() {
          const [input] = this.args;
          const chunk = Buffer.alloc(size);
          const method = state.endian === "be" ? be : le;

          if (big) {
            (chunk as any)[method](
              typeof input === "bigint" ? input : BigInt(this.assertInteger(input, "value")),
              0,
            );
          } else {
            this.assertNumber(input, "value");
            (chunk as any)[method](input, 0);
          }

          return push(chunk);
        }
      };

    Object.assign(value, {
      u8: class extends BinaryMethodBuilder {
        override call() {
          const [input] = this.args;

          this.assertInteger(input, "value");

          return push(Buffer.from([input & 0xff]));
        }
      },

      i8: class extends BinaryMethodBuilder {
        override call() {
          const [input] = this.args;
          const chunk = Buffer.alloc(1);

          this.assertInteger(input, "value");
          chunk.writeInt8(input, 0);

          return push(chunk);
        }
      },

      u16: number(2, "writeUInt16BE", "writeUInt16LE"),
      i16: number(2, "writeInt16BE", "writeInt16LE"),
      u32: number(4, "writeUInt32BE", "writeUInt32LE"),
      i32: number(4, "writeInt32BE", "writeInt32LE"),

      u64: number(8, "writeBigUInt64BE", "writeBigUInt64LE", true),
      i64: number(8, "writeBigInt64BE", "writeBigInt64LE", true),

      f32: number(4, "writeFloatBE", "writeFloatLE"),
      f64: number(8, "writeDoubleBE", "writeDoubleLE"),

      /** Append raw binary data of any accepted kind. */
      bytes: class extends BinaryMethodBuilder {
        override call() {
          const [input] = this.args;

          this.assertBinary(input, "data");

          return push(this.toBuffer(input));
        }
      },

      /** Append text in the given encoding ("utf8" by default). */
      string: class extends BinaryMethodBuilder {
        override call() {
          const [text, encoding = "utf8"] = this.args;

          this.assertString(text, "text");

          return push(Buffer.from(text, this.assertEncoding(encoding)));
        }
      },

      /** LEB128 unsigned varint. */
      varint: class extends BinaryMethodBuilder {
        override call() {
          const [input] = this.args;

          this.assertInteger(input, "value");

          if (input < 0) {
            throw this.throwErrorFormatters(
              new Error("varint cannot encode a negative number"),
            );
          }

          const out: number[] = [];
          let rest = input;

          do {
            let byte = rest % 128;
            rest = Math.floor(rest / 128);

            if (rest > 0) byte |= 0x80;

            out.push(byte);
          } while (rest > 0);

          return push(Buffer.from(out));
        }
      },

      /** Everything written so far, as `bytes`. */
      build: class extends BinaryMethodBuilder {
        override call() {
          return this.toBytes(Buffer.concat(state.chunks, state.length));
        }
      },

      /** Drop everything written so far. */
      reset: class extends BinaryMethodBuilder {
        override call() {
          state.chunks.length = 0;
          state.length = 0;

          return value;
        }
      },

      length: class extends BinaryMethodBuilder {
        override call() {
          return state.length;
        }
      },
    });

    Object.defineProperty(value, Environment.SymbolFormatedText, {
      get: () =>
        `BinaryWriter { length: ${state.length}, endian: "${state.endian}" }`,
      enumerable: true,
      configurable: true,
    });

    return value;
  }
}

/** `binary.sizeOf(value)` - how many bytes `value` occupies. */
class SizeOf extends BinaryMethodBuilder {
  override call() {
    const [value] = this.args;

    this.assertBinary(value, "value");

    return this.toBuffer(value).length;
  }
}

/** `binary.concat([a, b, ...])` - join binary chunks into one `bytes`. */
class Concat extends BinaryMethodBuilder {
  override call() {
    const [parts] = this.args;

    this.assertArray(parts, "parts");

    return this.toBytes(
      Buffer.concat(parts.map((part: any) => toBuffer(part))),
    );
  }
}

/** `binary.hex(value)` / `binary.fromHex(text)` - the usual debugging round trip. */
class Hex extends BinaryMethodBuilder {
  override call() {
    const [value] = this.args;

    this.assertBinary(value, "value");

    return this.toBuffer(value).toString("hex");
  }
}

class FromHex extends BinaryMethodBuilder {
  override call() {
    const [text] = this.args;

    this.assertString(text, "text");

    if (!/^[0-9a-fA-F]*$/.test(text) || text.length % 2 !== 0) {
      throw this.throwErrorFormatters(
        new Error("expected an even-length hexadecimal string"),
      );
    }

    return this.toBytes(Buffer.from(text, "hex"));
  }
}

module.exports = {
  reader: Reader,
  writer: Writer,
  sizeOf: SizeOf,
  concat: Concat,
  hex: Hex,
  fromHex: FromHex,
};
