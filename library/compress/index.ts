/**
 * `compress` - gzip, deflate, brotli and raw deflate over `bytes`.
 *
 *     var packed = compress.gzip(data);
 *     var back   = compress.gunzip(packed);
 *
 * Compression is CPU work that the host runs on its thread pool, so every function here
 * parks the calling task instead of blocking: other tasks keep running while a large
 * buffer is packed, and `spawn compress.gzip(...)` is genuinely concurrent.
 *
 * Input and output are always the shared `bytes` value (`library/kernel/buffers`), so what
 * comes out of `fs.readFile` goes straight in, and what comes out goes straight to
 * `fs.writeFile`, `archive`, `tcp` or `ws` without conversion.
 */

import zlib from "node:zlib";
import fs from "node:fs";
import { pipeline } from "node:stream";
import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { type Gen } from "../../src/runtime/coroutine";
import { fromCallback } from "../kernel/async";
import { createResource, type ResourceState } from "../kernel/resource";
import { park } from "../../src/runtime/coroutine";

const PKG = { name: "compress", path: __dirname };

abstract class CompressMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return PKG;
  }

  /**
   * Run one of zlib's asynchronous transforms without blocking the interpreter.
   * `options` is the plain object the program passed, mapped onto zlib's own names.
   */
  protected *transform(
    operation: (
      input: Buffer,
      options: any,
      callback: (error: Error | null, result?: Buffer) => void,
    ) => void,
    input: any,
    options: any,
    argName = "data",
  ): Gen<any> {
    this.assertBinary(input, argName);

    const buffer = this.toBuffer(input);
    const zlibOptions = this.toZlibOptions(options);

    try {
      const result = yield fromCallback<Buffer>((done) => {
        operation(buffer, zlibOptions, done as any);
      });

      return this.toBytes(result);
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }

  /** `{ level, memLevel, strategy, windowBits }` -> zlib's option names. */
  protected toZlibOptions(options: any): Record<string, any> {
    if (options === undefined || options === null) return {};

    this.assertObject(options, "options");

    const mapped: Record<string, any> = {};

    if (typeof options["level"] === "number") {
      if (options["level"] < 0 || options["level"] > 9) {
        throw this.throwErrorFormatters(
          new Error(`level must be between 0 and 9, received ${options["level"]}`),
        );
      }

      mapped["level"] = options["level"];
    }

    if (typeof options["memLevel"] === "number") {
      mapped["memLevel"] = options["memLevel"];
    }

    if (typeof options["windowBits"] === "number") {
      mapped["windowBits"] = options["windowBits"];
    }

    return mapped;
  }

  /** Brotli uses a different option bag from the deflate family. */
  protected toBrotliOptions(options: any): Record<string, any> {
    if (options === undefined || options === null) return {};

    this.assertObject(options, "options");

    const params: Record<number, number> = {};

    if (typeof options["level"] === "number") {
      if (options["level"] < 0 || options["level"] > 11) {
        throw this.throwErrorFormatters(
          new Error(
            `level must be between 0 and 11 for brotli, received ${options["level"]}`,
          ),
        );
      }

      params[zlib.constants.BROTLI_PARAM_QUALITY] = options["level"];
    }

    return Object.keys(params).length > 0 ? { params } : {};
  }

  call(): any {
    throw new Error("Call is not implemented");
  }
}

class Gzip extends CompressMethodBuilder {
  override *call(): Gen<any> {
    const [data, options] = this.args;

    return yield this.transform(zlib.gzip, data, options);
  }
}

class Gunzip extends CompressMethodBuilder {
  override *call(): Gen<any> {
    const [data, options] = this.args;

    return yield this.transform(zlib.gunzip, data, options);
  }
}

class Deflate extends CompressMethodBuilder {
  override *call(): Gen<any> {
    const [data, options] = this.args;

    return yield this.transform(zlib.deflate, data, options);
  }
}

class Inflate extends CompressMethodBuilder {
  override *call(): Gen<any> {
    const [data, options] = this.args;

    return yield this.transform(zlib.inflate, data, options);
  }
}

/** Raw deflate: no zlib header, as ZIP entries and some protocols use. */
class DeflateRaw extends CompressMethodBuilder {
  override *call(): Gen<any> {
    const [data, options] = this.args;

    return yield this.transform(zlib.deflateRaw, data, options);
  }
}

class InflateRaw extends CompressMethodBuilder {
  override *call(): Gen<any> {
    const [data, options] = this.args;

    return yield this.transform(zlib.inflateRaw, data, options);
  }
}

