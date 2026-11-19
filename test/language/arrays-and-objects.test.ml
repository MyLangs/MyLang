import "core:test" as { describe, test, assert, finish };

describe("Array element access", func() {
  test("read by index", func() {
    var a = [10, 20, 30];
    assert.equal(a[0], 10);
    assert.equal(a[2], 30);
  });

  test("assign by index", func() {
    var a = [1, 2, 3];
    a[1] = 20;
    assert.equal(a, [1, 20, 3]);
  });

  test("append with length()", func() {
    var a = [1];
    a[length(a)] = 2;
    a[length(a)] = 3;
    assert.equal(a, [1, 2, 3]);
    assert.equal(length(a), 3);
  });

  test("nested arrays", func() {
    var grid = [[1, 2], [3, 4]];
    grid[1][0] = 30;
    assert.equal(grid, [[1, 2], [30, 4]]);
    assert.equal(grid[0][1], 2);
  });

  test("building a two-dimensional grid with loops", func() {
    var grid = [];
    for (var r = 0; r < 2; r++) {
      var row = [];
      for (var c = 0; c < 3; c++) { row[length(row)] = r * 3 + c; }
      grid[length(grid)] = row;
    }
    assert.equal(grid, [[0, 1, 2], [3, 4, 5]]);
  });

  test("an out-of-range read is an error", func() {
    assert.throws(func() { var v = [1, 2][5]; }, "does not exist");
  });

  test("a negative index is an error", func() {
    assert.throws(func() { var v = [1, 2, 3][-1]; }, "does not exist");
  });

  test("a call result can be indexed directly", func() {
    func pair() { return [10, 20]; }
    assert.equal(pair()[1], 20);
  });

  test("strings are indexable but immutable", func() {
    var s = "abc";
    assert.equal(s[1], "b");
    assert.throws(func() { s[0] = "z"; }, "Cannot assign");
    assert.equal(s, "abc");
  });
});

describe("Object member access", func() {
  test("read with dot and with brackets", func() {
    var o = { name: "Alice" };
    assert.equal(o.name, "Alice");
    assert.equal(o["name"], "Alice");
  });

  test("assign existing and new members", func() {
    var o = { a: 1 };
    o.a = 10;
    o.b = 2;
    o["c"] = 3;
    assert.equal(o, { a: 10, b: 2, c: 3 });
  });

  test("assign with a computed key", func() {
    var o = {};
    var k = "dynamic";
    o[k] = 5;
    assert.equal(o.dynamic, 5);
  });

  test("nested objects", func() {
    var o = { a: { b: 1 } };
    o.a.b = 2;
    o.a.c = 3;
    assert.equal(o, { a: { b: 2, c: 3 } });
  });

  test("a missing key is an error", func() {
    assert.throws(func() { var o = { a: 1 }; var v = o.missing; }, "does not exist");
  });

  test("setting a member to nil keeps the key", func() {
    var o = { a: 1 };
    o.a = nil;
    assert.isNil(o.a);
    assert.isTrue("a" in o);
    assert.equal(length(o), 1);
  });

  test("a call result can be read directly", func() {
    func make() { return { a: 5 }; }
    assert.equal(make().a, 5);
  });

  test("keys keep insertion order", func() {
    var o = { z: 1, a: 2, m: 3 };
    var keys = [];
    for (var k in o) { keys[length(keys)] = k; }
    assert.equal(keys, ["z", "a", "m"]);
  });
});

describe("References", func() {
  test("arrays are shared, not copied", func() {
    var a = [1];
    var b = a;
    b[0] = 9;
    assert.equal(a, [9]);
  });

  test("objects are shared, not copied", func() {
    var a = { n: 1 };
    var b = a;
    b.n = 9;
    assert.equal(a.n, 9);
  });

  test("the same nested collection can be reached twice", func() {
    var inner = [1];
    var o = { a: inner, b: inner };
    o.a[0] = 9;
    assert.equal(o.b, [9]);
  });

  test("elements of arrays of objects are modifiable", func() {
    var list = [{ n: 1 }, { n: 2 }];
    list[0].n = 10;
    assert.equal(list, [{ n: 10 }, { n: 2 }]);
  });

  test("arrays inside objects are modifiable", func() {
    var o = { items: [1] };
    o.items[length(o.items)] = 2;
    assert.equal(o, { items: [1, 2] });
  });

  test("closures stored in a collection keep their captured values", func() {
    var fns = [];
    for (var i = 0; i < 3; i++) {
      var k = i;
      fns[length(fns)] = func() { return k; };
    }
    assert.equal(fns[0](), 0);
    assert.equal(fns[1](), 1);
    assert.equal(fns[2](), 2);
  });
});

describe("Optional chaining", func() {
  test("returns the value when every link exists", func() {
    var o = { a: { b: { c: 5 } } };
    assert.equal(o?.a?.b?.c, 5);
  });

  test("returns nil when a link is nil", func() {
    var o = { a: nil };
    assert.isNil(o?.a?.b?.c);
  });

  test("returns nil on a nil variable", func() {
    var o = nil;
    assert.isNil(o?.a);
    assert.isNil(o?.a?.b);
  });

  test("returns nil for a missing key instead of failing", func() {
    var o = { a: 1 };
    assert.isNil(o?.missing);
    assert.isNil(o?.missing?.deeper);
  });

  test("works with index access", func() {
    var list = [1, 2];
    assert.equal(list?[1], 2);
    var none = nil;
    assert.isNil(none?[1]);
  });

  test("can call methods", func() {
    var o = { f: func() { return 7; } };
    assert.equal(o?.f(), 7);
  });

  test("README example: profile lookups", func() {
    var userProfile = { settings: { theme: "dark" } };
    assert.isNil(userProfile?.avatar?.url);
    assert.equal(userProfile?.settings?.theme, "dark");
  });

  test("plain access on nil still fails", func() {
    var o = nil;
    assert.throws(func() { var v = o.a; }, "nil");
  });
});

describe("Equality of collections", func() {
  test("nested arrays", func() {
    assert.isTrue([[1, 2], [3]] == [[1, 2], [3]]);
    assert.isFalse([[1, 2], [3]] == [[1, 2], [4]]);
  });

  test("empty collections", func() {
    assert.isTrue([] == []);
    assert.isTrue({} == {});
  });

  test("objects with different key sets", func() {
    assert.isFalse({ a: 1 } == { a: 1, b: 2 });
  });
});

finish("arrays-and-objects");
