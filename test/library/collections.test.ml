import "core:test" as { describe, test, assert, finish };
import "collections";

describe("collections: Set", func() {
  test("removes duplicates", func() {
    var s = collections.Set([1, 2, 3, 2, 1]);
    assert.equal(s.size(), 3);
    assert.equal(s.values(), [1, 2, 3]);
  });

  test("can be created empty or from a string", func() {
    assert.equal(collections.Set().size(), 0);
    assert.equal(collections.Set("aab").values(), ["a", "b"]);
  });

  test("has", func() {
    var s = collections.Set([1, 2]);
    assert.isTrue(s.has(2));
    assert.isFalse(s.has(9));
  });

  test("add is chainable and keeps the same set", func() {
    var s = collections.Set();
    s.add(1).add(2).add(2);
    assert.equal(s.size(), 2);
    assert.equal(s.values(), [1, 2]);
  });

  test("objects are compared by identity", func() {
    var o = { a: 1 };
    var s = collections.Set([o, o]);
    assert.equal(s.size(), 1);
    assert.isTrue(s.has(o));
  });

  test("delete reports whether something was removed", func() {
    var s = collections.Set([1, 2]);
    assert.isTrue(s.delete(1));
    assert.isFalse(s.delete(9));
    assert.equal(s.size(), 1);
  });

  test("clear empties the set", func() {
    var s = collections.Set([1, 2]);
    assert.isNil(s.clear());
    assert.equal(s.size(), 0);
  });

  test("union, intersection, difference and symmetricDifference", func() {
    var a = collections.Set([1, 2, 3]);
    var b = collections.Set([2, 3, 4]);
    assert.equal(a.union(b).values(), [1, 2, 3, 4]);
    assert.equal(a.intersection(b).values(), [2, 3]);
    assert.equal(a.difference(b).values(), [1]);
    assert.equal(a.symmetricDifference(b).values(), [1, 4]);
  });

  test("set operations do not modify their operands", func() {
    var a = collections.Set([1, 2, 3]);
    var b = collections.Set([2, 3, 4]);
    a.union(b);
    a.intersection(b);
    a.difference(b);
    assert.equal(a.values(), [1, 2, 3]);
    assert.equal(b.values(), [2, 3, 4]);
  });

  test("set operations return sets that can be chained", func() {
    var a = collections.Set([1, 2, 3]);
    var b = collections.Set([3, 4]);
    var c = collections.Set([4, 5]);
    assert.equal(a.union(b).union(c).values(), [1, 2, 3, 4, 5]);
    assert.equal(a.union(b).difference(collections.Set([3])).values(), [1, 2, 4]);
  });

  test("isSubset, isSuperset and isDisjoint", func() {
    var small = collections.Set([1]);
    var big = collections.Set([1, 2]);
    assert.isTrue(small.isSubset(big));
    assert.isFalse(big.isSubset(small));
    assert.isTrue(big.isSuperset(small));
    assert.isTrue(small.isDisjoint(collections.Set([5])));
    assert.isFalse(small.isDisjoint(big));
  });

  test("copy is independent", func() {
    var a = collections.Set([1]);
    var c = a.copy();
    c.add(2);
    assert.equal(a.size(), 1);
    assert.equal(c.size(), 2);
  });

  test("forEach visits every value", func() {
    var seen = [];
    collections.Set([1, 2]).forEach(func(v) { seen[length(seen)] = v; });
    assert.equal(seen, [1, 2]);
  });

  test("for-in iterates the values", func() {
    var seen = [];
    for (var v in collections.Set([5, 6, 5])) { seen[length(seen)] = v; }
    assert.equal(seen, [5, 6]);
  });

  test("validation", func() {
    assert.throws(func() { collections.Set(5); }, "must be of type iterable");
    assert.throws(func() { collections.Set([1]).union([2]); }, "must be of type set");
    assert.throws(func() { collections.Set([1]).forEach(5); }, "must be of type function");
  });
});

