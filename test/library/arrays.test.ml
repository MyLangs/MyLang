import "core:test" as { describe, test, assert, finish };
import "arrays";

describe("arrays: iteration", func() {
  test("forEach visits every element with its index", func() {
    var values = [];
    var indexes = [];
    arrays.forEach(["a", "b", "c"], func(x, i) {
      values[length(values)] = x;
      indexes[length(indexes)] = i;
    });
    assert.equal(values, ["a", "b", "c"]);
    assert.equal(indexes, [0, 1, 2]);
  });

  test("forEach on an empty array does nothing", func() {
    var calls = 0;
    arrays.forEach([], func(x) { calls++; });
    assert.equal(calls, 0);
  });

  test("map transforms every element", func() {
    assert.equal(arrays.map([1, 2, 3], func(x) { return x * x; }), [1, 4, 9]);
    assert.equal(arrays.map(["a", "b"], func(x, i) { return x + i; }), ["a0", "b1"]);
    assert.equal(arrays.map([], func(x) { return x; }), []);
  });

  test("map does not modify the source", func() {
    var src = [1, 2, 3];
    arrays.map(src, func(x) { return x * 10; });
    assert.equal(src, [1, 2, 3]);
  });

  test("filter keeps matching elements", func() {
    assert.equal(arrays.filter([1, 2, 3, 4, 5], func(x) { return x % 2 == 1; }), [1, 3, 5]);
    assert.equal(arrays.filter([1, 2], func(x) { return false; }), []);
  });

  test("reduce folds from the left", func() {
    assert.equal(arrays.reduce([1, 2, 3, 4], func(acc, x) { return acc + x; }, 0), 10);
    assert.equal(arrays.reduce([1, 2, 3], func(acc, x) { return acc * x; }), 6);
    assert.equal(arrays.reduce(["a", "b"], func(acc, x) { return acc + x; }, ">"), ">ab");
  });

  test("reduceRight folds from the right", func() {
    assert.equal(arrays.reduceRight(["a", "b", "c"], func(acc, x) { return acc + x; }, ""), "cba");
  });

  test("reduce of an empty array without a start value fails", func() {
    assert.throws(func() { arrays.reduce([], func(a, x) { return a + x; }); }, "empty array");
  });

  test("callbacks can use closures", func() {
    var factor = 3;
    assert.equal(arrays.map([1, 2], func(x) { return x * factor; }), [3, 6]);
  });
});

describe("arrays: searching", func() {
  test("find returns the first match or nil", func() {
    assert.equal(arrays.find([1, 2, 3, 4], func(x) { return x > 2; }), 3);
    assert.isNil(arrays.find([1, 2], func(x) { return x > 9; }));
  });

  test("findIndex returns the position or -1", func() {
    assert.equal(arrays.findIndex([1, 2, 3, 4], func(x) { return x > 2; }), 2);
    assert.equal(arrays.findIndex([1, 2], func(x) { return x > 9; }), -1);
  });

  test("findLast and findLastIndex search from the end", func() {
    assert.equal(arrays.findLast([1, 2, 3, 4], func(x) { return x < 4; }), 3);
    assert.equal(arrays.findLastIndex([1, 2, 3, 4], func(x) { return x < 4; }), 2);
  });

  test("some", func() {
    assert.isTrue(arrays.some([1, 2, 3], func(x) { return x > 2; }));
    assert.isFalse(arrays.some([1, 2, 3], func(x) { return x > 5; }));
    assert.isFalse(arrays.some([], func(x) { return true; }));
  });

  test("every", func() {
    assert.isTrue(arrays.every([1, 2, 3], func(x) { return x > 0; }));
    assert.isFalse(arrays.every([1, 2, 3], func(x) { return x > 1; }));
    assert.isTrue(arrays.every([], func(x) { return false; }));
  });

  test("includes", func() {
    assert.isTrue(arrays.includes([1, 2, 3], 2));
    assert.isFalse(arrays.includes([1, 2, 3], 5));
    assert.isFalse(arrays.includes([1, 2, 3], 1, 1));
    assert.isTrue(arrays.includes(["a", "b"], "b"));
  });

  test("indexOf", func() {
    assert.equal(arrays.indexOf([1, 2, 3, 2], 2), 1);
    assert.equal(arrays.indexOf([1, 2], 9), -1);
    assert.equal(arrays.indexOf([1, 2, 3, 2], 2, 2), 3);
  });

  test("lastIndexOf", func() {
    assert.equal(arrays.lastIndexOf([1, 2, 3, 2], 2), 3);
    assert.equal(arrays.lastIndexOf([1, 2, 3, 2], 2, 2), 1);
    assert.equal(arrays.lastIndexOf([1], 5), -1);
  });

  test("at supports negative indexes", func() {
    assert.equal(arrays.at([1, 2, 3], 0), 1);
    assert.equal(arrays.at([1, 2, 3], -1), 3);
    assert.isNil(arrays.at([1, 2, 3], 9));
  });
});

