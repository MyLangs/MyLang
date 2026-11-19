import "core:test" as { describe, test, assert, finish };
import "coreio";

// NOTE: coreio writes to the process' stdout/stderr, which pure MyLang code can
// not capture. These tests therefore check what *is* observable: return values,
// the pure colorize() helper, argument validation and that every kind of value
// can be printed without raising an error. (Output lines produced here are
// expected and harmless.)

describe("coreio: colorize", func() {
  test("wraps text in the ANSI colour code and a reset", func() {
    assert.equal(coreio.colorize("hi", "red"), "\u001b[31mhi\u001b[0m");
    assert.equal(coreio.colorize("hi", "green"), "\u001b[32mhi\u001b[0m");
    assert.equal(coreio.colorize("hi", "blue"), "\u001b[34mhi\u001b[0m");
  });

  test("every named colour", func() {
    var codes = {
      black: "30", red: "31", green: "32", yellow: "33", blue: "34",
      magenta: "35", cyan: "36", white: "37", gray: "90",
      brightRed: "91", brightGreen: "92", brightYellow: "93",
      brightBlue: "94", brightMagenta: "95", brightCyan: "96", brightWhite: "97"
    };
    for (var name in codes) {
      assert.equal(coreio.colorize("t", name), "\u001b[" + codes[name] + "mt\u001b[0m", name);
    }
  });

  test("reset", func() {
    assert.equal(coreio.colorize("x", "reset"), "\u001b[0mx\u001b[0m");
  });

  test("unknown or missing colour only appends the reset code", func() {
    assert.equal(coreio.colorize("hi", "nocolor"), "hi\u001b[0m");
    assert.equal(coreio.colorize("hi"), "hi\u001b[0m");
  });

  test("names inherited from JavaScript objects are not colours", func() {
    assert.equal(coreio.colorize("hi", "toString"), "hi\u001b[0m");
    assert.equal(coreio.colorize("hi", "constructor"), "hi\u001b[0m");
  });

  test("empty text", func() {
    assert.equal(coreio.colorize("", "red"), "\u001b[31m\u001b[0m");
  });

  test("arguments must be strings", func() {
    assert.throws(func() { coreio.colorize(5, "red"); }, "must be of type string");
    assert.throws(func() { coreio.colorize("x", 5); }, "must be of type string");
  });
});

describe("coreio: printing", func() {
  test("print, println and the level helpers return nil", func() {
    assert.isNil(coreio.print("x"));
    assert.isNil(coreio.println("x\n"));
    assert.isNil(coreio.printError("error line (expected in test output)"));
    assert.isNil(coreio.printWarning("warning line (expected in test output)"));
    assert.isNil(coreio.printInfo("info line (expected in test output)"));
    assert.isNil(coreio.printSuccess("success line (expected in test output)"));
    assert.isNil(coreio.printDebug("debug line (expected in test output)"));
  });

  test("print accepts no arguments, empty strings and many arguments", func() {
    assert.doesNotThrow(func() { coreio.print(); });
    assert.doesNotThrow(func() { coreio.print(""); });
    assert.doesNotThrow(func() { coreio.print("a", "b", "c", 1, 2, 3); });
  });

  test("print handles every kind of value", func() {
    struct Sample { var a; }
    enum Level { Low }
    func named() {}
    assert.doesNotThrow(func() {
      coreio.print(1, 1.5, "s", true, nil, [1, [2]], { a: { b: 1 } });
      coreio.print(Sample, Sample(1), Level, Level.Low, named, func() {});
      coreio.print(5n, 1 / 0, 0 / 0, symbol.iterator);
    });
  });

  test("print handles objects with private members", func() {
    assert.doesNotThrow(func() { coreio.print({ __hidden: 1, shown: 2 }); });
  });

  test("print handles errors and task handles", func() {
    var err = nil;
    try { throw "boom"; } catch (e) { err = e; }
    var task = spawn { return 1; };
    wait task;
    assert.doesNotThrow(func() {
      coreio.print(err, { err: err }, [err]);
      coreio.print(task);
    });
  });

  test("print handles deeply nested data", func() {
    var deep = { l1: { l2: { l3: { l4: { l5: [1, 2, 3] } } } } };
    assert.doesNotThrow(func() { coreio.print(deep); });
  });
});

describe("coreio: structured output", func() {
  test("table", func() {
    assert.isNil(coreio.table([{ a: 1, b: 2 }, { a: 3, b: 4 }]));
    assert.isNil(coreio.table([{ a: 1, b: 2 }], ["a"]));
  });

  test("table validates its column list", func() {
    assert.throws(func() { coreio.table([{ a: 1 }], "a"); }, "must be of type array");
  });

  test("printJSON", func() {
    assert.isNil(coreio.printJSON({ a: 1 }));
    assert.isNil(coreio.printJSON({ a: [1, 2] }, 4));
  });

  test("printJSON validates the indentation", func() {
    assert.throws(func() { coreio.printJSON({ a: 1 }, "x"); }, "must be of type number");
  });

  test("dir and dirxml", func() {
    assert.isNil(coreio.dir({ a: { b: { c: 1 } } }));
    assert.isNil(coreio.dirxml({ a: 1 }));
  });
});

describe("coreio: grouping, timers and counters", func() {
  test("group and groupEnd", func() {
    assert.doesNotThrow(func() {
      coreio.group("Group");
      coreio.print("inside the group");
      coreio.groupEnd();
    });
  });

  test("groupCollapsed", func() {
    assert.doesNotThrow(func() {
      coreio.groupCollapsed("Collapsed");
      coreio.groupEnd();
    });
  });

  test("group needs a string label", func() {
    assert.throws(func() { coreio.group(5); }, "must be of type string");
  });

  test("time, timeLog and timeEnd", func() {
    assert.doesNotThrow(func() {
      coreio.time("timer");
      coreio.timeLog("timer", "midway");
      coreio.timeEnd("timer");
    });
  });

  test("time needs a string label", func() {
    assert.throws(func() { coreio.time(5); }, "must be of type string");
  });

  test("count and countReset", func() {
    assert.doesNotThrow(func() {
      coreio.count("counter");
      coreio.count("counter");
      coreio.countReset("counter");
      coreio.count();
      coreio.countReset();
    });
  });

  test("assert never throws, it only reports", func() {
    assert.isNil(coreio.assert(true));
    assert.isNil(coreio.assert(false, "assertion report (expected in test output)"));
  });
});

finish("coreio");
