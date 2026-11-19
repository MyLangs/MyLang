import "core:test" as { describe, test, assert, finish };

describe("JavaScript members are invisible", func() {
  test("string prototype methods do not exist", func() {
    assert.throws(func() { var f = "x".toUpperCase; }, "does not exist");
    assert.throws(func() { "x".toUpperCase(); }, "unknown function");
  });

  test("array prototype methods do not exist", func() {
    assert.throws(func() { var f = [].push; }, "does not exist");
    assert.throws(func() { [1, 2].map(func(x) { return x; }); }, "unknown function");
  });

  test("object prototype methods do not exist", func() {
    assert.throws(func() { var f = {}.toString; }, "does not exist");
    assert.throws(func() { var f = {}.hasOwnProperty; }, "does not exist");
  });

  test("function members other than name are hidden", func() {
    func named() {}
    assert.equal(named.name, "named");
    assert.throws(func() { var c = named.call; }, "does not exist");
    assert.throws(func() { var b = named.bind; }, "does not exist");
  });

  test("own properties still work", func() {
    assert.equal({ a: 1 }.a, 1);
    assert.equal("abc".length, 3);
    assert.equal([1, 2].length, 2);
  });

  test("optional chaining does not reveal prototypes", func() {
    assert.isNil("x"?.toUpperCase);
  });
});

describe("Forbidden properties", func() {
  test("constructor is not accessible", func() {
    assert.throws(func() { var c = {}.constructor; }, "not allowed");
    assert.throws(func() { var c = {}["constructor"]; }, "not allowed");
    assert.throws(func() { var c = [].constructor; }, "not allowed");
  });

  test("__proto__ is not readable", func() {
    assert.throws(func() { var p = {}.__proto__; }, "not allowed");
  });

  test("__proto__ is not writable", func() {
    assert.throws(func() {
      var o = {};
      o.__proto__ = { injected: true };
    }, "not allowed");
  });

  test("prototype pollution has no effect", func() {
    var victim = {};
    try { victim.__proto__ = { polluted: 1 }; } catch (e) {}
    var other = {};
    assert.isFalse("polluted" in other);
    assert.throws(func() { var v = other.polluted; }, "does not exist");
  });

  test("error objects hide the constructor too", func() {
    try { throw "x"; } catch (e) {
      assert.throws(func() { var c = e.constructor; }, "not allowed");
    }
  });
});

describe("Private (__) properties", func() {
  test("cannot be read with a dot", func() {
    var o = { __secret: 1, pub: 2 };
    assert.throws(func() { var s = o.__secret; }, "not allowed");
    assert.equal(o.pub, 2);
  });

  test("cannot be read with brackets", func() {
    var o = { __secret: 1 };
    assert.throws(func() { var s = o["__secret"]; }, "not allowed");
  });
});

describe("Host objects", func() {
  test("process hides the JavaScript process internals", func() {
    assert.typeOf(process, "object");
    assert.throws(func() { var e = process.env; }, "does not exist");
    assert.throws(func() { var e = process.exit; }, "does not exist");
    assert.throws(func() { var e = process.mainModule; }, "does not exist");
    assert.throws(func() { var e = process.binding; }, "does not exist");
  });
});

finish("security");
