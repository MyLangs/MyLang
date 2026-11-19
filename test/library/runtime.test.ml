import "core:test" as { describe, test, assert, finish };
import "runtime";
import "time";

describe("runtime: go / schedule", func() {
  test("go runs a function as a task and returns a handle", func() {
    var h = runtime.go(func() { return 5; });
    var r = wait h;
    assert.equal(r.result, 5);
    assert.equal(r.status, "fulfilled");
  });

  test("a failing job is isolated in its handle", func() {
    var h = runtime.go(func() { throw "bad"; });
    var r = wait h;
    assert.equal(r.status, "rejected");
    assert.equal(r.error.message, "bad");
  });

  test("schedule runs jobs", func() {
    var log = [];
    var a = runtime.schedule(func() { time.Sleep(10); log[length(log)] = "a"; });
    var b = runtime.schedule(func() { log[length(log)] = "b"; });
    wait a;
    wait b;
    assert.lengthOf(log, 2);
    assert.includes(log, "a");
    assert.includes(log, "b");
  });

  test("scheduleDelayed waits before running", func() {
    var started = time.now();
    var h = runtime.scheduleDelayed(func() { return time.now() - started; }, 50);
    var r = wait h;
    assert.greaterOrEqual(r.result, 45);
  });

  test("waitForIdle suspends until every job has finished", func() {
    var done = 0;
    runtime.go(func() { time.Sleep(20); done++; });
    runtime.go(func() { time.Sleep(20); done++; });
    runtime.waitForIdle();
    assert.equal(done, 2);
  });

  test("scheduleRepeating runs a limited number of times", func() {
    var runs = 0;
    runtime.scheduleRepeating(func() { runs++; }, 15, 3);
    time.Sleep(120);
    assert.equal(runs, 3);
  });

  test("a repeating job can be cancelled", func() {
    var runs = 0;
    var job = runtime.scheduleRepeating(func() { runs++; }, 15);
    time.Sleep(50);
    job.cancel();
    var seen = runs;
    assert.greaterOrEqual(seen, 2);
    time.Sleep(50);
    assert.equal(runs, seen);
  });

  test("validation", func() {
    assert.throws(func() { runtime.go(5); }, "must be of type function");
    assert.throws(func() { runtime.scheduleDelayed(func() {}, "x"); }, "must be of type int");
    assert.throws(func() { runtime.scheduleRepeating(func() {}, "x"); }, "must be of type int");
  });
});

describe("runtime: Spawn", func() {
  test("a task created with Spawn does not start until run()", func() {
    var log = [];
    var task = runtime.Spawn(func() { log[length(log)] = "ran"; return 9; });
    time.Sleep(10);
    assert.equal(log, []);
    task.run();
    var r = wait task;
    assert.equal(log, ["ran"]);
    assert.equal(r.result, 9);
  });

  test("Spawn needs a function", func() {
    assert.throws(func() { runtime.Spawn(5); }, "must be of type function");
  });
});

describe("runtime: Scheduler", func() {
  test("limits how many jobs run at the same time", func() {
    var s = runtime.Scheduler(2);
    var active = 0;
    var peak = 0;
    for (var i = 0; i < 6; i++) {
      s.go(func() {
        active++;
        if (active > peak) { peak = active; }
        time.Sleep(15);
        active--;
      });
    }
    s.waitForIdle();
    assert.equal(peak, 2);
  });

  test("the default concurrency is one", func() {
    var s = runtime.Scheduler();
    var active = 0;
    var peak = 0;
    for (var i = 0; i < 3; i++) {
      s.go(func() {
        active++;
        if (active > peak) { peak = active; }
        time.Sleep(10);
        active--;
      });
    }
    s.waitForIdle();
    assert.equal(peak, 1);
  });

  test("scheduleFirst jumps the queue", func() {
    var s = runtime.Scheduler(1);
    var log = [];
    s.go(func() { time.Sleep(30); log[length(log)] = "first"; });
    s.schedule(func() { log[length(log)] = "queued"; });
    s.scheduleFirst(func() { log[length(log)] = "priority"; });
    s.waitForIdle();
    assert.equal(log, ["first", "priority", "queued"]);
  });

  test("queueSize and isRunning describe the pool", func() {
    var s = runtime.Scheduler(1);
    assert.isFalse(s.isRunning);
    assert.equal(s.queueSize, 0);
    s.go(func() { time.Sleep(40); });
    s.go(func() {});
    s.go(func() {});
    assert.isTrue(s.isRunning);
    assert.equal(s.queueSize, 2);
    s.waitForIdle();
    assert.isFalse(s.isRunning);
    assert.equal(s.queueSize, 0);
  });

  test("clear drops jobs that have not started", func() {
    var s = runtime.Scheduler(1);
    var log = [];
    s.go(func() { time.Sleep(30); log[length(log)] = "running"; });
    s.go(func() { log[length(log)] = "dropped"; });
    s.clear();
    s.waitForIdle();
    assert.equal(log, ["running"]);
  });

  test("cancelAll stops running and queued jobs", func() {
    var s = runtime.Scheduler(1);
    var log = [];
    s.go(func() { time.Sleep(100); log[length(log)] = "ran"; });
    s.go(func() { log[length(log)] = "queued"; });
    time.Sleep(5);
    s.cancelAll();
    time.Sleep(20);
    assert.equal(log, []);
    assert.equal(s.queueSize, 0);
  });

  test("a queued job can be cancelled through its handle", func() {
    var s = runtime.Scheduler(1);
    s.go(func() { time.Sleep(40); });
    var h = s.go(func() { return "never"; });
    h.cancel();
    s.waitForIdle();
    assert.isTrue(h.isCancelled());
    assert.equal(h.status, "cancelled");
  });

  test("scheduleDelayed and scheduleRepeating on a pool", func() {
    var s = runtime.Scheduler(1);
    var h = s.scheduleDelayed(func() { return "late"; }, 30);
    var late = wait h;
    assert.equal(late.result, "late");
    var runs = 0;
    s.scheduleRepeating(func() { runs++; }, 10, 4);
    time.Sleep(120);
    assert.equal(runs, 4);
  });

  test("validation", func() {
    assert.throws(func() { runtime.Scheduler("x"); }, "must be of type int");
    assert.throws(func() { runtime.Scheduler(1).go(5); }, "must be of type function");
  });
});

finish("runtime");
