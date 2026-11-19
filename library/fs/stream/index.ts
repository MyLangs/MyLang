import fs from "node:fs";
import stream from "node:stream";
import { FunctionBuilder, FunctionBuilderCodeError } from "../../FunctionBuilder";
import { Environment } from "../../../src/Environment";
import { type Gen, park } from "../../../src/runtime/coroutine";
import { type StmtType } from "../../../src/ast/StmtType";
import { isTypeArgs } from "../../utils/utils";
import { Bytes } from "../../bytes/Bytes";
import { unwrapBuffer, isBinaryLike } from "../../kernel/buffers";

abstract class StreamMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return {
      name: "fs/stream",
      path: __dirname,
    };
  }

  protected validatePath(filePath: any, argName: string = "path"): void {
    if (typeof filePath !== "string") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "string",
        received: isTypeArgs(filePath),
      });
    }
  }

  protected validateFunction(func: any, argName: string = "callback"): void {
    if (isTypeArgs(func) !== "function") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "function",
        received: isTypeArgs(func),
      });
    }
  }

  protected validateBuffer(buffer: any, argName: string = "data"): void {
    if (
      !(buffer instanceof Buffer) &&
      typeof buffer !== "string" &&
      !isBinaryLike(buffer)
    ) {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "buffer, bytes or string",
        received: isTypeArgs(buffer),
      });
    }
  }

  // Event payloads: buffers become `Bytes`, anything else (an `Error` for
  // "error", nothing for "end"/"close") is passed through untouched.
  protected convertArgs(args: any[]): any[] {
    return args.map((arg) =>
      arg instanceof Uint8Array
        ? new Bytes([arg], [], this.environment).call()
        : arg,
    );
  }

  call() {
    throw new Error("Call is not implemented");
  }
}

// Key under which a returned stream object keeps its host stream. A symbol is
// invisible to interpreted code, but `pipe` can find the destination with it.
const NATIVE_STREAM = Symbol("NativeStream");

function nativeOf(value: any): any {
  return value?.[NATIVE_STREAM];
}

class ReadableStream extends StreamMethodBuilder {
  public stream!: fs.ReadStream;

  override call() {
    const [filePath, options = {}] = this.args;
    this.validatePath(filePath);
    this.checkPermission("read", filePath);

    let stream!: fs.ReadStream;
    const eventHandlers: Map<string, any[]> = new Map();

    try {
      stream = fs.createReadStream(filePath, options);
      this.stream = stream;

      for (const [event, handlers] of eventHandlers) {
        for (const handler of handlers) {
          stream.on(event, handler);
        }
      }
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }

    return {
      [NATIVE_STREAM]: stream,

      on: class extends StreamMethodBuilder {
        override call() {
          const [event, handler] = this.args;
          this.validateFunction(handler, "handler");

          const wrappedHandler = (...args: any[]) => {
            this.fireCallback(handler, this.convertArgs(args));
          };

          if (stream) {
            stream.on(event, wrappedHandler);
          } else {
            if (!eventHandlers.has(event)) {
              eventHandlers.set(event, []);
            }
            eventHandlers.get(event)!.push(wrappedHandler);
          }

          return new ReadableStream([filePath, options], [], this.environment);
        }
      },

      once: class extends StreamMethodBuilder {
        override call() {
          const [event, handler] = this.args;
          this.validateFunction(handler, "handler");

          const wrappedHandler = (...args: any[]) => {
            this.fireCallback(handler, this.convertArgs(args));
          };

          if (stream) {
            stream.once(event, wrappedHandler);
          }

          return new ReadableStream([filePath, options], [], this.environment);
        }
      },

      pause: class extends StreamMethodBuilder {
        override call() {
          if (stream) {
            stream.pause();
          }
          return null;
        }
      },

      resume: class extends StreamMethodBuilder {
        override call() {
          if (stream) {
            stream.resume();
          }
          return null;
        }
      },

      destroy: class extends StreamMethodBuilder {
        override call() {
          const [error] = this.args;
          if (stream) {
            stream.destroy(error);
          }
          return null;
        }
      },

      close: class extends StreamMethodBuilder {
        override call() {
          if (stream) {
            stream.close();
          }
          return null;
        }
      },

      read: class extends StreamMethodBuilder {
        override call() {
          const [size] = this.args;
          if (stream) {
            return stream.read(size);
          }
          return null;
        }
      },

      pipe: class extends StreamMethodBuilder {
        override call() {
          const [destination, options] = this.args;
          const target = nativeOf(destination);

          if (!stream || !target) {
            throw this.throwErrorFormatters(
              new Error("pipe destination must be a writable or transform stream"),
            );
          }

          stream.pipe(target, options);
          return destination;
        }
      },

      readable: class extends StreamMethodBuilder {
        override call() {
          return stream ? stream.readable : false;
        }
      },

      readableHighWaterMark: class extends StreamMethodBuilder {
        override call() {
          return stream ? stream.readableHighWaterMark : 0;
        }
      },

      path: class extends StreamMethodBuilder {
        override call() {
          return stream ? stream.path : filePath;
        }
      },

      // an open stream owns a file handle: `defer` releases it
      [Environment.SymbolDeferred]: class extends StreamMethodBuilder {
        override call() {
          if (!stream.destroyed) stream.destroy();

          return null;
        }
      },

      [Environment.SymbolFormatedText]: `ReadableStream { path: "${filePath}" }`,
    };
  }
}

