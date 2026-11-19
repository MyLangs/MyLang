import "core:test" as { describe, test, assert, finish };

struct ValidationError {
  var code = 409;
  var cause = { "name": "unknown error" };
  var name = "ValidationError";
}

describe("throw and catch", func() {
  test("a thrown string becomes an error with that message", func() {
    var caught = nil;
    try { throw "boom"; } catch (e) { caught = e; }
    assert.typeOf(caught, "error");
    assert.equal(caught.message, "boom");
    assert.equal(caught.name, "BaseError");
  });

  test("the catch binding is optional", func() {
    var r = "none";
    try { throw "x"; } catch { r = "caught"; }
    assert.equal(r, "caught");
  });

  test("code after a throw does not run", func() {
    var reached = false;
    try {
      throw "stop";
      reached = true;
    } catch (e) {}
    assert.isFalse(reached);
  });

  test("a try block without an error skips catch", func() {
    var log = [];
    try { log[length(log)] = "try"; } catch (e) { log[length(log)] = "catch"; }
    assert.equal(log, ["try"]);
  });

  test("non-string values are converted to a message", func() {
    var num = nil;
    try { throw 42; } catch (e) { num = e; }
    assert.typeOf(num, "error");
    assert.equal(num.message, "42");
  });

  test("errors thrown in functions propagate to the caller", func() {
    func inner() { throw "from inner"; }
    func outer() { inner(); }
    var msg = "";
    try { outer(); } catch (e) { msg = e.message; }
    assert.equal(msg, "from inner");
  });

  test("an error can be rethrown", func() {
    var msg = "";
    try {
      try { throw "inner"; } catch (e) { throw "outer:" + e.message; }
    } catch (e2) { msg = e2.message; }
    assert.equal(msg, "outer:inner");
  });

  test("an uncaught error inside catch is not swallowed", func() {
    assert.throws(func() {
      try { throw "first"; } catch (e) { throw "second"; }
    }, "second");
  });

  test("the error has a stack trace string", func() {
    var stack = nil;
    try { throw "s"; } catch (e) { stack = e.stack; }
    assert.typeOf(stack, "string");
  });
});

describe("Runtime errors are catchable", func() {
  test("reading a property of nil", func() {
    var msg = "";
    try { var n = nil; var v = n.field; } catch (e) { msg = e.message; }
    assert.includes(msg, "nil");
  });

  test("calling an undefined function", func() {
    var msg = "";
    try { doesNotExistAnywhere(); } catch (e) { msg = e.message; }
    assert.equal(msg, "doesNotExistAnywhere is not defined");
  });

  test("reading an unknown variable", func() {
    var msg = "";
    try { var v = unknownThing; } catch (e) { msg = e.message; }
    assert.includes(msg, "unknownThing");
  });

  test("a missing object key", func() {
    var msg = "";
    try { var o = { a: 1 }; var v = o.missing; } catch (e) { msg = e.message; }
    assert.includes(msg, "missing");
  });
});

describe("throw ... as", func() {
  test("with an object sets name, code and cause", func() {
    var err = nil;
    try {
      throw "Age cannot be negative" as { name: "ValidatedError", code: 409, cause: { age: -1 } };
    } catch (e) { err = e; }
    assert.equal(err.message, "Age cannot be negative");
    assert.equal(err.name, "ValidatedError");
    assert.equal(err.code, 409);
    assert.equal(err.cause, { age: -1 });
  });

  test("with a struct constructor call", func() {
    var err = nil;
    try {
      throw "Name must be a string" as ValidationError(400, { name: 5 });
    } catch (e) { err = e; }
    assert.equal(err.message, "Name must be a string");
    assert.equal(err.name, "ValidationError");
    assert.equal(err.code, 400);
    assert.equal(err.cause, { name: 5 });
  });

  test("with a bare struct uses its default fields", func() {
    var err = nil;
    try { throw "Name cannot be empty" as ValidationError; } catch (e) { err = e; }
    assert.equal(err.name, "ValidationError");
    assert.equal(err.code, 409);
  });

  test("validation function from the documentation", func() {
    func validateAge(age) {
      if (age < 0) {
        throw "Age cannot be negative" as { name: "ValidatedError", code: 409, cause: { age } };
      }
      return true;
    }
    assert.isTrue(validateAge(5));
    var err = assert.throws(func() { validateAge(-3); }, "negative");
    assert.equal(err.name, "ValidatedError");
    assert.equal(err.cause, { age: -3 });
  });
});