describe("collections: Map", func() {
  test("built from key/value pairs", func() {
    var m = collections.Map([["a", 1], ["b", 2]]);
    assert.equal(m.size(), 2);
    assert.equal(m.get("a"), 1);
    assert.isNil(m.get("zz"));
    assert.isTrue(m.has("b"));
    assert.equal(m.keys(), ["a", "b"]);
    assert.equal(m.values(), [1, 2]);
    assert.equal(m.entries(), [["a", 1], ["b", 2]]);
  });

  test("set is chainable and keeps the same map", func() {
    var m = collections.Map();
    m.set("x", 1).set("y", 2).set("z", 3);
    assert.equal(m.size(), 3);
    assert.equal(m.get("z"), 3);
  });

  test("set overwrites an existing key", func() {
    var m = collections.Map([["a", 1]]);
    m.set("a", 2);
    assert.equal(m.get("a"), 2);
    assert.equal(m.size(), 1);
  });

  test("keys can be of any type", func() {
    var m = collections.Map();
    m.set(1, "one");
    m.set(true, "yes");
    assert.equal(m.get(1), "one");
    assert.equal(m.get(true), "yes");
  });

  test("delete and clear", func() {
    var m = collections.Map([["a", 1]]);
    assert.isTrue(m.delete("a"));
    assert.isFalse(m.delete("a"));
    m.set(1, 2);
    assert.isNil(m.clear());
    assert.equal(m.size(), 0);
  });

  test("copy is independent", func() {
    var m = collections.Map([["a", 1]]);
    var c = m.copy();
    c.set("b", 2);
    assert.equal(m.size(), 1);
    assert.equal(c.size(), 2);
  });

  test("merge combines two maps, the argument wins", func() {
    var a = collections.Map([["a", 1], ["b", 2]]);
    var b = collections.Map([["b", 20], ["c", 3]]);
    var merged = a.merge(b);
    assert.equal(merged.entries(), [["a", 1], ["b", 20], ["c", 3]]);
    assert.equal(a.size(), 2);
  });

  test("forEach receives value and key", func() {
    var seen = [];
    collections.Map([["a", 1], ["b", 2]]).forEach(func(v, k) { seen[length(seen)] = k + v; });
    assert.equal(seen, ["a1", "b2"]);
  });

  test("for-in iterates [key, value] pairs", func() {
    var seen = [];
    for (var entry in collections.Map([["a", 1], ["b", 2]])) { seen[length(seen)] = entry; }
    assert.equal(seen, [["a", 1], ["b", 2]]);
  });

  test("validation", func() {
    assert.throws(func() { collections.Map(5); }, "must be of type iterable");
    assert.throws(func() { collections.Map().merge({}); }, "must be of type map");
  });
});

describe("collections: Counter", func() {
  test("counts the characters of a string", func() {
    var c = collections.Counter("abracadabra");
    assert.equal(c.get("a"), 5);
    assert.equal(c.get("b"), 2);
    assert.equal(c.get("r"), 2);
    assert.equal(c.get("c"), 1);
    assert.equal(c.total(), 11);
  });

  test("a missing key counts as zero", func() {
    assert.equal(collections.Counter("abc").get("z"), 0);
  });

  test("counts the items of a list", func() {
    var c = collections.Counter(["x", "y", "x"]);
    assert.equal(c.get("x"), 2);
    assert.equal(c.get("y"), 1);
  });

  test("mostCommon sorts by count", func() {
    var c = collections.Counter("abracadabra");
    assert.equal(c.mostCommon(1), [["a", 5]]);
    var top = c.mostCommon(2);
    assert.equal(top[0], ["a", 5]);
    assert.equal(top[1][1], 2);
    assert.lengthOf(c.mostCommon(), 5);
  });

  test("keys and values", func() {
    var c = collections.Counter(["a", "b", "a"]);
    assert.equal(c.keys(), ["a", "b"]);
    assert.equal(c.values(), [2, 1]);
  });

  test("update adds counts", func() {
    var c = collections.Counter(["a"]);
    c.update(["a", "b"]);
    assert.equal(c.get("a"), 2);
    assert.equal(c.get("b"), 1);
  });

  test("subtract lowers counts and drops zeros", func() {
    var c = collections.Counter(["a", "a", "b"]);
    c.subtract(["a", "b", "b"]);
    assert.equal(c.get("a"), 1);
    assert.equal(c.get("b"), 0);
    assert.equal(c.keys(), ["a"]);
  });

  test("elements repeats each item by its count", func() {
    assert.equal(collections.Counter(["a", "b", "a"]).elements(), ["a", "a", "b"]);
  });

  test("set assigns a count and is chainable", func() {
    var c = collections.Counter();
    c.set("k", 5).set("j", 2);
    assert.equal(c.get("k"), 5);
    assert.equal(c.get("j"), 2);
    assert.equal(c.total(), 7);
  });

  test("an empty counter", func() {
    var c = collections.Counter();
    assert.equal(c.total(), 0);
    assert.equal(c.mostCommon(), []);
  });

  test("for-in iterates [item, count] pairs", func() {
    var seen = [];
    for (var pair in collections.Counter(["a", "a"])) { seen[length(seen)] = pair; }
    assert.equal(seen, [["a", 2]]);
  });
});

