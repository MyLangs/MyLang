import "core:test" as { describe, test, assert, finish };
import "objects";

describe("objects: inspection", func() {
  test("keys, values and entries", func() {
    var o = { a: 1, b: 2 };
    assert.equal(objects.keys(o), ["a", "b"]);
    assert.equal(objects.values(o), [1, 2]);
    assert.equal(objects.entries(o), [["a", 1], ["b", 2]]);
  });

  test("empty objects", func() {
    assert.equal(objects.keys({}), []);
    assert.equal(objects.values({}), []);
    assert.equal(objects.entries({}), []);
  });

  test("values may be nested objects", func() {
    assert.equal(objects.values({ a: { b: 1 } }), [{ b: 1 }]);
  });

  test("fromEntries is the inverse of entries", func() {
    var o = { a: 1, b: 2 };
    assert.equal(objects.fromEntries(objects.entries(o)), o);
    assert.equal(objects.fromEntries([["x", 1], ["y", 2]]), { x: 1, y: 2 });
  });

  test("hasOwnProperty", func() {
    assert.isTrue(objects.hasOwnProperty({ a: 1 }, "a"));
    assert.isFalse(objects.hasOwnProperty({ a: 1 }, "b"));
    assert.isFalse(objects.hasOwnProperty({ a: 1 }, "toString"));
  });

  test("propertyIsEnumerable", func() {
    assert.isTrue(objects.propertyIsEnumerable({ a: 1 }, "a"));
  });

  test("is compares like Object.is", func() {
    assert.isTrue(objects.is(1, 1));
    assert.isTrue(objects.is("a", "a"));
    assert.isFalse(objects.is(1, 2));
    assert.isTrue(objects.is(nil, nil));
    assert.isTrue(objects.is(0 / 0, 0 / 0));
    assert.isFalse(objects.is({}, {}));
  });

  test("keys requires an object", func() {
    assert.throws(func() { objects.keys(5); }, "must be of type object");
    assert.throws(func() { objects.keys("x"); }, "must be of type object");
  });
});

describe("objects: copying and combining", func() {
  test("assign copies properties into the target and returns it", func() {
    var target = { a: 1 };
    var result = objects.assign(target, { b: 2 }, { c: 3 });
    assert.equal(result, { a: 1, b: 2, c: 3 });
    assert.equal(target, { a: 1, b: 2, c: 3 });
  });

  test("assign with a fresh target leaves the sources alone", func() {
    var src = { a: 1 };
    var merged = objects.assign({}, src, { b: 2 });
    assert.equal(merged, { a: 1, b: 2 });
    assert.equal(src, { a: 1 });
  });

  test("later sources overwrite earlier ones", func() {
    assert.equal(objects.assign({ a: 1 }, { a: 2 }), { a: 2 });
  });

  test("shallowClone copies the first level only", func() {
    var o = { a: [1] };
    var c = objects.shallowClone(o);
    c.x = 1;
    assert.isFalse("x" in o);
    c.a[0] = 9;
    assert.equal(o.a, [9]);
  });

  test("deepClone copies nested values", func() {
    var o = { a: [1], b: { c: 2 } };
    var c = objects.deepClone(o);
    c.a[0] = 9;
    c.b.c = 8;
    assert.equal(o, { a: [1], b: { c: 2 } });
    assert.equal(c, { a: [9], b: { c: 8 } });
  });

  test("merge combines nested objects recursively", func() {
    var result = objects.merge({ a: { x: 1 }, k: 1 }, { a: { y: 2 }, k: 2 }, { z: 3 });
    assert.equal(result, { a: { x: 1, y: 2 }, k: 2, z: 3 });
  });

  test("merge replaces arrays instead of merging them", func() {
    assert.equal(objects.merge({ a: [1, 2] }, { a: [3] }), { a: [3] });
  });

  test("merge changes the target", func() {
    var target = { a: 1 };
    objects.merge(target, { b: 2 });
    assert.equal(target, { a: 1, b: 2 });
  });

  test("defaults fills in missing keys only", func() {
    assert.equal(objects.defaults({ a: 1 }, { a: 9, b: 2 }, { c: 3 }), { a: 1, b: 2, c: 3 });
  });
});

describe("objects: selecting", func() {
  test("pick keeps only the named keys", func() {
    assert.equal(objects.pick({ a: 1, b: 2, c: 3 }, "a", "c"), { a: 1, c: 3 });
  });

  test("pick ignores unknown keys", func() {
    assert.equal(objects.pick({ a: 1 }, "a", "nope"), { a: 1 });
  });

  test("omit removes the named keys", func() {
    assert.equal(objects.omit({ a: 1, b: 2, c: 3 }, "b"), { a: 1, c: 3 });
    assert.equal(objects.omit({ a: 1, b: 2, c: 3 }, "a", "c"), { b: 2 });
  });

  test("compact drops nil values only", func() {
    assert.equal(
      objects.compact({ a: 1, b: nil, c: 0, d: "", e: false }),
      { a: 1, c: 0, d: "", e: false }
    );
  });

  test("invert swaps keys and values", func() {
    assert.equal(objects.invert({ a: "x", b: "y" }), { x: "a", y: "b" });
  });
});

