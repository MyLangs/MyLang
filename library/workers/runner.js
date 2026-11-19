/**
 * The entry point of a worker thread.
 *
 * It starts a second, independent interpreter in this thread, runs the MyLang file it was
 * given, and relays messages between that program and the thread that created it. The two
 * interpreters share nothing but the messages: separate scheduler, separate globals,
 * separate heap objects.
 *
 * Messages are structured-cloned by the host, so only plain data crosses the boundary -
 * which is what makes a worker safe to use for CPU-bound work that would otherwise occupy
 * the single interpreter thread.
 */

const fs = require("node:fs");
const path = require("node:path");
const { parentPort, workerData } = require("node:worker_threads");

const { run } = require("../../src/utils/utils");
const { security, Permissions, ResourceLimits } = require("../../src/security");

const { marshal, unmarshal } = require("./marshal");

/** Inbox of messages that arrived before the program asked for them. */
const inbox = [];
let waiting = null;

parentPort.on("message", (message) => {
  inbox.push(message);

  const waiter = waiting;

  if (!waiter) return;

  waiting = null;
  waiter();
});

/**
 * The `worker` module the program inside the thread sees: how it talks back to the thread
 * that started it. Installed as a global rather than an import, because it only exists
 * inside a worker.
 */
function buildWorkerApi(FunctionBuilder) {
  const pkgInfo = { name: "workers", path: __dirname };

  class Post extends FunctionBuilder {
    get pkgInfo() {
      return pkgInfo;
    }

    call() {
      const options = this.args[1];
      const handOver = Boolean(options && options["transfer"] === true);
      const prepared = marshal(this.args[0] ?? null, handOver);

      parentPort.postMessage(
        { kind: "message", value: prepared.value },
        prepared.transfer.length > 0 ? prepared.transfer : undefined,
      );

      return null;
    }
  }

  class Receive extends FunctionBuilder {
    get pkgInfo() {
      return pkgInfo;
    }

    *call() {
      const { park } = require("../../src/runtime/coroutine");

      while (inbox.length === 0) {
        yield park((wake) => {
          waiting = () => wake();

          return () => {
            waiting = null;
          };
        });
      }

      return unmarshal(inbox.shift(), this.environment);
    }
  }

  class Pending extends FunctionBuilder {
    get pkgInfo() {
      return pkgInfo;
    }

    call() {
      return inbox.length;
    }
  }

  return {
    post: Post,
    receive: Receive,
    pending: Pending,
    data: workerData.data ?? null,
  };
}

async function main() {
  const file = workerData.file;

  // the worker inherits the parent's policy: a sandboxed program cannot escape by
  // starting a thread
  security.configure(
    new Permissions(workerData.permissions ?? {}),
    new ResourceLimits(workerData.limits ?? {}),
  );

  const source = fs.readFileSync(file, "utf8");

  const { FunctionBuilder } = require("../FunctionBuilder");

  const result = await run(source, {
    base: path.dirname(file),
    main: file,
    options: {},
    onReady: (interpreter) => {
      interpreter.globalScore.create("worker", buildWorkerApi(FunctionBuilder));
    },
  });

  parentPort.postMessage({
    kind: "done",
    value: marshal(result.result ?? null).value,
  });
}

/**
 * The message port keeps the thread alive on its own, so it is closed once the program is
 * over. Without this a finished worker would hold the whole process open.
 */
function finish(code) {
  process.exitCode = code;

  try {
    parentPort.close();
  } catch {
    // the port may already be gone
  }
}

main().then(
  () => finish(0),
  (error) => {
    parentPort.postMessage({
      kind: "error",
      message: error && error.message ? error.message : String(error),
    });

    finish(1);
  },
);
