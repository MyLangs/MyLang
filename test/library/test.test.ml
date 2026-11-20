import "core:test" as { describe, test, skip, beforeEach, afterEach, assert, finish, show, deepEq };
import "core:time";

// Tests of the test framework itself: the helpers every other file relies on.

describe("test: deep equality is strict", func() {
  test("numbers compare by value, int and float alike", func() {
    assert.isTrue(deepEq(1, 1));
    assert.isTrue(deepEq(2, 2.0));
    assert.isFalse(deepEq(1, 2));
  });

  test("different types are never equal (unlike the loose ==)", func() {
    assert.isFalse(1 == "1");
    assert.isFalse(deepEq(1, "1"));
    assert.isFalse(deepEq(0, false));
    assert.isFalse(deepEq(nil, 0));
    assert.isFalse(deepEq("", nil));
  });

  test("arrays and objects are compared recursively", func() {
    assert.isTrue(deepEq([1, [2, { a: 3 }]], [1, [2, { a: 3 }]]));
    assert.isFalse(deepEq([1, 2], [1, 2, 3]));
    assert.isFalse(deepEq([1, [2]], [1, [3]]));
    assert.isTrue(deepEq({ a: 1, b: [1] }, { b: [1], a: 1 }));
    assert.isFalse(deepEq({ a: 1 }, { a: 1, b: 2 }));
    assert.isFalse(deepEq({ a: 1 }, { b: 1 }));
  });

  test("nil, strings, booleans and NaN", func() {
    assert.isTrue(deepEq(nil, nil));
    assert.isTrue(deepEq("a", "a"));
    assert.isFalse(deepEq("a", "b"));
    assert.isTrue(deepEq(true, true));
    assert.isFalse(deepEq(true, false));
    assert.isTrue(deepEq(0 / 0, 0 / 0));
  });
});

describe("test: show formats values for messages", func() {
  test("scalars", func() {
    assert.equal(show(nil), "nil");
    assert.equal(show("x"), '"x"');
    assert.equal(show(5), "5");
    assert.equal(show(1.5), "1.5");
    assert.equal(show(true), "true");
    assert.equal(show(5n), "5n");
  });

  test("collections", func() {
    assert.equal(show([1, "a"]), '[1, "a"]');
    assert.equal(show({ a: 1 }), "{a: 1}");
    assert.equal(show([[1], { b: nil }]), "[[1], {b: nil}]");
  });

  test("long values are truncated", func() {
    var big = [];
    for (var i = 0; i < 30; i++) { big[length(big)] = i; }
    assert.includes(show(big), "… 18 more");

    var text = "";
    for (var j = 0; j < 300; j++) { text += "x"; }
    assert.includes(show(text), "300 chars");
  });
});

describe("test: assertions", func() {
  test("equality and its negation", func() {
    assert.equal([1, { a: 2 }], [1, { a: 2 }]);
    assert.notEqual(1, 2);
    assert.throws(func() { assert.equal(1, 2); }, "expected 2, received 1");
  });

  test("truthiness", func() {
    assert.ok(1);
    assert.notOk(0);
    assert.isTrue(true);
    assert.isFalse(false);
    assert.throws(func() { assert.isTrue(1); }, "expected true");
  });

  test("nil checks", func() {
    assert.isNil(nil);
    assert.notNil(0);
    assert.throws(func() { assert.isNil(0); }, "expected nil");
  });

  test("types", func() {
    assert.typeOf("a", "string");
    assert.typeOf(1, "int");
    assert.typeOf(1.5, "float");
    assert.typeOf([], "array");
    assert.throws(func() { assert.typeOf(1, "string"); }, "expected type");
  });

  test("ordering and tolerance", func() {
    assert.greater(2, 1);
    assert.greaterOrEqual(2, 2);
    assert.less(1, 2);
    assert.lessOrEqual(2, 2);
    assert.closeTo(0.1 + 0.2, 0.3);
    assert.throws(func() { assert.greater(1, 2); }, "not greater");
  });

  test("length and membership", func() {
    assert.lengthOf([1, 2], 2);
    assert.lengthOf("abc", 3);
    assert.lengthOf({ a: 1 }, 1);
    assert.includes([1, 2], 2);
    assert.includes("hello", "ell");
    assert.includes({ a: 1 }, "a");
    assert.notIncludes([1], 2);
  });

  test("throws returns the caught error", func() {
    var caught = assert.throws(func() { throw "boom"; });
    assert.equal(caught.message, "boom");
    assert.throws(func() { assert.doesNotThrow(func() { throw "x"; }); }, "expected no error");
  });

  test("a custom message is prefixed to the generated one", func() {
    assert.throws(
      func() { assert.ok(false, "user id missing"); },
      "user id missing — expected a truthy value"
    );
  });
});

describe("test: hooks run around every test", func() {
  var log = [];

  beforeEach(func() { log[length(log)] = "before"; });
  afterEach(func() { log[length(log)] = "after"; });

  test("first", func() {
    assert.includes(log, "before");
  });

  test("the previous test's after hook ran", func() {
    assert.equal(log, ["before", "after", "before"]);
  });
});

describe("test: tests may suspend", func() {
  test("a test body can wait on a spawned task", func() {
    var result = wait spawn time.Sleep(5);
    assert.equal(result.status, "fulfilled");
  });

  test("assert.throws works on a function that waits", func() {
    assert.throws(func() {
      wait spawn time.Sleep(1);
      throw "late failure";
    }, "late failure");
  });
});

describe("test: skipping", func() {
  skip("this one is not run", "demonstrates skip()");

  test("skip does not fail the suite", func() {
    assert.ok(true);
  });
});

finish("test");