class WritableStream extends StreamMethodBuilder {
  public stream!: fs.WriteStream;

  override call() {
    const [filePath, options = {}] = this.args;
    this.validatePath(filePath);
    this.checkPermission("write", filePath);

    let stream!: fs.WriteStream;
    const eventHandlers: Map<string, any[]> = new Map();

    try {
      stream = fs.createWriteStream(filePath, options);
      this.stream = stream;

      for (const [event, handlers] of eventHandlers) {
        for (const handler of handlers) {
          stream.on(event, handler);
        }
      }
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }

    return {
      [NATIVE_STREAM]: stream,

      on: class extends StreamMethodBuilder {
        override call() {
          const [event, handler] = this.args;
          this.validateFunction(handler, "handler");

          const wrappedHandler = (...args: any[]) => {
            this.fireCallback(handler, this.convertArgs(args));
          };

          if (stream) {
            stream.on(event, wrappedHandler);
          } else {
            if (!eventHandlers.has(event)) {
              eventHandlers.set(event, []);
            }
            eventHandlers.get(event)!.push(wrappedHandler);
          }

          return new WritableStream([filePath, options], [], this.environment);
        }
      },

      once: class extends StreamMethodBuilder {
        override call() {
          const [event, handler] = this.args;
          this.validateFunction(handler, "handler");

          const wrappedHandler = (...args: any[]) => {
            this.fireCallback(handler, this.convertArgs(args));
          };

          if (stream) {
            stream.once(event, wrappedHandler);
          }

          return new WritableStream([filePath, options], [], this.environment);
        }
      },

      write: class extends StreamMethodBuilder {
        override call() {
          let [chunk, encoding, callback] = this.args;
          this.validateBuffer(chunk);

          const chunkBuffer = unwrapBuffer(chunk);

          if (chunkBuffer) chunk = chunkBuffer;

          if (stream) {
            if (callback) {
              this.validateFunction(callback);
              const wrappedCallback = (...args: any[]) => {
                this.fireCallback(callback, args);
              };
              return stream.write(chunk, encoding, wrappedCallback);
            }
            return stream.write(chunk, encoding);
          }
          return false;
        }
      },

      end: class extends StreamMethodBuilder {
        override call() {
          let [chunk, encoding, callback] = this.args;

          if (stream) {
            if (chunk !== undefined) {
              this.validateBuffer(chunk);
              const endBuffer = unwrapBuffer(chunk);

              if (endBuffer) chunk = endBuffer;
            }
            if (callback) {
              this.validateFunction(callback);
              const wrappedCallback = (...args: any[]) => {
                this.fireCallback(callback, this.convertArgs(args));
              };
              stream.end(chunk, encoding, wrappedCallback);
            } else {
              stream.end(chunk, encoding);
            }
          }
          return null;
        }
      },

      destroy: class extends StreamMethodBuilder {
        override call() {
          const [error] = this.args;
          if (stream) {
            stream.destroy(error);
          }
          return null;
        }
      },

      close: class extends StreamMethodBuilder {
        override call() {
          if (stream) {
            stream.close();
          }
          return null;
        }
      },

      writable: class extends StreamMethodBuilder {
        override call() {
          return stream ? stream.writable : false;
        }
      },

      writableHighWaterMark: class extends StreamMethodBuilder {
        override call() {
          return stream ? stream.writableHighWaterMark : 0;
        }
      },

      path: class extends StreamMethodBuilder {
        override call() {
          return stream ? stream.path : filePath;
        }
      },

      // An open stream owns a file handle AND buffered data. Disposing it waits for
      // the flush to finish, so the file is complete by the time the enclosing block
      // returns - otherwise `defer` would leave the data half-written.
      [Environment.SymbolDeferred]: class extends StreamMethodBuilder {
        override *call(): Gen<any> {
          if (stream.destroyed || stream.closed) return null;

          yield park<void>((wake) => {
            const done = () => {
              stream.removeListener("error", done);
              wake();
            };

            stream.once("error", done);
            stream.end(done);
          });

          return null;
        }
      },

      [Environment.SymbolFormatedText]: `WritableStream { path: "${filePath}" }`,
    };
  }
}

