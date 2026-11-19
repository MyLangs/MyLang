import "core:test" as { describe, test, assert, finish };
import "core:workers";
import "core:path";
import "core:time";
import "core:bytes";

// Relative to this file: a worker path is resolved against the file that starts it.
var fixtures = "../fixtures/workers";

describe("workers: running a file on another thread", func() {
  test("the worker's result comes back", func() {
    var w = workers.start(path.join(fixtures, "sum.ml"), { data: 1000 });

    assert.equal(w.result(), 499500);

    w.close();
  });

  test("messages travel both ways", func() {
    var w = workers.start(path.join(fixtures, "echo.ml"));

    w.post("first");
    assert.equal(w.receive(), "echo:first");

    w.post("second");
    assert.equal(w.receive(), "echo:second");

    assert.equal(w.result(), "done");

    w.close();
  });

  test("worker.data carries the value it was started with", func() {
    var w = workers.start(path.join(fixtures, "sum.ml"), { data: 10 });

    assert.equal(w.result(), 45);

    w.close();
  });

  test("a failing worker reports its error", func() {
    var w = workers.start(path.join(fixtures, "fails.ml"));

    assert.throws(func() { w.result(); }, "worker exploded");

    w.close();
  });

  test("a missing file is reported before the thread starts", func() {
    assert.throws(
      func() { workers.start(path.join(fixtures, "nope.ml")); },
      "worker file not found"
    );
  });
});

describe("workers: the thread really is separate", func() {
  // This is the whole point of a worker: the interpreter is single-threaded, so a long
  // computation in this program would hold the thread, while the same work in a worker
  // does not.
  test("the program keeps running while the worker computes", func() {
    var ticks = 0;
    var running = true;

    var ticker = spawn {
      while (running) {
        ticks += 1;
        wait spawn time.Sleep(1);
      }
    };

    var w = workers.start(path.join(fixtures, "sum.ml"), { data: 3000000 });
    var total = w.result();

    running = false;
    wait ticker;

    assert.greater(total, 0);
    assert.greater(ticks, 1);

    w.close();
  });
});

describe("workers: resources", func() {
  test("defer terminates the worker", func() {
    func scoped() {
      var w = defer workers.start(path.join(fixtures, "echo.ml"));
      return w;
    }

    assert.isTrue(scoped().closed);
  });

  test("close is idempotent", func() {
    var w = workers.start(path.join(fixtures, "sum.ml"), { data: 1 });

    w.result();
    w.close();
    w.close();

    assert.isTrue(w.closed);
  });

  test("posting to a terminated worker is an error", func() {
    var w = workers.start(path.join(fixtures, "echo.ml"));

    w.close();

    assert.throws(func() { w.post("x"); }, "already terminated");
  });
});

describe("workers: helpers", func() {
  test("isWorker tells a thread which side it is on", func() {
    // false in an ordinary run; true when `mylang test --jobs` put this file on a thread
    assert.typeOf(workers.isWorker(), "boolean");
  });

  test("cpus reports the available parallelism", func() {
    assert.greater(workers.cpus(), 0);
  });
});

describe("workers: bytes across the boundary", func() {
  test("bytes arrive as bytes, not as a shape that looks like them", func() {
    var w = defer workers.start(path.join(fixtures, "pool-bytes.ml"));

    w.post(bytes.Bytes("hello"));

    var answer = w.receive();

    assert.equal(answer.size, 5);
    assert.isTrue(answer.isBytes);
    assert.equal(answer.first, 104);
  });

  test("a copy leaves this side's bytes usable", func() {
    var w = defer workers.start(path.join(fixtures, "pool-bytes.ml"));
    var payload = bytes.Bytes("still here");

    w.post(payload);
    w.receive();

    assert.equal(payload.toString(), "still here");
  });

  // A transfer hands the memory over rather than copying it: cheap for a large buffer,
  // and the reason this side has to be told it no longer has the bytes.
  test("a transfer hands the memory over", func() {
    var w = defer workers.start(path.join(fixtures, "pool-bytes.ml"));
    var payload = bytes.alloc(64 * 1024, 65);

    w.post(payload, { transfer: true });

    var answer = w.receive();

    assert.equal(answer.size, 64 * 1024);
    assert.equal(answer.first, 65);
    assert.throws(func() { payload.toString(); }, "handed to a worker");
  });

  test("bytes nested in a value cross too", func() {
    var w = defer workers.start(path.join(fixtures, "nested-bytes.ml"));

    w.post({ name: "report", body: bytes.Bytes("ABC") });

    var back = w.receive();

    assert.equal(back.name, "report");
    assert.equal(back.body, "ABC");
    assert.isTrue(back.stillBytes);
  });
});

describe("workers: pool", func() {
  test("a pool answers more jobs than it has threads", func() {
    var pool = defer workers.pool(path.join(fixtures, "pool-double.ml"), 2);

    assert.equal(pool.size, 2);

    var tasks = [];
    for (var i = 0; i < 8; i++) { tasks[length(tasks)] = spawn pool.run(i) }

    var results = wait.all(tasks);

    assert.lengthOf(results, 8);
    assert.equal(results[0].doubled, 0);
    assert.equal(results[7].doubled, 14);
  });

  test("every thread is given back when the work is done", func() {
    var pool = defer workers.pool(path.join(fixtures, "pool-double.ml"), 2);

    pool.run(1);

    assert.equal(pool.busy(), 0);
    assert.equal(pool.queued(), 0);
  });

  test("defer closes the pool", func() {
    func scoped() {
      var pool = defer workers.pool(path.join(fixtures, "pool-double.ml"), 1);
      return pool;
    }

    var closed = scoped();

    assert.isTrue(closed.closed);
    assert.throws(func() { closed.run(1); }, "already closed");
  });

  test("a pool of less than one thread is refused", func() {
    assert.throws(
      func() { workers.pool(path.join(fixtures, "pool-double.ml"), 0); },
      "at least one thread"
    );
  });

  test("a worker that does not loop is reported plainly", func() {
    var pool = defer workers.pool(path.join(fixtures, "pool-once.ml"), 1);

    assert.equal(pool.run("first").answered, "first");
    assert.throws(func() { pool.run("second"); }, "loop over worker.receive()");
  });

  test("a missing worker file is reported before anything starts", func() {
    assert.throws(
      func() { workers.pool(path.join(fixtures, "not-a-file.ml"), 2); },
      "not found"
    );
  });
});

finish("workers");