describe("objects: callbacks", func() {
  test("mapValues transforms values and passes the key", func() {
    assert.equal(
      objects.mapValues({ a: 1, b: 2 }, func(v, k) { return v * 10; }),
      { a: 10, b: 20 }
    );
    assert.equal(
      objects.mapValues({ a: 1, b: 2 }, func(v, k) { return k + v; }),
      { a: "a1", b: "b2" }
    );
  });

  test("mapKeys renames keys", func() {
    assert.equal(
      objects.mapKeys({ a: 1, b: 2 }, func(k, v) { return k + "_x"; }),
      { a_x: 1, b_x: 2 }
    );
  });

  test("filter keeps entries whose callback is truthy", func() {
    assert.equal(
      objects.filter({ a: 1, b: 2, c: 3 }, func(v, k) { return v > 1; }),
      { b: 2, c: 3 }
    );
    assert.equal(objects.filter({ a: 1, b: 2 }, func(v, k) { return k == "a"; }), { a: 1 });
  });

  test("reduce folds the values", func() {
    assert.equal(objects.reduce({ a: 1, b: 2, c: 3 }, func(acc, v) { return acc + v; }, 0), 6);
    assert.equal(objects.reduce({ a: 1, b: 2 }, func(acc, v) { return acc + v; }), 3);
  });

  test("reduce on an empty object needs an initial value", func() {
    assert.throws(func() { objects.reduce({}, func(acc, v) { return acc + v; }); }, "empty object");
    assert.equal(objects.reduce({}, func(acc, v) { return acc + v; }, 5), 5);
  });

  test("every and some", func() {
    assert.isTrue(objects.every({ a: 1, b: 2 }, func(v) { return v > 0; }));
    assert.isFalse(objects.every({ a: 1, b: 2 }, func(v) { return v > 1; }));
    assert.isTrue(objects.every({}, func(v) { return false; }));
    assert.isTrue(objects.some({ a: 1, b: 2 }, func(v) { return v > 1; }));
    assert.isFalse(objects.some({ a: 1 }, func(v) { return v > 5; }));
    assert.isFalse(objects.some({}, func(v) { return true; }));
  });

  test("find returns the matching [key, value] pair or nil", func() {
    assert.equal(objects.find({ a: 1, b: 2 }, func(v) { return v > 1; }), ["b", 2]);
    assert.isNil(objects.find({ a: 1 }, func(v) { return v > 5; }));
  });

  test("findKey returns the matching key or nil", func() {
    assert.equal(objects.findKey({ a: 1, b: 2 }, func(v) { return v > 1; }), "b");
    assert.isNil(objects.findKey({ a: 1 }, func(v) { return v > 5; }));
  });

  test("transform builds entries from {key, value} results", func() {
    var r = objects.transform(
      { a: 1, b: 2 },
      func(v, k) { return { key: k + "!", value: v * 2 }; }
    );
    assert.equal(r, { "a!": 2, "b!": 4 });
  });

  test("groupBy groups entries by the callback result", func() {
    var r = objects.groupBy(
      { a: 1, b: 2, c: 3, d: 4 },
      func(v) { return v % 2 == 0 ? "even" : "odd"; }
    );
    assert.equal(r, { odd: { a: 1, c: 3 }, even: { b: 2, d: 4 } });
  });

  test("callbacks must be functions", func() {
    assert.throws(func() { objects.mapValues({ a: 1 }, 5); }, "must be of type func");
  });
});

describe("objects: property definitions", func() {
  test("defineProperty with enumerable true", func() {
    var o = {};
    objects.defineProperty(o, "x", { value: 5, enumerable: true });
    assert.equal(o.x, 5);
    assert.equal(objects.keys(o), ["x"]);
  });

  test("a non-enumerable property is readable but not listed", func() {
    var o = {};
    objects.defineProperty(o, "hidden", { value: 5, enumerable: false });
    assert.equal(o.hidden, 5);
    assert.equal(objects.keys(o), []);
  });

  test("a non-writable property rejects assignment", func() {
    var o = {};
    objects.defineProperty(o, "x", { value: 5, writable: false, enumerable: true });
    assert.throws(func() { o.x = 9; }, "read only");
    assert.equal(o.x, 5);
  });

  test("defineProperties defines several at once", func() {
    var o = {};
    objects.defineProperties(
      o,
      { a: { value: 1, enumerable: true }, b: { value: 2, enumerable: true } }
    );
    assert.equal(o, { a: 1, b: 2 });
  });

  test("getOwnPropertyDescriptor", func() {
    var d = objects.getOwnPropertyDescriptor({ a: 1 }, "a");
    assert.equal(d.value, 1);
    assert.isTrue(d.writable);
    assert.isTrue(d.enumerable);
    assert.isTrue(d.configurable);
  });

  test("getOwnPropertyDescriptors", func() {
    var d = objects.getOwnPropertyDescriptors({ a: 1 });
    assert.equal(d.a.value, 1);
  });

  test("create returns an object", func() {
    assert.typeOf(objects.create(nil), "object");
  });
});

finish("objects");
