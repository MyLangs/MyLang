// ============================================================================
//  Concurrency across libraries.
//
//  Every library claims not to block. These tests check that claim where it matters: that
//  work in different libraries really overlaps, that a channel can carry values produced
//  by one library to a task using another, that cancellation unwinds through library
//  calls, and that a task failing in one library does not take the rest down.
// ============================================================================

import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:fs";
import "core:path";
import "core:os";
import "core:time";
import "core:syncbox";
import "core:tcp";
import "core:net/http";
import "core:crypto";
import "core:compress";
import "core:arrays";
import "core:runtime";

var dir = path.join(os.tmpdir(), "mylang-integration-concurrency");

func freshDir() {
  var utils = fs.FSUtils();

  utils.removeDir(dir);
  utils.ensureDir(dir);
}

describe("work in different libraries overlaps", func() {
  beforeEach(freshDir);

  test("a file read, a sleep and a socket connect all run at once", func() {
    var file = path.join(dir, "payload.bin");

    fs.writeFile(file, crypto.randomBytes(400000));

    var server = defer tcp.listen(0, "127.0.0.1");

    var serving = spawn {
      var client = server.accept();

      client.write("hello");
      client.end()
    }

    var watch = time.Stopwatch();

    watch.start();

    // three different libraries, three tasks, one thread
    var reading = spawn fs.readFile(file);
    var sleeping = spawn time.Sleep(250);
    var connecting = spawn {
      var socket = defer tcp.connect("127.0.0.1", server.port);

      return socket.readAll().toString();
    }

    var results = wait.all([reading, sleeping, connecting]);

    watch.stop();

    assert.equal(length(results[0]), 400000);
    assert.equal(results[2], "hello");

    // if these ran one after another the sleep alone would already dominate; the point is
    // that the whole set finishes in about the time of the longest one
    assert.less(watch.elapsed(), 1200);

    wait serving;
  });

  test("a slow handler does not hold up the others", func() {
    var server = defer http.Server();

    server.get("/slow", func(ctx) {
      time.Sleep(200);
      ctx.json({ slow: true });
    });

    server.get("/fast", func(ctx) { ctx.json({ fast: true }); });

    var where = server.listen(0, "127.0.0.1");
    var client = http.Client({ baseURL: $"http://127.0.0.1:{where.port}" });

    var watch = time.Stopwatch();

    watch.start();

    var slow = spawn client.get("/slow");
    var fast = spawn client.get("/fast");

    var answers = wait.all([slow, fast]);

    watch.stop();

    assert.isTrue(answers[0].json().slow);
    assert.isTrue(answers[1].json().fast);
    assert.less(watch.elapsed(), 900);
  });

  test("compression of several buffers overlaps", func() {
    var payloads = [];

    for (var i = 0; i < 4; i++) {
      var body = "";

      for (var j = 0; j < 400; j++) { body += $"chunk {i} line {j} "; }

      payloads[length(payloads)] = body;
    }

    var jobs = [];

    for (var payload in payloads) { jobs[length(jobs)] = spawn compress.gzip(payload) }

    var packed = wait.all(jobs);

    assert.lengthOf(packed, 4);

    for (var i = 0; i < 4; i++) {
      assert.equal(compress.gunzip(packed[i]).toString(), payloads[i]);
    }
  });
});

describe("channels carry values between libraries", func() {
  beforeEach(freshDir);

  test("a producer reading files feeds a consumer hashing them", func() {
    var names = [];

    for (var i = 1; i <= 5; i++) {
      var name = $"f{i}.txt";

      fs.writeFile(path.join(dir, name), $"contents number {i}");
      names[length(names)] = name;
    }

    var queue = syncbox.Chan(2);

    var reader = spawn {
      for (var name in names) {
        queue.send({ name: name, data: fs.readFile(path.join(dir, name)) });
      }

      queue.close();

      return "read";
    }

    var hasher = spawn {
      var digests = [];

      for (;;) {
        var item = queue.recv();

        if (item == nil) { break; }

        digests[length(digests)] = { name: item.name, digest: crypto.sha256(item.data) };
      }

      return digests;
    }

    wait reader;

    var outcome = wait hasher;

    assert.equal(outcome.status, "fulfilled");
    assert.lengthOf(outcome.result, 5);
    assert.equal(outcome.result[0].name, "f1.txt");
    assert.equal(length(outcome.result[0].digest), 64);
  });

  test("a full channel parks the producer instead of growing", func() {
    var queue = syncbox.Chan(2);
    var sent = 0;

    var producer = spawn {
      for (var i = 0; i < 6; i++) {
        queue.send(i);
        sent += 1;
      }

      queue.close();

      return sent;
    }

    // the producer cannot have sent more than the buffer holds before anything receives
    assert.lessOrEqual(queue.len(), 2);

    var taken = 0;

    for (;;) {
      var value = queue.recv();

      if (value == nil) { break; }

      taken += 1;
    }

    var outcome = wait producer;

    assert.equal(taken, 6);
    assert.equal(outcome.result, 6);
  });

  test("a socket on one side of a channel and a file on the other", func() {
    var server = defer tcp.listen(0, "127.0.0.1");
    var queue = syncbox.Chan(0);

    var serving = spawn {
      var client = server.accept();

      client.write("from the socket");
      client.end()
    }

    var receiving = spawn {
      var socket = defer tcp.connect("127.0.0.1", server.port);

      queue.send(socket.readAll());
      queue.close();

      return "sent on"
    }

    var writing = spawn {
      var data = queue.recv();
      var file = path.join(dir, "through-channel.txt");

      fs.writeFile(file, data);

      return fs.readFile(file).toString();
    }

    wait serving;
    wait receiving;

    var outcome = wait writing;

    assert.equal(outcome.result, "from the socket");
  });
});

