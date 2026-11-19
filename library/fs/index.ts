/**
 * `fs` - the file system.
 *
 * Every operation is non-blocking. The direct form parks the calling task on the host's
 * asynchronous file API and lets every other task keep running, so `spawn fs.readFile(...)`
 * really is concurrent - which is exactly what the old synchronous implementation could
 * not do, however it was spawned. The callback form is kept for programs that prefer it.
 *
 * Permissions: reading checks `--allow-read`, writing checks `--allow-write`, and an
 * operation that does both (`rename`, `copyFile`, `move`) checks both, on both paths.
 *
 * Binary data in and out of this library is always the language's `bytes` value, produced
 * by the shared kernel (`library/kernel/buffers`), so what `fs.readFile` returns can be
 * handed straight to `bytes`, `crypto`, `compress`, `archive`, `tcp` or `ws`.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { isTypeArgs } from "../utils/utils";
import { type Gen, lift, hostAwait } from "../../src/runtime/coroutine";
import { createResource } from "../kernel/resource";
import { fromCallback } from "../kernel/async";
import { splitOptional } from "../kernel/validate";
import { security } from "../../src/security";

const PKG = { name: "fs", path: __dirname };

abstract class FSMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return PKG;
  }

  /** A path argument, checked for type and for `--allow-read`. */
  protected readPath(filePath: any, argName = "path"): string {
    this.assertString(filePath, argName);
    this.checkPermission("read", filePath);

    return filePath;
  }

  /** A path argument, checked for type and for `--allow-write`. */
  protected writePath(filePath: any, argName = "path"): string {
    this.assertString(filePath, argName);
    this.checkPermission("write", filePath);

    return filePath;
  }

  protected validatePath(filePath: any, argName = "path"): void {
    this.assertString(filePath, argName);
  }

  protected validateFunction(func: any, argName = "callback"): void {
    this.assertFunction(func, argName);
  }

  /** Accepts `bytes`, a buffer or a string, like every other library. */
  protected validateBuffer(buffer: any, argName = "data"): void {
    this.assertBinary(buffer, argName);
  }

  protected validateNumber(value: any, argName: string): void {
    if (typeof value !== "number") {
      this.assertNumber(value, argName);
    }
  }

  /** A string stays a string (so its encoding is honoured); everything else becomes bytes. */
  protected processBuffer(buffer: any): Buffer | string {
    if (typeof buffer === "string") return buffer;

    return this.toBuffer(buffer);
  }

  /** Did the caller pass a callback? */
  protected isCallback(value: any): boolean {
    return Boolean(value) && isTypeArgs(value) === "function";
  }

  /** The language value describing `fs.Stats`. */
  protected createStats(stats: fs.Stats) {
    return createStatsObject(stats);
  }

  call(): any {
    throw new Error("Call is not implemented");
  }
}

/**
 * `fs.Stats` as a language value. Built once here instead of inside `Stat`, so `lstat`,
 * `fstat`, `walk` and `fs.file().stat()` all return the very same shape.
 */
function createStatsObject(stats: fs.Stats) {
  const value = (name: string, result: any) =>
    class extends FSMethodBuilder {
      override call() {
        void name;
        return result;
      }
    };

  return {
    isFile: value("isFile", stats.isFile()),
    isDirectory: value("isDirectory", stats.isDirectory()),
    isSymbolicLink: value("isSymbolicLink", stats.isSymbolicLink()),
    size: value("size", stats.size),
    mtime: value("mtime", stats.mtime),
    ctime: value("ctime", stats.ctime),
    atime: value("atime", stats.atime),
    birthtime: value("birthtime", stats.birthtime),
    mode: value("mode", stats.mode),
    uid: value("uid", stats.uid),
    gid: value("gid", stats.gid),
    [Environment.SymbolFormatedText]: `Stats { size: ${stats.size}, isFile: ${stats.isFile()}, isDirectory: ${stats.isDirectory()} }`,
  };
}

/** Park until a Node fs callback that reports `(err, a, b)` fires, returning `[a, b]`. */
function* fromMultiCallback(
  register: (callback: (error: any, ...rest: any[]) => void) => void,
): Gen<any[]> {
  return yield fromCallback<any[]>((done) => {
    register((error: any, ...rest: any[]) => {
      if (error) done(error);
      else done(null, rest);
    });
  });
}