class TransformStream extends StreamMethodBuilder {
  override call() {
    const [transformFn, options = {}] = this.args;
    this.validateFunction(transformFn);

    // `transformFn(chunk, encoding)` is a language function (a coroutine), so
    // it runs as a task: wait for it to settle, then hand its result on.
    const transformStream = new stream.Transform({
      ...options,
      transform: (chunk: any, encoding: string, callback: Function) => {
        const task = this.fireCallback(transformFn, [
          new Bytes([chunk], [], this.environment).call(),
          encoding,
        ]);

        task.onSettled(() => {
          if (task.status === "rejected") {
            callback(task.error);
            return;
          }

          const result = task.result;

          if (result === null || result === undefined) {
            callback();
          } else if (unwrapBuffer(result)) {
            callback(null, unwrapBuffer(result));
          } else if (typeof result === "string" || Buffer.isBuffer(result)) {
            callback(null, result);
          } else {
            callback(null, String(result));
          }
        });
      },
    });

    return {
      [NATIVE_STREAM]: transformStream,

      pipe: class extends StreamMethodBuilder {
        override call() {
          const [destination, options] = this.args;
          const target = nativeOf(destination);

          if (!target) {
            throw this.throwErrorFormatters(
              new Error("pipe destination must be a writable or transform stream"),
            );
          }

          transformStream.pipe(target, options);
          return destination;
        }
      },

      write: class extends StreamMethodBuilder {
        override call() {
          const [chunk, encoding, callback] = this.args;
          if (callback) {
            this.validateFunction(callback);
            const wrappedCallback = (...args: any[]) => {
              this.fireCallback(callback, this.convertArgs(args));
            };
            return transformStream.write(chunk, encoding, wrappedCallback);
          }
          return transformStream.write(chunk, encoding);
        }
      },

      end: class extends StreamMethodBuilder {
        override call() {
          const [chunk, encoding, callback] = this.args;
          if (callback) {
            this.validateFunction(callback);
            const wrappedCallback = (...args: any[]) => {
              this.fireCallback(callback, this.convertArgs(args));
            };
            transformStream.end(chunk, encoding, wrappedCallback);
          } else {
            transformStream.end(chunk, encoding);
          }
          return null;
        }
      },

      [Environment.SymbolFormatedText]: `TransformStream { }`,
    };
  }
}

module.exports = {
  ReadableStream,
  WritableStream,
  TransformStream,
};