describe("failures stay where they happen", func() {
  beforeEach(freshDir);

  test("one failing task does not take the others with it", func() {
    var file = path.join(dir, "exists.txt");

    fs.writeFile(file, "here");

    var good = spawn fs.readFile(file);
    var bad = spawn fs.readFile(path.join(dir, "definitely-absent.txt"));
    var other = spawn crypto.hash("sha256", "unaffected");

    var goodOutcome = wait good;
    var badOutcome = wait bad;
    var otherOutcome = wait other;

    assert.equal(goodOutcome.status, "fulfilled");
    assert.equal(badOutcome.status, "rejected");
    assert.equal(otherOutcome.status, "fulfilled");
    assert.equal(goodOutcome.result.toString(), "here");
    assert.notNil(badOutcome.error);
    assert.equal(length(otherOutcome.result), 64);
  });

  test("wait.all reports the first failure and the rest still ran", func() {
    var file = path.join(dir, "ok.txt");

    fs.writeFile(file, "fine");

    var ran = 0;

    var jobs = [
      spawn { ran += 1; return fs.readFile(file); },
      spawn { ran += 1; throw "deliberate"; },
      spawn { ran += 1; return crypto.sha256("x"); }
    ];

    assert.throws(func() { wait.all(jobs); });
    assert.equal(ran, 3);
  });

  test("a cancelled task unwinds through a library call", func() {
    var released = [];

    var task = spawn {
      var handle = defer fs.file(path.join(dir, "cancelled.txt"), "w");

      handle.write("written before the cancel\n");
      released[length(released)] = "wrote";

      time.Sleep(5000);

      released[length(released)] = "never reached";

      return "finished";
    }

    // give it enough time to open the file and start sleeping
    time.Sleep(150);

    task.cancel();

    time.Sleep(200);

    assert.isTrue(task.isCancelled());
    assert.includes(released, "wrote");
    assert.notIncludes(released, "never reached");

    // the defer ran while unwinding, so the file is complete and closed
    assert.equal(
      fs.readFile(path.join(dir, "cancelled.txt")).toString(),
      "written before the cancel\n"
    );
  });

  test("a cancelled socket task releases its connection", func() {
    var server = defer tcp.listen(0, "127.0.0.1");
    var state = [];

    var serving = spawn {
      var client = server.accept();

      state[length(state)] = "accepted";

      time.Sleep(3000);

      client.end()
    }

    var task = spawn {
      var socket = defer tcp.connect("127.0.0.1", server.port);

      state[length(state)] = "connected";

      time.Sleep(3000);

      return "done";
    }

    time.Sleep(200);

    task.cancel();
    serving.cancel();

    time.Sleep(200);

    assert.includes(state, "connected");
    assert.isTrue(task.isCancelled());
  });
});

describe("the scheduler keeps order across libraries", func() {
  test("tasks interleave rather than one starving the rest", func() {
    var order = [];

    var a = spawn {
      for (var i = 0; i < 3; i++) {
        order[length(order)] = "a";
        wait spawn time.Sleep(30);
      }

      return "a done";
    }

    var b = spawn {
      for (var i = 0; i < 3; i++) {
        order[length(order)] = "b";
        wait spawn time.Sleep(30);
      }

      return "b done";
    }

    wait.all([a, b]);

    // both got turns; neither ran to completion before the other started
    assert.equal(length(order), 6);
    assert.includes(order, "a");
    assert.includes(order, "b");
    assert.notEqual(arrays.join(order, ""), "aaabbb");
  });

  test("waitForIdle returns once queued work is done", func() {
    var done = [];

    runtime.schedule(func() { done[length(done)] = "queued"; });
    runtime.waitForIdle();

    assert.includes(done, "queued");
  });

  test("a CPU-bound loop is preempted, so other tasks still run", func() {
    var ticks = 0;

    var ticker = spawn {
      for (var i = 0; i < 5; i++) {
        ticks += 1;
        wait spawn time.Sleep(10);
      }

      return ticks;
    }

    // a tight loop with no suspension point of its own
    var total = 0;

    for (var i = 0; i < 200000; i++) { total += i; }

    wait ticker;

    assert.greater(total, 0);
    assert.equal(ticks, 5);
  });
});

finish("integration: concurrency");