class BrotliCompress extends CompressMethodBuilder {
  override *call(): Gen<any> {
    const [data, options] = this.args;

    this.assertBinary(data, "data");

    const buffer = this.toBuffer(data);
    const brotliOptions = this.toBrotliOptions(options);

    try {
      const result = yield fromCallback<Buffer>((done) => {
        zlib.brotliCompress(buffer, brotliOptions, done as any);
      });

      return this.toBytes(result);
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class BrotliDecompress extends CompressMethodBuilder {
  override *call(): Gen<any> {
    const [data] = this.args;

    this.assertBinary(data, "data");

    const buffer = this.toBuffer(data);

    try {
      const result = yield fromCallback<Buffer>((done) => {
        zlib.brotliDecompress(buffer, {}, done as any);
      });

      return this.toBytes(result);
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

/** Recognise what a buffer is compressed with, by its magic bytes. */
function detect(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return "gzip";
  }

  // zlib header: CMF/FLG where CMF low nibble is 8 and the pair is a multiple of 31
  if (
    buffer.length >= 2 &&
    (buffer[0]! & 0x0f) === 0x08 &&
    ((buffer[0]! << 8) + buffer[1]!) % 31 === 0
  ) {
    return "deflate";
  }

  return "unknown";
}

class Detect extends CompressMethodBuilder {
  override call() {
    const [data] = this.args;

    this.assertBinary(data, "data");

    return detect(this.toBuffer(data));
  }
}

/** `compress.decompress(data)` - unpack gzip or zlib data without being told which. */
class Decompress extends CompressMethodBuilder {
  override *call(): Gen<any> {
    const [data, options] = this.args;

    this.assertBinary(data, "data");

    const format = detect(this.toBuffer(data));

    if (format === "gzip") {
      return yield this.transform(zlib.gunzip, data, options);
    }

    if (format === "deflate") {
      return yield this.transform(zlib.inflate, data, options);
    }

    throw this.throwErrorFormatters(
      new Error(
        "cannot tell how this data is compressed; use gunzip, inflate, inflateRaw or brotliDecompress",
      ),
    );
  }
}

/** `compress.ratio(original, packed)` - how much smaller it got, as a fraction. */
class Ratio extends CompressMethodBuilder {
  override call() {
    const [original, packed] = this.args;

    this.assertBinary(original, "original");
    this.assertBinary(packed, "packed");

    const from = this.toBuffer(original).length;
    const to = this.toBuffer(packed).length;

    if (from === 0) return 0;

    return 1 - to / from;
  }
}


// ------------------------------------------------------- streaming, file to file

/** The transforms a stream or a file-to-file conversion can apply. */
const TRANSFORMS: Record<string, () => zlib.Gzip | zlib.Gunzip> = {
  gzip: () => zlib.createGzip(),
  gunzip: () => zlib.createGunzip(),
  deflate: () => zlib.createDeflate(),
  inflate: () => zlib.createInflate(),
  deflateRaw: () => zlib.createDeflateRaw(),
  inflateRaw: () => zlib.createInflateRaw(),
  brotli: () => zlib.createBrotliCompress() as any,
  unbrotli: () => zlib.createBrotliDecompress() as any,
};

const TRANSFORM_NAMES = Object.keys(TRANSFORMS);

abstract class StreamingBuilder extends CompressMethodBuilder {
  protected assertKind(kind: any): string {
    this.assertString(kind, "kind");

    if (!(kind in TRANSFORMS)) {
      throw this.throwErrorFormatters(
        new Error(
          `unknown transform "${kind}". Supported: ${TRANSFORM_NAMES.join(", ")}`,
        ),
      );
    }

    return kind;
  }
}

/**
 * `compress.file(kind, source, destination)` - convert a file without holding it.
 *
 * The whole-buffer functions need the input *and* the output in memory at once, which a
 * multi-gigabyte file cannot satisfy and `--max-memory` should not allow. This reads,
 * transforms and writes in chunks, so the memory it uses does not depend on the size of
 * the file. Returns the number of bytes written.
 */
class TransformFile extends StreamingBuilder {
  override *call(): Gen<any> {
    const [kind, source, destination, options] = this.args;

    const transform = this.assertKind(kind);

    this.assertString(source, "source");
    this.assertString(destination, "destination");
    this.checkPermission("read", source);
    this.checkPermission("write", destination);

    const level =
      options && typeof options["level"] === "number" ? options["level"] : undefined;

    const input = fs.createReadStream(source);
    const output = fs.createWriteStream(destination);
    const engine = TRANSFORMS[transform]!();

    if (level !== undefined && typeof (engine as any).params === "function") {
      // deflate-family streams accept the level up front; brotli does not
      try {
        (engine as any)._level = level;
      } catch {
        // the level is advisory here; a stream that refuses it still works
      }
    }

    try {
      yield park<void>((wake, fail) => {
        pipeline(input, engine, output, (error) => {
          if (error) fail(error);
          else wake();
        });
      });
    } catch (error: any) {
      throw this.throwErrorFormatters(
        new Error(
          `cannot ${transform} "${source}" into "${destination}": ${error?.message ?? error}`,
        ),
      );
    }

    return output.bytesWritten;
  }
}

/**
 * `compress.stream(kind, options)` - a transform you feed by hand.
 *
 *     var packer = defer compress.stream("gzip");
 *     packer.write(firstChunk);
 *     packer.write(secondChunk);
 *     var packed = packer.finish();
 *
 * Useful when the data arrives in pieces (off a socket, out of a loop) and neither end
 * ever exists as one buffer. The stream owns a host transform, so `defer` releases it and
 * `close()` is idempotent, like every other resource.
 */
class TransformStream extends StreamingBuilder {
  override call() {
    const [kind] = this.args;

    const transform = this.assertKind(kind);
    const engine = TRANSFORMS[transform]!();

    /** Output the transform has produced and the program has not taken yet. */
    const ready: Buffer[] = [];
    let failure: any = null;
    let ended = false;

    engine.on("data", (chunk: Buffer) => {
      ready.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    engine.on("error", (error) => {
      failure = error;
    });

    engine.on("end", () => {
      ended = true;
    });

    let resourceState: ResourceState;

    const assertUsable = (self: CompressMethodBuilder) => {
      if (resourceState.closed) {
        throw self.throwErrorFormatters(new Error("stream is already closed"));
      }

      if (failure) {
        const error = failure;
        failure = null;

        throw self.throwErrorFormatters(
          new Error(`stream failed: ${error?.message ?? error}`),
        );
      }
    };

    const take = (): Buffer => {
      const all = Buffer.concat(ready);

      ready.length = 0;

      return all;
    };

    const built = createResource({
      name: `CompressStream(${transform})`,
      pkg: PKG,
      close: () => {
        engine.destroy();
      },
      describe: () =>
        `CompressStream { ${transform}, closed: ${resourceState.closed}, buffered: ${ready.length} }`,
      members: {
        kind: transform,

        /** Feed a chunk in; parks until the transform has taken it. */
        write: class extends CompressMethodBuilder {
          override *call(): Gen<any> {
            const [data] = this.args;

            assertUsable(this);
            this.assertBinary(data, "data");

            const payload = this.toBuffer(data);

            yield park<void>((wake, fail) => {
              engine.write(payload, (error) => {
                if (error) fail(error);
                else wake();
              });
            });

            return payload.length;
          }
        },

        /** Whatever the transform has produced so far, as `bytes`. */
        read: class extends CompressMethodBuilder {
          override call() {
            assertUsable(this);

            return this.toBytes(take());
          }
        },

        /**
         * No more input: flush the transform and return everything still unread.
         * The stream is finished afterwards, but `close()` is still safe to call.
         */
        finish: class extends CompressMethodBuilder {
          override *call(): Gen<any> {
            assertUsable(this);

            if (!ended) {
              yield park<void>((wake, fail) => {
                engine.once("error", fail);
                engine.end(() => {
                  // wait for the last chunks to be emitted, not just accepted
                  if (ended) wake();
                  else engine.once("end", () => wake());
                });
              });
            }

            assertUsable(this);

            return this.toBytes(take());
          }
        },

        /** How many bytes of output are waiting to be read. */
        buffered: class extends CompressMethodBuilder {
          override call() {
            return ready.reduce((total, chunk) => total + chunk.length, 0);
          }
        },
      },
    });

    resourceState = built.state;

    return built.value;
  }
}

module.exports = {
  gzip: Gzip,
  gunzip: Gunzip,
  deflate: Deflate,
  inflate: Inflate,
  deflateRaw: DeflateRaw,
  inflateRaw: InflateRaw,
  brotli: BrotliCompress,
  unbrotli: BrotliDecompress,
  decompress: Decompress,
  detect: Detect,
  ratio: Ratio,
  stream: TransformStream,
  file: TransformFile,
  transforms: [...TRANSFORM_NAMES],
  constants: {
    BEST_SPEED: zlib.constants.Z_BEST_SPEED,
    BEST_COMPRESSION: zlib.constants.Z_BEST_COMPRESSION,
    DEFAULT_LEVEL: zlib.constants.Z_DEFAULT_COMPRESSION,
    NO_COMPRESSION: zlib.constants.Z_NO_COMPRESSION,
  },
  [Environment.SymbolFormatedText]: "compress",
};