describe("finally", func() {
  test("runs after a successful try", func() {
    var log = [];
    try { log[length(log)] = "try"; } finally { log[length(log)] = "finally"; }
    assert.equal(log, ["try", "finally"]);
  });

  test("runs after catch", func() {
    var log = [];
    try { throw "x"; } catch (e) { log[length(log)] = "catch"; } finally { log[length(log)] = "finally"; }
    assert.equal(log, ["catch", "finally"]);
  });

  test("try / finally without catch does not swallow the error", func() {
    var log = [];
    func f() {
      try { throw "kept"; } finally { log[length(log)] = "cleanup"; }
      log[length(log)] = "unreachable";
    }
    assert.throws(func() { f(); }, "kept");
    assert.equal(log, ["cleanup"]);
  });

  test("runs when the try block returns", func() {
    var log = [];
    func f() {
      try { return "result"; } finally { log[length(log)] = "finally"; }
    }
    assert.equal(f(), "result");
    assert.equal(log, ["finally"]);
  });

  test("runs when the catch block returns", func() {
    var log = [];
    func f() {
      try { throw "x"; } catch (e) { return "from catch"; } finally { log[length(log)] = "finally"; }
    }
    assert.equal(f(), "from catch");
    assert.equal(log, ["finally"]);
  });

  test("runs on break and continue inside loops", func() {
    var log = [];
    for (var i = 0; i < 3; i++) {
      try {
        if (i == 1) { break; }
        log[length(log)] = "body" + i;
      } finally {
        log[length(log)] = "fin" + i;
      }
    }
    assert.equal(log, ["body0", "fin0", "fin1"]);
  });

  test("a return in finally overrides the try result", func() {
    func f() {
      try { return "try"; } finally { return "finally"; }
    }
    assert.equal(f(), "finally");
  });

  test("an error in finally replaces the original error", func() {
    var msg = "";
    try {
      try { throw "a"; } finally { throw "b"; }
    } catch (e) { msg = e.message; }
    assert.equal(msg, "b");
  });

  test("runs once per iteration in a loop", func() {
    var count = 0;
    for (var i = 0; i < 3; i++) {
      try { count += 10; } finally { count += 1; }
    }
    assert.equal(count, 33);
  });
});

describe("try expressions", func() {
  test("yield the value when nothing fails", func() {
    var v = try 10 else { return 0; };
    assert.equal(v, 10);
  });

  test("try ... catch recovers with a handler", func() {
    var v = try undefinedFunction() catch (e) { return "recovered"; };
    assert.equal(v, "recovered");
  });

  test("the catch handler receives the error", func() {
    var v = try undefinedFunction() catch (e) { return e.message; };
    assert.equal(v, "undefinedFunction is not defined");
  });

  test("try ... else exposes this.error", func() {
    var v = try undefinedFunction() else { return this.error.message; };
    assert.equal(v, "undefinedFunction is not defined");
  });

  test("try ... else supplies a fallback value", func() {
    var nothing = nil;
    var v = try nothing.missing else { return "fallback"; };
    assert.equal(v, "fallback");
  });

  test("works around a throwing function call", func() {
    func risky() { throw "nope"; }
    var v = try risky() else { return -1; };
    assert.equal(v, -1);
  });
});

finish("errors");