// --------------------------------------------------------------- whole files

class ReadFile extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, options, callback] = this.args;

    this.readPath(filePath);

    const [actualOptions, actualCallback] = splitOptional(options, callback, {});

    if (this.isCallback(actualCallback)) {
      fs.readFile(filePath, actualOptions, (err, data) => {
        this.fireCallback(
          actualCallback,
          err ? [err] : [null, this.toBytes(data)],
        );
      });

      return null;
    }

    try {
      return this.toBytes(yield hostAwait(fsp.readFile(filePath, actualOptions)));
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class WriteFile extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, data, options, callback] = this.args;

    this.writePath(filePath);
    this.validateBuffer(data);

    const payload = this.processBuffer(data);
    const [actualOptions, actualCallback] = splitOptional(options, callback, {});

    if (this.isCallback(actualCallback)) {
      fs.writeFile(filePath, payload, actualOptions, (err) => {
        this.fireCallback(actualCallback, err ? [err] : [null]);
      });

      return null;
    }

    try {
      yield hostAwait(fsp.writeFile(filePath, payload, actualOptions));

      return null;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class AppendFile extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, data, options, callback] = this.args;

    this.writePath(filePath);
    this.validateBuffer(data);

    const payload = this.processBuffer(data);
    const [actualOptions, actualCallback] = splitOptional(options, callback, {});

    if (this.isCallback(actualCallback)) {
      fs.appendFile(filePath, payload, actualOptions, (err) => {
        this.fireCallback(actualCallback, err ? [err] : [null]);
      });

      return null;
    }

    try {
      yield hostAwait(fsp.appendFile(filePath, payload, actualOptions));

      return null;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

// --------------------------------------------------------------- directories

class ReadDir extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [dirPath, options, callback] = this.args;

    this.readPath(dirPath);

    const [actualOptions, actualCallback] = splitOptional(options, callback, {});

    if (this.isCallback(actualCallback)) {
      fs.readdir(dirPath, actualOptions, (err, files) => {
        this.fireCallback(actualCallback, err ? [err] : [null, files]);
      });

      return null;
    }

    try {
      return yield hostAwait(fsp.readdir(dirPath, actualOptions));
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class MakeDir extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [dirPath, options, callback] = this.args;

    this.writePath(dirPath);

    const [actualOptions, actualCallback] = splitOptional(options, callback, {});

    if (this.isCallback(actualCallback)) {
      fs.mkdir(dirPath, actualOptions, (err, created) => {
        this.fireCallback(actualCallback, err ? [err] : [null, created ?? null]);
      });

      return null;
    }

    try {
      const created = yield hostAwait(fsp.mkdir(dirPath, actualOptions));

      return created === undefined ? null : created;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class RemoveDir extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [dirPath, options, callback] = this.args;

    this.writePath(dirPath);

    const [actualOptions, actualCallback] = splitOptional(options, callback, {});

    if (this.isCallback(actualCallback)) {
      fs.rm(dirPath, actualOptions, (err) => {
        this.fireCallback(actualCallback, err ? [err] : [null]);
      });

      return null;
    }

    try {
      yield hostAwait(fsp.rm(dirPath, actualOptions));

      return null;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

// -------------------------------------------------------------------- stats

class Stat extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, options, callback] = this.args;

    this.readPath(filePath);

    const [actualOptions, actualCallback] = splitOptional(options, callback, {});

    if (this.isCallback(actualCallback)) {
      fs.stat(filePath, actualOptions, (err, stats) => {
        this.fireCallback(
          actualCallback,
          err ? [err] : [null, createStatsObject(stats)],
        );
      });

      return null;
    }

    try {
      return createStatsObject(
        yield hostAwait(fsp.stat(filePath, actualOptions)),
      );
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }

  /** Kept for libraries that build a stats value from a handle they already have. */
  __createStatsObject(stats: fs.Stats) {
    return createStatsObject(stats);
  }
}

class LStat extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, options, callback] = this.args;

    this.readPath(filePath);

    const [actualOptions, actualCallback] = splitOptional(options, callback, {});

    if (this.isCallback(actualCallback)) {
      fs.lstat(filePath, actualOptions, (err, stats) => {
        this.fireCallback(
          actualCallback,
          err ? [err] : [null, createStatsObject(stats)],
        );
      });

      return null;
    }

    try {
      return createStatsObject(
        yield hostAwait(fsp.lstat(filePath, actualOptions)),
      );
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

// ----------------------------------------------------------- single entries

class Unlink extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, callback] = this.args;

    this.writePath(filePath);

    if (this.isCallback(callback)) {
      fs.unlink(filePath, (err) => {
        this.fireCallback(callback, err ? [err] : [null]);
      });

      return null;
    }

    try {
      yield hostAwait(fsp.unlink(filePath));

      return null;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class Rename extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [oldPath, newPath, callback] = this.args;

    this.readPath(oldPath, "oldPath");
    this.writePath(oldPath, "oldPath");
    this.writePath(newPath, "newPath");

    if (this.isCallback(callback)) {
      fs.rename(oldPath, newPath, (err) => {
        this.fireCallback(callback, err ? [err] : [null]);
      });

      return null;
    }

    try {
      yield hostAwait(fsp.rename(oldPath, newPath));

      return null;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class CopyFile extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [src, dest, mode, callback] = this.args;

    this.readPath(src, "src");
    this.writePath(dest, "dest");

    const [actualMode, actualCallback] = splitOptional(mode, callback, 0);

    if (this.isCallback(actualCallback)) {
      fs.copyFile(src, dest, actualMode, (err) => {
        this.fireCallback(actualCallback, err ? [err] : [null]);
      });

      return null;
    }

    try {
      yield hostAwait(fsp.copyFile(src, dest, actualMode));

      return null;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class Access extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, mode, callback] = this.args;

    this.readPath(filePath);

    const [actualMode, actualCallback] = splitOptional(
      mode,
      callback,
      fs.constants.F_OK,
    );

    if (this.isCallback(actualCallback)) {
      fs.access(filePath, actualMode, (err) => {
        this.fireCallback(actualCallback, err ? [err] : [null]);
      });

      return null;
    }

    try {
      yield hostAwait(fsp.access(filePath, actualMode));

      return null;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class Chmod extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, mode, callback] = this.args;

    this.writePath(filePath);
    this.validateNumber(mode, "mode");

    if (this.isCallback(callback)) {
      fs.chmod(filePath, mode, (err) => {
        this.fireCallback(callback, err ? [err] : [null]);
      });

      return null;
    }

    try {
      yield hostAwait(fsp.chmod(filePath, mode));

      return null;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class Chown extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, uid, gid, callback] = this.args;

    this.writePath(filePath);
    this.validateNumber(uid, "uid");
    this.validateNumber(gid, "gid");

    if (this.isCallback(callback)) {
      fs.chown(filePath, uid, gid, (err) => {
        this.fireCallback(callback, err ? [err] : [null]);
      });

      return null;
    }

    try {
      yield hostAwait(fsp.chown(filePath, uid, gid));

      return null;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class Symlink extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [target, linkPath, type, callback] = this.args;

    this.validatePath(target, "target");
    this.writePath(linkPath, "path");

    const [actualType, actualCallback] = splitOptional(type, callback, "file");

    if (this.isCallback(actualCallback)) {
      fs.symlink(target, linkPath, actualType, (err) => {
        this.fireCallback(actualCallback, err ? [err] : [null]);
      });

      return null;
    }

    try {
      yield hostAwait(fsp.symlink(target, linkPath, actualType));

      return null;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class ReadLink extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [linkPath, options, callback] = this.args;

    this.readPath(linkPath);

    const [actualOptions, actualCallback] = splitOptional(options, callback, {});

    if (this.isCallback(actualCallback)) {
      fs.readlink(linkPath, actualOptions, (err, target) => {
        this.fireCallback(actualCallback, err ? [err] : [null, target]);
      });

      return null;
    }

    try {
      return yield hostAwait(fsp.readlink(linkPath, actualOptions));
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class RealPath extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, options, callback] = this.args;

    this.readPath(filePath);

    const [actualOptions, actualCallback] = splitOptional(options, callback, {});

    if (this.isCallback(actualCallback)) {
      fs.realpath(filePath, actualOptions, (err, resolved) => {
        this.fireCallback(actualCallback, err ? [err] : [null, resolved]);
      });

      return null;
    }

    try {
      return yield hostAwait(fsp.realpath(filePath, actualOptions));
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class Truncate extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, len, callback] = this.args;

    this.writePath(filePath);

    const [actualLen, actualCallback] = splitOptional(len, callback, 0);

    if (this.isCallback(actualCallback)) {
      fs.truncate(filePath, actualLen, (err) => {
        this.fireCallback(actualCallback, err ? [err] : [null]);
      });

      return null;
    }

    try {
      yield hostAwait(fsp.truncate(filePath, actualLen));

      return null;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class Exists extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, callback] = this.args;

    this.readPath(filePath);

    if (this.isCallback(callback)) {
      fs.access(filePath, fs.constants.F_OK, (err) => {
        this.fireCallback(callback, [!err]);
      });

      return null;
    }

    try {
      yield hostAwait(fsp.access(filePath, fs.constants.F_OK));

      return true;
    } catch {
      return false;
    }
  }
}

// ------------------------------------------------------------------ watchers

class FSWatcher extends FSMethodBuilder {
  override call() {
    const [filename, options, listener] = this.args;

    this.readPath(filename, "filename");

    const [actualOptions, actualListener] = splitOptional(options, listener, {});

    let watcher: fs.FSWatcher;

    try {
      watcher = fs.watch(filename, actualOptions);

      if (this.isCallback(actualListener)) {
        watcher.on("change", (eventType, changed) => {
          this.fireCallback(actualListener, [eventType, changed]);
        });
      }
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }

    // a watcher owns a host handle: `defer` and `symbol.dispose` release it
    const { value, state } = createResource({
      name: "FSWatcher",
      counts: "file",
      pkg: PKG,
      close: () => watcher.close(),
      describe: () =>
        `FSWatcher { filename: "${filename}", closed: ${state.closed} }`,
      members: {
        on: class extends FSMethodBuilder {
          override call() {
            const [event, handler] = this.args;

            this.validateFunction(handler, "handler");

            watcher.on(event, (...args: any[]) => {
              this.fireCallback(handler, args);
            });

            return null;
          }
        },

        once: class extends FSMethodBuilder {
          override call() {
            const [event, handler] = this.args;

            this.validateFunction(handler, "handler");

            watcher.once(event, (...args: any[]) => {
              this.fireCallback(handler, args);
            });

            return null;
          }
        },

        ref: class extends FSMethodBuilder {
          override call() {
            watcher.ref();
            return null;
          }
        },

        unref: class extends FSMethodBuilder {
          override call() {
            watcher.unref();
            return null;
          }
        },
      },
    });

    return value;
  }
}

class WatchFile extends FSMethodBuilder {
  override call() {
    const [filename, options, listener] = this.args;

    this.readPath(filename, "filename");

    const [actualOptions, actualListener] = splitOptional(options, listener, {
      persistent: true,
      interval: 5007,
    });

    if (this.isCallback(actualListener)) {
      fs.watchFile(filename, actualOptions, (curr, prev) => {
        this.fireCallback(actualListener, [
          createStatsObject(curr),
          createStatsObject(prev),
        ]);
      });
    }

    return null;
  }
}

// -------------------------------------------------------- file descriptors

class Open extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, flags, mode, callback] = this.args;

    this.validatePath(filePath);
    this.checkFlagPermissions(filePath, flags);

    const [actualMode, actualCallback] = splitOptional(mode, callback, 0o666);

    if (this.isCallback(actualCallback)) {
      fs.open(filePath, flags, actualMode, (err, fd) => {
        this.fireCallback(actualCallback, err ? [err] : [null, fd]);
      });

      return null;
    }

    // `--max-open-files` applies to a bare descriptor as much as to `fs.file`; the
    // program gives the slot back with `fs.close`.
    this.checkPermission("read", filePath);
    security.acquire("file");

    try {
      const [fd] = yield fromMultiCallback((done) =>
        fs.open(filePath, flags, actualMode, done),
      );

      return fd;
    } catch (error: any) {
      security.release("file");

      throw this.throwErrorFormatters(error);
    }
  }

  /** `"r"` needs read, anything that can modify the file needs write. */
  protected checkFlagPermissions(filePath: string, flags: any): void {
    const mode = typeof flags === "string" ? flags : "r";

    if (mode.includes("r") || mode.includes("+")) {
      this.checkPermission("read", filePath);
    }

    if (/[wax+]/.test(mode)) {
      this.checkPermission("write", filePath);
    }
  }
}

