import "core:test" as { describe, test, assert, finish };
import "core:time";

describe("defer statement", func() {
  test("runs after the function body", func() {
    var log = [];
    func f() {
      defer log[length(log)] = "deferred";
      log[length(log)] = "body";
    }
    f();
    assert.equal(log, ["body", "deferred"]);
  });

  test("runs when the function returns", func() {
    var log = [];
    func f() {
      defer log[length(log)] = "deferred";
      return "result";
    }
    assert.equal(f(), "result");
    assert.equal(log, ["deferred"]);
  });

  test("runs on early return", func() {
    var log = [];
    func f(early) {
      defer log[length(log)] = "cleanup";
      if (early) { return "early"; }
      log[length(log)] = "more work";
      return "late";
    }
    assert.equal(f(true), "early");
    assert.equal(log, ["cleanup"]);
    assert.equal(f(false), "late");
    assert.equal(log, ["cleanup", "more work", "cleanup"]);
  });

  test("runs when an error is thrown", func() {
    var log = [];
    func f() {
      defer log[length(log)] = "cleanup";
      throw "failure";
    }
    try { f(); } catch (e) { log[length(log)] = "caught"; }
    assert.equal(log, ["cleanup", "caught"]);
  });

  test("accepts a block", func() {
    var log = [];
    func f() {
      defer {
        log[length(log)] = "a";
        log[length(log)] = "b";
      }
      log[length(log)] = "body";
    }
    f();
    assert.equal(log, ["body", "a", "b"]);
  });

  test("calls a function", func() {
    var log = [];
    func note(x) { log[length(log)] = x; }
    func f() {
      defer note("cleanup");
      note("work");
    }
    f();
    assert.equal(log, ["work", "cleanup"]);
  });

  test("arguments are evaluated when defer is reached", func() {
    var log = [];
    func note(x) { log[length(log)] = x; }
    func f() {
      var v = 1;
      defer note(v);
      v = 2;
    }
    f();
    assert.equal(log, [1]);
  });

  test("every deferred statement runs", func() {
    var count = 0;
    func f() {
      defer count += 1;
      defer count += 10;
      defer count += 100;
    }
    f();
    assert.equal(count, 111);
  });

  test("defer inside a block runs at the end of that block", func() {
    var log = [];
    func f() {
      for (var i = 0; i < 2; i++) {
        defer log[length(log)] = "end" + i;
        log[length(log)] = "it" + i;
      }
    }
    f();
    assert.equal(log, ["it0", "end0", "it1", "end1"]);
  });

  test("a deferred call does not run for a function that never reached it", func() {
    var log = [];
    func f(go) {
      if (!go) { return "skipped"; }
      defer log[length(log)] = "cleanup";
      return "ran";
    }
    f(false);
    assert.equal(log, []);
    f(true);
    assert.equal(log, ["cleanup"]);
  });
});

describe("defer runs in reverse order", func() {
  // Deferred work runs last-registered-first, so a resource opened later is released
  // before the one it was built on top of.
  test("statements run in reverse registration order", func() {
    var log = [];
    func f() {
      defer log[length(log)] = "a";
      defer log[length(log)] = "b";
      defer log[length(log)] = "c";
    }
    f();
    assert.equal(log, ["c", "b", "a"]);
  });

  test("resources are released in reverse order", func() {
    var log = [];
    func open(name) {
      return { name: name, [symbol.dispose]: func() { log[length(log)] = "close " + name; } };
    }
    func use() {
      var outer = defer open("outer");
      var inner = defer open("inner");
      log[length(log)] = "body";
    }
    use();
    assert.equal(log, ["body", "close inner", "close outer"]);
  });

  test("the order holds when the block ends with an error", func() {
    var log = [];
    func open(name) {
      return { [symbol.dispose]: func() { log[length(log)] = name; } };
    }
    func use() {
      var a = defer open("a");
      var b = defer open("b");
      throw "failure";
    }
    try { use(); } catch (e) { log[length(log)] = "caught"; }
    assert.equal(log, ["b", "a", "caught"]);
  });
});

describe("defer always runs every registration", func() {
  // A leaked resource is worse than a lost error message: a failing deferred call must
  // not stop the ones registered before it.
  test("a failing deferred statement does not skip the others", func() {
    var log = [];
    func f() {
      defer log[length(log)] = "first";
      defer { throw "cleanup failed"; }
      defer log[length(log)] = "third";
      log[length(log)] = "body";
    }
    try { f(); } catch (e) { log[length(log)] = "caught " + e.message; }
    assert.equal(log, ["body", "third", "first", "caught cleanup failed"]);
  });

  test("a failing disposer does not skip the other resources", func() {
    var log = [];
    func good(name) {
      return { [symbol.dispose]: func() { log[length(log)] = name; } };
    }
    func bad() {
      return { [symbol.dispose]: func() { throw "dispose failed"; } };
    }
    func use() {
      var a = defer good("a");
      var b = defer bad();
      var c = defer good("c");
    }
    try { use(); } catch (e) { log[length(log)] = "caught"; }
    assert.equal(log, ["c", "a", "caught"]);
  });

  test("the body's own error wins over a failing defer", func() {
    func f() {
      defer { throw "from defer"; }
      throw "from body";
    }
    var caught = assert.throws(func() { f(); });
    assert.equal(caught.message, "from body");
  });
});

describe("defer expression", func() {
  test("releases a resource through symbol.dispose", func() {
    var log = [];
    func open() {
      return {
        content: "data",
        [symbol.dispose]: func() { log[length(log)] = "disposed"; }
      };
    }
    func use() {
      var res = defer open();
      log[length(log)] = "using " + res.content;
      return "done";
    }
    assert.equal(use(), "done");
    assert.equal(log, ["using data", "disposed"]);
  });

  test("the value is returned so the resource is usable straight away", func() {
    func open() {
      return { id: 7, [symbol.dispose]: func() {} };
    }
    func use() {
      var res = defer open();
      return res.id;
    }
    assert.equal(use(), 7);
  });

  test("a value without symbol.dispose is reported clearly", func() {
    func plain() { return { a: 1 }; }
    func use() { var r = defer plain(); }

    assert.throws(func() { use(); }, "symbol.dispose");
  });

  test("nil is reported as clearly as any other value", func() {
    func nothing() { return nil; }
    func use() { var r = defer nothing(); }

    var caught = assert.throws(func() { use(); });
    assert.includes(caught.message, "symbol.dispose");
    assert.includes(caught.message, "nil");
  });

  test("a disposer may suspend", func() {
    var log = [];
    func open() {
      return {
        [symbol.dispose]: func() {
          wait spawn time.Sleep(5);
          log[length(log)] = "disposed late";
        }
      };
    }
    func use() {
      var r = defer open();
      log[length(log)] = "body";
    }
    use();
    assert.equal(log, ["body", "disposed late"]);
  });

  test("a resource released explicitly is not released twice", func() {
    var closes = 0;
    func open() {
      var done = false;
      return {
        close: func() { if (!done) { done = true; closes += 1; } },
        [symbol.dispose]: func() { if (!done) { done = true; closes += 1; } }
      };
    }
    func use() {
      var r = defer open();
      r.close();
    }
    use();
    assert.equal(closes, 1);
  });
});

finish("defer");
