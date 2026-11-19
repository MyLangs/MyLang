/**
 * Non-blocking bridges from the Node.js event loop into the interpreter's coroutines.
 *
 * The interpreter never uses `async`/`await`: a task that waits for the host is *parked*
 * and the scheduler keeps running every other task. These helpers are the only way a
 * library should wait for host work, so `spawn lib.something()` really is concurrent
 * instead of running a synchronous call inside a task.
 *
 * A library that still calls a `*Sync` host function blocks the whole program, however it
 * is spawned - that is exactly what these helpers exist to avoid.
 */

import { park, hostAwait, type Gen } from "../../src/runtime/coroutine";

type NodeCallback<T> = (error: NodeJS.ErrnoException | null, value?: T) => void;

/** Minimal shape of a Node event emitter, without importing the host types. */
interface EmitterLike {
  once(event: string, listener: (...args: any[]) => void): any;
  removeListener(event: string, listener: (...args: any[]) => void): any;
}

/**
 * Park the task until a Node-style `(error, value)` callback fires.
 *
 *   const data = yield fromCallback<Buffer>((done) => fs.readFile(path, done));
 */
function* fromCallback<T = any>(
  register: (callback: NodeCallback<T>) => void,
): Gen<T> {
  return yield park<T>((wake, fail) => {
    let settled = false;

    register((error, value) => {
      if (settled) return;
      settled = true;

      if (error) fail(error);
      else wake(value);
    });
  });
}

/**
 * Park the task until `emitter` emits `event` (resolving with its first argument) or
 * `errorEvent` (failing with it). Both listeners are removed either way.
 */
function* fromEvent<T = any>(
  emitter: EmitterLike,
  event: string,
  errorEvent: string | null = "error",
): Gen<T> {
  return yield park<T>((wake, fail) => {
    let settled = false;

    const onSuccess = (value: any) => {
      if (settled) return;
      settled = true;
      detach();
      wake(value);
    };

    const onError = (error: any) => {
      if (settled) return;
      settled = true;
      detach();
      fail(error);
    };

    const detach = () => {
      emitter.removeListener(event, onSuccess);
      if (errorEvent) emitter.removeListener(errorEvent, onError);
    };

    emitter.once(event, onSuccess);
    if (errorEvent) emitter.once(errorEvent, onError);

    return detach;
  });
}

/**
 * Read a Node readable stream to the end without blocking, returning the concatenated
 * chunks. Used by `fs`, `archive`, `compress` and the network libraries.
 */
function* collectStream(stream: any): Gen<Buffer> {
  const chunks: Buffer[] = [];

  yield park<void>((wake, fail) => {
    let settled = false;

    const onData = (chunk: any) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      detach();
      wake();
    };

    const onError = (error: any) => {
      if (settled) return;
      settled = true;
      detach();
      fail(error);
    };

    const detach = () => {
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
    };

    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onError);

    return detach;
  });

  return Buffer.concat(chunks);
}

/** Write to a Node writable stream, parking until the chunk was flushed. */
function* writeStream(stream: any, chunk: Buffer | string): Gen<void> {
  yield fromCallback<void>((done) => {
    stream.write(chunk, (error: any) => done(error ?? null));
  });
}

export {
  fromCallback,
  fromEvent,
  collectStream,
  writeStream,
  hostAwait,
  type NodeCallback,
  type EmitterLike,
};