class Close extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [fd, callback] = this.args;

    this.assertNumber(fd, "fd");

    if (this.isCallback(callback)) {
      fs.close(fd, (err) => {
        this.fireCallback(callback, err ? [err] : [null]);
      });

      return null;
    }

    try {
      yield fromMultiCallback((done) => fs.close(fd, done));

      return null;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    } finally {
      security.release("file");
    }
  }
}

class Read extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [fd, buffer, offset, length, position, callback] = this.args;

    this.assertNumber(fd, "fd");

    const target = this.toBuffer(buffer);

    if (this.isCallback(callback)) {
      fs.read(fd, target, offset, length, position, (err, bytesRead, read) => {
        this.fireCallback(
          callback,
          err ? [err] : [null, bytesRead, this.toBytes(read)],
        );
      });

      return null;
    }

    try {
      const [bytesRead] = yield fromMultiCallback((done) =>
        fs.read(fd, target, offset, length, position, done),
      );

      return {
        bytesRead,
        buffer: this.toBytes(target),
      };
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class Write extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [fd, buffer, offset, length, position, callback] = this.args;

    this.assertNumber(fd, "fd");
    this.validateBuffer(buffer);

    // Node has two `fs.write` shapes - `(fd, buffer, offset, length, position)` and
    // `(fd, string, position, encoding)` - and picks the wrong one when the trailing
    // arguments are `undefined`, so text is always written as bytes instead.
    const payload = this.toBuffer(this.processBuffer(buffer));
    const start = typeof offset === "number" ? offset : 0;
    const count = typeof length === "number" ? length : payload.length - start;
    const at = typeof position === "number" ? position : null;

    if (this.isCallback(callback)) {
      fs.write(fd, payload, start, count, at, (err, written, writtenBack) => {
        this.fireCallback(
          callback,
          err ? [err] : [null, written, this.toBytes(writtenBack)],
        );
      });

      return null;
    }

    try {
      const [written] = yield fromMultiCallback((done) =>
        fs.write(fd, payload, start, count, at, done),
      );

      return written;
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class FStat extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [fd, options, callback] = this.args;

    this.assertNumber(fd, "fd");

    const [actualOptions, actualCallback] = splitOptional(options, callback, {});

    if (this.isCallback(actualCallback)) {
      fs.fstat(fd, actualOptions, (err, stats) => {
        this.fireCallback(
          actualCallback,
          err ? [err] : [null, createStatsObject(stats)],
        );
      });

      return null;
    }

    try {
      const [stats] = yield fromMultiCallback((done) =>
        fs.fstat(fd, actualOptions, done),
      );

      return createStatsObject(stats);
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

/**
 * `fs.file(path, flags)` - an open file as an owned resource.
 *
 *     var f = defer fs.file("data.bin", "r");
 *     var chunk = f.read(1024);
 *     // f is closed when the block ends, whichever way it ends
 *
 * The same handle also works with the explicit `f.close()` and with
 * `wait spawn f.close()`; closing twice is not an error.
 */
class OpenFile extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, flags = "r", mode = 0o666] = this.args;

    this.validatePath(filePath);

    const flagText = typeof flags === "string" ? flags : "r";

    if (flagText.includes("r") || flagText.includes("+")) {
      this.checkPermission("read", filePath);
    }

    if (/[wax+]/.test(flagText)) {
      this.checkPermission("write", filePath);
    }

    let handle: fsp.FileHandle;

    try {
      handle = yield hostAwait(fsp.open(filePath, flagText, mode));
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }

    const { value, state } = createResource({
      name: "File",
      counts: "file",
      pkg: PKG,
      close: () => handle.close(),
      describe: () => `File { path: "${filePath}", closed: ${state.closed} }`,
      members: {
        path: filePath,

        /** `read(size)` or `read(size, position)`; returns `bytes`, empty at the end. */
        read: class extends FSMethodBuilder {
          override *call(): Gen<any> {
            const [size = 65536, position = null] = this.args;

            state.assertOpen();
            this.assertInteger(size, "size");
            this.checkAllocation(size);

            const target = Buffer.alloc(size);

            const { bytesRead } = yield hostAwait(
              handle.read(target, 0, size, position),
            );

            return this.toBytes(target.subarray(0, bytesRead));
          }
        },

        /** Reads the whole file from the current position. */
        readAll: class extends FSMethodBuilder {
          override *call(): Gen<any> {
            state.assertOpen();

            return this.toBytes(yield hostAwait(handle.readFile()));
          }
        },

        /** `write(data)` or `write(data, position)`; returns the number of bytes written. */
        write: class extends FSMethodBuilder {
          override *call(): Gen<any> {
            const [data, position = null] = this.args;

            state.assertOpen();
            this.assertBinary(data, "data");

            const payload = this.toBuffer(data);

            const { bytesWritten } = yield hostAwait(
              handle.write(payload, 0, payload.length, position),
            );

            return bytesWritten;
          }
        },

        stat: class extends FSMethodBuilder {
          override *call(): Gen<any> {
            state.assertOpen();

            return createStatsObject(yield hostAwait(handle.stat()));
          }
        },

        truncate: class extends FSMethodBuilder {
          override *call(): Gen<any> {
            const [len = 0] = this.args;

            state.assertOpen();

            yield hostAwait(handle.truncate(len));

            return null;
          }
        },

        sync: class extends FSMethodBuilder {
          override *call(): Gen<any> {
            state.assertOpen();

            yield hostAwait(handle.sync());

            return null;
          }
        },
      },
    });

    return value;
  }
}