describe("collections: DefaultDict", func() {
  test("get creates a value with the factory on first access", func() {
    var d = collections.DefaultDict(func() { return []; });
    var list = d.get("k");
    assert.equal(list, []);
    assert.isTrue(d.has("k"));
    assert.equal(d.keys(), ["k"]);
  });

  test("works as a counting dictionary", func() {
    var d = collections.DefaultDict(func() { return 0; });
    d.set("a", d.get("a") + 1);
    d.set("a", d.get("a") + 1);
    assert.equal(d.get("a"), 2);
    assert.equal(d.get("b"), 0);
    assert.equal(d.keys(), ["a", "b"]);
  });

  test("without a factory a missing key is nil and is not created", func() {
    var d = collections.DefaultDict();
    assert.isNil(d.get("q"));
    assert.isFalse(d.has("q"));
  });

  test("set is chainable; delete, keys, values and entries", func() {
    var d = collections.DefaultDict(func() { return 7; });
    d.get("x");
    d.set("y", 1).set("z", 2);
    assert.isTrue(d.delete("x"));
    assert.isFalse(d.delete("x"));
    assert.equal(d.keys(), ["y", "z"]);
    assert.equal(d.values(), [1, 2]);
    assert.equal(d.entries(), [["y", 1], ["z", 2]]);
  });
});

describe("collections: OrderedDict", func() {
  test("keeps insertion order", func() {
    var o = collections.OrderedDict([["a", 1], ["b", 2], ["c", 3]]);
    assert.equal(o.keys(), ["a", "b", "c"]);
    assert.equal(o.values(), [1, 2, 3]);
    assert.equal(o.entries(), [["a", 1], ["b", 2], ["c", 3]]);
    assert.equal(o.get("b"), 2);
    assert.isNil(o.get("zz"));
  });

  test("set is chainable", func() {
    var o = collections.OrderedDict();
    o.set("x", 1).set("y", 2);
    assert.equal(o.keys(), ["x", "y"]);
  });

  test("popitem removes the last or the first entry", func() {
    var o = collections.OrderedDict([["a", 1], ["b", 2], ["c", 3]]);
    assert.equal(o.popitem(), ["c", 3]);
    assert.equal(o.popitem(false), ["a", 1]);
    assert.equal(o.keys(), ["b"]);
  });

  test("popitem on an empty dictionary is an error", func() {
    assert.throws(func() { collections.OrderedDict().popitem(); }, "dictionary is empty");
  });

  test("moveToEnd and moveToEnd(key, false)", func() {
    var o = collections.OrderedDict([["a", 1], ["b", 2], ["c", 3]]);
    o.moveToEnd("a");
    assert.equal(o.keys(), ["b", "c", "a"]);
    o.moveToEnd("c", false);
    assert.equal(o.keys(), ["c", "b", "a"]);
  });

  test("moveToEnd of an unknown key is an error", func() {
    assert.throws(func() { collections.OrderedDict().moveToEnd("x"); }, "not found");
  });
});

finish("collections");
