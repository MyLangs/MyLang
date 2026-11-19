import "core:test" as { describe, test, assert, finish };
import "time";

describe("spawn", func() {
  test("returns a handle that reports the result", func() {
    var h = spawn { return 5; };
    var r = wait h;
    assert.equal(r.result, 5);
    assert.equal(r.status, "fulfilled");
    assert.isTrue(r.done);
  });

  test("the handle is a live view of the task", func() {
    var h = spawn { time.Sleep(5); return "late"; };
    wait h;
    assert.equal(h.status, "fulfilled");
    assert.equal(h.result, "late");
    assert.isTrue(h.done);
    assert.isTrue(h.isFinished());
    assert.isFalse(h.isCancelled());
  });

  test("starts running immediately", func() {
    var log = [];
    var h = spawn { log[length(log)] = "in task"; return 1; };
    log[length(log)] = "after spawn";
    wait h;
    assert.equal(log, ["in task", "after spawn"]);
  });

  test("a task that sleeps lets the caller continue", func() {
    var log = [];
    var h = spawn { time.Sleep(10); log[length(log)] = "task done"; };
    log[length(log)] = "caller continues";
    wait h;
    assert.equal(log, ["caller continues", "task done"]);
  });

  test("a task can read and update outer variables", func() {
    var n = 1;
    var h = spawn { n += 10; return n; };
    wait h;
    assert.equal(n, 11);
  });

  test("the task body has its own scope", func() {
    var h = spawn { var inside = 1; return inside; };
    wait h;
    assert.throws(func() { var x = inside; }, "is not defined");
    var r = 1;
    var h2 = spawn { var r = 5; return r; };
    wait h2;
    assert.equal(r, 1);
  });

  test("spawn a function call", func() {
    func work(x) { time.Sleep(1); return x * 2; }
    var h = spawn work(21);
    var r = wait h;
    assert.equal(r.result, 42);
  });

  test("spawn an anonymous function", func() {
    var h = spawn func() { return "from lambda"; };
    var r = wait h;
    assert.equal(r.result, "from lambda");
  });

  test("tasks can spawn tasks", func() {
    var outer = spawn {
      var inner = spawn { return 7; };
      var r = wait inner;
      return r.result * 2;
    };
    var result = wait outer;
    assert.equal(result.result, 14);
  });

  test("spawned loops are preempted instead of starving others", func() {
    var log = [];
    var busy = spawn {
      for (var i = 0; i < 3000; i++) {}
      log[length(log)] = "busy";
    };
    var quick = spawn { log[length(log)] = "quick"; };
    wait busy;
    wait quick;
    assert.equal(log, ["quick", "busy"]);
  });
});

describe("Failures are isolated", func() {
  test("an error is stored in the handle", func() {
    var h = spawn { throw "bad"; };
    var r = wait h;
    assert.equal(r.status, "rejected");
    assert.equal(r.error.message, "bad");
    assert.equal(h.status, "rejected");
    assert.isTrue(h.done);
  });

  test("wait never throws for a failed task", func() {
    var h = spawn { throw "isolated"; };
    assert.doesNotThrow(func() { wait h; });
  });

  test("the spawner keeps running", func() {
    var h = spawn { var n = nil; return n.field; };
    wait h;
    assert.equal(h.status, "rejected");
    assert.equal(1 + 1, 2);
  });

  test("waiting for something that is not a task is an error", func() {
    assert.throws(func() { wait 5; }, "Spawn");
  });
});

describe("cancel", func() {
  test("a cancelled task reports it", func() {
    var h = spawn { time.Sleep(500); return "never"; };
    time.Sleep(2);
    h.cancel();
    assert.isTrue(h.isCancelled());
    assert.equal(h.status, "cancelled");
    assert.isTrue(h.isFinished());
  });

  test("the task stops at its next suspension point", func() {
    var log = [];
    var h = spawn {
      time.Sleep(200);
      log[length(log)] = "should not run";
    };
    time.Sleep(2);
    h.cancel();
    time.Sleep(30);
    assert.equal(log, []);
  });

  test("pending defers run while unwinding", func() {
    var log = [];
    var h = spawn {
      defer log[length(log)] = "cleanup";
      time.Sleep(500);
      log[length(log)] = "never";
    };
    time.Sleep(2);
    h.cancel();
    time.Sleep(30);
    assert.equal(log, ["cleanup"]);
  });

  test("cancelling a finished task changes nothing", func() {
    var h = spawn { return 1; };
    wait h;
    h.cancel();
    assert.equal(h.status, "fulfilled");
    assert.isFalse(h.isCancelled());
  });
});

describe("wait combinators", func() {
  test("wait.all collects every result", func() {
    var a = spawn { time.Sleep(3); return 1; };
    var b = spawn { return 2; };
    var c = spawn { time.Sleep(1); return 3; };
    assert.equal(wait.all([a, b, c]), [1, 2, 3]);
  });

  test("wait.race returns the first to finish", func() {
    var slow = spawn { time.Sleep(60); return "slow"; };
    var fast = spawn { time.Sleep(2); return "fast"; };
    assert.equal(wait.race([slow, fast]), "fast");
  });

  test("wait.any skips failures", func() {
    var bad = spawn { throw "x"; };
    var good = spawn { time.Sleep(2); return "ok"; };
    assert.equal(wait.any([bad, good]), "ok");
  });

  test("wait.allSettled reports every outcome", func() {
    var a = spawn { return 1; };
    var b = spawn { throw "x"; };
    var r = wait.allSettled([a, b]);
    assert.equal(r[0], { status: "fulfilled", value: 1 });
    assert.equal(r[1], { status: "rejected", reason: "x" });
  });

  test("parallel tasks overlap in time", func() {
    var start = time.now();
    var a = spawn { time.Sleep(40); };
    var b = spawn { time.Sleep(40); };
    var c = spawn { time.Sleep(40); };
    wait a;
    wait b;
    wait c;
    var elapsed = time.now() - start;
    assert.less(elapsed, 110);
  });

  test("results of many tasks can be summed", func() {
    var tasks = [];
    for (var i = 1; i <= 4; i++) {
      var k = i;
      tasks[length(tasks)] = spawn { time.Sleep(2); return k * k; };
    }
    var total = 0;
    for (var t in tasks) {
      var r = wait t;
      total += r.result;
    }
    assert.equal(total, 30);
  });
});

describe("output callbacks", func() {
  test("output receives the result", func() {
    var got = [];
    var h = spawn { return 3; };
    h.output(func(v) { got[length(got)] = v; }, func(e) { got[length(got)] = "error"; });
    wait h;
    time.Sleep(5);
    assert.equal(got, [3]);
  });

  test("output receives the error", func() {
    var got = [];
    var h = spawn { throw "oops"; };
    h.output(func(v) { got[length(got)] = "value"; }, func(e) { got[length(got)] = e.message; });
    wait h;
    time.Sleep(5);
    assert.equal(got, ["oops"]);
  });
});

finish("concurrency");