// ------------------------------------------------------------------- helpers

class FSUtils extends FSMethodBuilder {
  override call() {
    return {
      copyDir: class extends FSMethodBuilder {
        override *call(): Gen<any> {
          const [src, dest, options = {}] = this.args;

          this.readPath(src, "src");
          this.writePath(dest, "dest");

          try {
            yield hostAwait(
              fsp.cp(src, dest, { recursive: true, ...options }),
            );

            return null;
          } catch (error: any) {
            throw this.throwErrorFormatters(error);
          }
        }
      },

      removeDir: class extends FSMethodBuilder {
        override *call(): Gen<any> {
          const [dirPath, options = {}] = this.args;

          this.writePath(dirPath);

          try {
            yield hostAwait(
              fsp.rm(dirPath, { recursive: true, force: true, ...options }),
            );

            return null;
          } catch (error: any) {
            throw this.throwErrorFormatters(error);
          }
        }
      },

      ensureDir: class extends FSMethodBuilder {
        override *call(): Gen<any> {
          const [dirPath] = this.args;

          this.writePath(dirPath);

          try {
            yield hostAwait(fsp.mkdir(dirPath, { recursive: true }));

            return null;
          } catch (error: any) {
            throw this.throwErrorFormatters(error);
          }
        }
      },

      move: class extends FSMethodBuilder {
        override *call(): Gen<any> {
          const [src, dest] = this.args;

          this.readPath(src, "src");
          this.writePath(src, "src");
          this.writePath(dest, "dest");

          try {
            yield hostAwait(fsp.rename(src, dest));

            return null;
          } catch (error: any) {
            // across devices `rename` fails: fall back to copy + delete
            if (error?.code !== "EXDEV") {
              throw this.throwErrorFormatters(error);
            }

            try {
              yield hostAwait(fsp.cp(src, dest, { recursive: true }));
              yield hostAwait(fsp.rm(src, { recursive: true, force: true }));

              return null;
            } catch (fallbackError: any) {
              throw this.throwErrorFormatters(fallbackError);
            }
          }
        }
      },

      getSize: class extends FSMethodBuilder {
        override *call(): Gen<any> {
          const [target] = this.args;

          this.readPath(target);

          try {
            const stats = yield hostAwait(fsp.stat(target));

            if (!stats.isDirectory()) return stats.size;

            return yield this.directorySize(target);
          } catch (error: any) {
            throw this.throwErrorFormatters(error);
          }
        }

        private *directorySize(dirPath: string): Gen<number> {
          const entries = yield hostAwait(
            fsp.readdir(dirPath, { withFileTypes: true }),
          );

          let total = 0;

          for (const entry of entries) {
            const full = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
              total += yield this.directorySize(full);
            } else {
              total += (yield hostAwait(fsp.stat(full))).size;
            }
          }

          return total;
        }
      },

      isEmpty: class extends FSMethodBuilder {
        override *call(): Gen<any> {
          const [dirPath] = this.args;

          this.readPath(dirPath);

          try {
            const stats = yield hostAwait(fsp.stat(dirPath));

            if (!stats.isDirectory()) return false;

            return (yield hostAwait(fsp.readdir(dirPath))).length === 0;
          } catch {
            return false;
          }
        }
      },

      createTemp: class extends FSMethodBuilder {
        override *call(): Gen<any> {
          const [prefix = "tmp-", suffix = "", dir] = this.args;

          const tmpDir = dir || os.tmpdir();
          const tmpPath = path.join(
            tmpDir,
            prefix + Math.random().toString(36).slice(2) + suffix,
          );

          this.writePath(tmpPath);

          try {
            yield hostAwait(fsp.writeFile(tmpPath, ""));

            return tmpPath;
          } catch (error: any) {
            throw this.throwErrorFormatters(error);
          }
        }
      },

      walk: class extends FSMethodBuilder {
        override *call(): Gen<any> {
          const [dirPath, callback, options = {}] = this.args;

          this.readPath(dirPath);
          this.validateFunction(callback);

          try {
            yield this.walkDir(dirPath, callback, options);

            return null;
          } catch (error: any) {
            throw this.throwErrorFormatters(error);
          }
        }

        private *walkDir(
          dirPath: string,
          callback: any,
          options: any,
        ): Gen<void> {
          const files = yield hostAwait(fsp.readdir(dirPath));

          for (const file of files) {
            const fullPath = path.join(dirPath, file);
            const stats = yield hostAwait(fsp.stat(fullPath));

            const continueWalk = yield lift(
              this.executeCallback(callback, [
                fullPath,
                createStatsObject(stats),
              ]),
            );

            if (
              stats.isDirectory() &&
              continueWalk !== false &&
              !options.shallow
            ) {
              yield this.walkDir(fullPath, callback, options);
            }
          }
        }
      },
    };
  }
}

module.exports = {
  readFile: ReadFile,
  writeFile: WriteFile,
  appendFile: AppendFile,
  readdir: ReadDir,
  makedir: MakeDir,
  removedir: RemoveDir,
  stat: Stat,
  lstat: LStat,
  unlink: Unlink,
  rename: Rename,
  copyFile: CopyFile,
  access: Access,
  chmod: Chmod,
  chown: Chown,
  symlink: Symlink,
  readlink: ReadLink,
  realpath: RealPath,
  truncate: Truncate,
  exists: Exists,
  constants: {
    F_OK: fs.constants.F_OK,
    R_OK: fs.constants.R_OK,
    W_OK: fs.constants.W_OK,
    X_OK: fs.constants.X_OK,
    COPYFILE_EXCL: fs.constants.COPYFILE_EXCL,
    COPYFILE_FICLONE: fs.constants.COPYFILE_FICLONE,
    COPYFILE_FICLONE_FORCE: fs.constants.COPYFILE_FICLONE_FORCE,
  },
  Watcher: FSWatcher,
  WatchFile,
  open: Open,
  file: OpenFile,
  close: Close,
  read: Read,
  write: Write,
  FStat,
  FSUtils,
};