describe("arrays: modifying in place", func() {
  test("push appends and returns the new length", func() {
    var a = [1];
    assert.equal(arrays.push(a, 2, 3), 3);
    assert.equal(a, [1, 2, 3]);
  });

  test("pop removes the last element", func() {
    var a = [1, 2, 3];
    assert.equal(arrays.pop(a), 3);
    assert.equal(a, [1, 2]);
    assert.isNil(arrays.pop([]));
  });

  test("shift removes the first element", func() {
    var a = [1, 2, 3];
    assert.equal(arrays.shift(a), 1);
    assert.equal(a, [2, 3]);
    assert.isNil(arrays.shift([]));
  });

  test("unshift prepends and returns the new length", func() {
    var a = [3];
    assert.equal(arrays.unshift(a, 1, 2), 3);
    assert.equal(a, [1, 2, 3]);
  });

  test("splice removes and returns elements", func() {
    var a = [1, 2, 3, 4, 5];
    assert.equal(arrays.splice(a, 1, 2), [2, 3]);
    assert.equal(a, [1, 4, 5]);
  });

  test("splice can insert", func() {
    var a = [1, 4];
    arrays.splice(a, 1, 0, 2, 3);
    assert.equal(a, [1, 2, 3, 4]);
  });

  test("splice without a count removes everything from start", func() {
    var a = [1, 2, 3, 4];
    assert.equal(arrays.splice(a, 1), [2, 3, 4]);
    assert.equal(a, [1]);
  });

  test("reverse reverses in place", func() {
    var a = [1, 2, 3];
    arrays.reverse(a);
    assert.equal(a, [3, 2, 1]);
  });
});

describe("arrays: sorting", func() {
  test("numbers are sorted numerically", func() {
    assert.equal(arrays.sort([3, 1, 2]), [1, 2, 3]);
    assert.equal(arrays.sort([10, 9, 1]), [1, 9, 10]);
    assert.equal(arrays.sort([3, 1.5, 2]), [1.5, 2, 3]);
  });

  test("strings are sorted alphabetically", func() {
    assert.equal(arrays.sort(["b", "c", "a"]), ["a", "b", "c"]);
  });

  test("sort sorts in place", func() {
    var a = [3, 1, 2];
    arrays.sort(a);
    assert.equal(a, [1, 2, 3]);
  });

  test("a custom comparator decides the order", func() {
    assert.equal(arrays.sort([3, 1, 2], func(a, b) { return b - a; }), [3, 2, 1]);
    var people = [{ n: "b", age: 30 }, { n: "a", age: 20 }];
    arrays.sort(people, func(x, y) { return x.age - y.age; });
    assert.equal(people[0].n, "a");
  });

  test("sorting an empty array", func() {
    assert.equal(arrays.sort([]), []);
  });

  test("toSorted leaves the source untouched", func() {
    var a = [3, 1, 2];
    assert.equal(arrays.toSorted(a), [1, 2, 3]);
    assert.equal(a, [3, 1, 2]);
  });

  test("toSorted orders like sort", func() {
    assert.equal(arrays.toSorted([10, 9, 1]), [1, 9, 10]);
    assert.equal(arrays.toSorted(["b", "a"]), ["a", "b"]);
    assert.equal(arrays.toSorted([3, 1, 2], func(a, b) { return b - a; }), [3, 2, 1]);
  });

  test("toReversed leaves the source untouched", func() {
    var a = [1, 2, 3];
    assert.equal(arrays.toReversed(a), [3, 2, 1]);
    assert.equal(a, [1, 2, 3]);
  });
});

describe("arrays: non-mutating copies", func() {
  test("toSpliced", func() {
    var a = [1, 2, 3, 4];
    assert.equal(arrays.toSpliced(a, 1, 2, "x"), [1, "x", 4]);
    assert.equal(arrays.toSpliced(a, 1), [1]);
    assert.equal(a, [1, 2, 3, 4]);
  });

  test("with replaces one element in a copy", func() {
    var a = [1, 2, 3];
    assert.equal(arrays.with(a, 1, 20), [1, 20, 3]);
    assert.equal(a, [1, 2, 3]);
  });

  test("concat joins arrays and values", func() {
    assert.equal(arrays.concat([1], [2, 3]), [1, 2, 3]);
    assert.equal(arrays.concat([1], [2], [3]), [1, 2, 3]);
    assert.equal(arrays.concat([1], 2), [1, 2]);
  });

  test("slice copies a range", func() {
    assert.equal(arrays.slice([1, 2, 3, 4], 1, 3), [2, 3]);
    assert.equal(arrays.slice([1, 2, 3, 4], -2), [3, 4]);
    assert.equal(arrays.slice([1, 2, 3]), [1, 2, 3]);
  });

  test("flat flattens one level by default", func() {
    assert.equal(arrays.flat([1, [2, 3], [4]]), [1, 2, 3, 4]);
    assert.equal(arrays.flat([1, [2, [3]]]), [1, 2, [3]]);
  });

  test("flat with a depth", func() {
    assert.equal(arrays.flat([1, [2, [3, [4]]]], 2), [1, 2, 3, [4]]);
    assert.equal(arrays.flat([1, [2, [3, [4]]]], 9), [1, 2, 3, 4]);
  });

  test("flatMap maps then flattens", func() {
    assert.equal(arrays.flatMap([1, 2, 3], func(x) { return [x, x * 10]; }), [1, 10, 2, 20, 3, 30]);
  });
});

describe("arrays: conversion and construction", func() {
  test("join", func() {
    assert.equal(arrays.join([1, 2, 3], "-"), "1-2-3");
    assert.equal(arrays.join([1, 2, 3]), "1,2,3");
    assert.equal(arrays.join([], ","), "");
  });

  test("toString and toLocaleString", func() {
    assert.equal(arrays.toString([1, 2, 3]), "1,2,3");
    assert.equal(arrays.toLocaleString([1, 2]), "1,2");
  });

  test("keys, values and entries", func() {
    assert.equal(arrays.keys(["a", "b", "c"]), [0, 1, 2]);
    assert.equal(arrays.values(["a", "b"]), ["a", "b"]);
    assert.equal(arrays.entries(["a", "b"]), [[0, "a"], [1, "b"]]);
  });

  test("from builds an array from a string or array", func() {
    assert.equal(arrays.from("abc"), ["a", "b", "c"]);
    assert.equal(arrays.from([1, 2]), [1, 2]);
  });

  test("from with a mapping function", func() {
    assert.equal(arrays.from([1, 2, 3], func(x) { return x + 1; }), [2, 3, 4]);
  });

  test("of builds an array from its arguments", func() {
    assert.equal(arrays.of(1, 2, 3), [1, 2, 3]);
    assert.equal(arrays.of(), []);
  });
});

describe("arrays: argument validation", func() {
  test("the first argument must be an array", func() {
    assert.throws(func() { arrays.map("x", func(x) { return x; }); }, "must be of type array");
    assert.throws(func() { arrays.push(5, 1); }, "must be of type array");
    assert.throws(func() { arrays.join(nil, ","); }, "must be of type array");
  });

  test("callbacks must be functions", func() {
    assert.throws(func() { arrays.map([1], 5); }, "must be of type func");
    assert.throws(func() { arrays.filter([1], "x"); }, "must be of type func");
  });
});

finish("arrays");
