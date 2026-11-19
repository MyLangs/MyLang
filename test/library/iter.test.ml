import "core:test" as { describe, test, assert, finish };
import "iter";
import "core:time";
import "core:syncbox";

// A struct that walks a countdown through the language's own iterator protocol.
struct Countdown {
  var from;

  func [symbol.iterator]() {
    var current = this.from;

    return {
      next: func() {
        if (current <= 0) { return { done: true, value: nil }; }

        current--;

        return { done: false, value: current + 1 };
      }
    };
  }
}

// The same protocol on a plain object.
func countTo(n) {
  return {
    [symbol.iterator]: func() {
      var i = 0;

      return {
        next: func() {
          i++;
          return { done: i > n, value: i };
        }
      };
    }
  };
}

// Collects at most `limit` values of any iterator with for-in (so that endless
// iterators such as count() / cycle() can be sampled).
func take(it, limit) {
  var out = [];
  for (var v in it) {
    out[length(out)] = v;
    if (length(out) >= limit) { break; }
  }
  return out;
}

func drain(it) { return take(it, 1000); }

describe("iter: range", func() {
  test("range(stop)", func() {
    assert.equal(drain(iter.range(5)), [0, 1, 2, 3, 4]);
  });

  test("range(start, stop) and a step", func() {
    assert.equal(drain(iter.range(2, 6)), [2, 3, 4, 5]);
    assert.equal(drain(iter.range(0, 10, 3)), [0, 3, 6, 9]);
  });

  test("a negative step counts down", func() {
    assert.equal(drain(iter.range(5, 0, -2)), [5, 3, 1]);
  });

  test("empty and fractional ranges", func() {
    assert.equal(drain(iter.range(3, 3)), []);
    assert.equal(drain(iter.range(0, 1, 0.25)), [0, 0.25, 0.5, 0.75]);
  });

  test("next() walks the range and then reports done", func() {
    var r = iter.range(2);
    assert.equal(r.next(), { value: 0, done: false });
    assert.equal(r.next(), { value: 1, done: false });
    assert.equal(r.next().done, true);
    assert.equal(r.next().done, true);
  });

  test("a zero step and non-numeric arguments are rejected", func() {
    assert.throws(func() { iter.range(0, 5, 0); }, "non-zero number");
    assert.throws(func() { iter.range("a"); }, "must be of type number");
  });
});

describe("iter: Iterator", func() {
  test("over an array", func() {
    var it = iter.Iterator([1, 2]);
    assert.equal(it.next(), { value: 1, done: false });
    assert.equal(it.next(), { value: 2, done: false });
    assert.equal(it.next().done, true);
    assert.equal(drain(iter.Iterator([7, 8])), [7, 8]);
  });

  test("over an object yields key/value entries", func() {
    var it = iter.Iterator({ a: 1, b: 2 });
    assert.equal(it.next(), { value: { key: "a", value: 1 }, done: false });
    assert.equal(drain(iter.Iterator({ x: 1 })), [{ key: "x", value: 1 }]);
  });

  test("over a string yields characters", func() {
    assert.equal(drain(iter.Iterator("ab")), ["a", "b"]);
  });

  test("an iterator passed to Iterator is returned as it is (shared state)", func() {
    var r = iter.range(3);
    r.next();
    var same = iter.Iterator(r);
    assert.equal(same.next().value, 1);
    assert.equal(r.next().value, 2);
  });

  test("other values are rejected", func() {
    assert.throws(func() { iter.Iterator(5); }, "must be of type iterable");
  });
});

describe("iter: enumerate", func() {
  test("pairs each value with its index", func() {
    assert.equal(
      drain(iter.enumerate(["a", "b"])),
      [{ index: 0, value: "a" }, { index: 1, value: "b" }]
    );
  });

  test("a start offset", func() {
    assert.equal(
      drain(iter.enumerate(["a", "b"], 1)),
      [{ index: 1, value: "a" }, { index: 2, value: "b" }]
    );
  });

  test("works on strings", func() {
    assert.equal(drain(iter.enumerate("xy")), [{ index: 0, value: "x" }, { index: 1, value: "y" }]);
  });

  test("next()", func() {
    var e = iter.enumerate(["a"]);
    assert.equal(e.next(), { value: { index: 0, value: "a" }, done: false });
    assert.equal(e.next().done, true);
  });

  test("validation", func() {
    assert.throws(func() { iter.enumerate([1], "x"); }, "must be of type number");
  });
});

describe("iter: zip, zipLongest and chain", func() {
  test("zip stops at the shortest input", func() {
    assert.equal(drain(iter.zip([1, 2, 3], ["a", "b"])), [[1, "a"], [2, "b"]]);
  });

  test("zip of three inputs", func() {
    assert.equal(
      drain(iter.zip([1, 2], ["a", "b"], [true, false])),
      [[1, "a", true], [2, "b", false]]
    );
  });

  test("zip next()", func() {
    var z = iter.zip([1, 2], ["a"]);
    assert.equal(z.next(), { value: [1, "a"], done: false });
    assert.equal(z.next().done, true);
  });

  test("zip needs at least one input", func() {
    assert.throws(func() { iter.zip(); }, "at least 1");
  });

  test("zipLongest pads shorter inputs with the fill value", func() {
    assert.equal(drain(iter.zipLongest([1, 2, 3], ["a"])), [[1], [2], [3]]);
    assert.equal(drain(iter.zipLongest([1], ["a", "b"], 0)), [[1, "a"], [0, "b"]]);
    assert.equal(drain(iter.zipLongest([1, 2], ["a"], "-")), [[1, "a"], [2, "-"]]);
  });

  test("chain concatenates inputs", func() {
    assert.equal(drain(iter.chain([1, 2], [3], [4, 5])), [1, 2, 3, 4, 5]);
    assert.equal(drain(iter.chain([1], "ab")), [1, "a", "b"]);
  });

  test("chain next()", func() {
    var c = iter.chain([1], [2]);
    assert.equal(c.next().value, 1);
    assert.equal(c.next().value, 2);
    assert.equal(c.next().done, true);
  });

  test("chain needs an iterable for every argument", func() {
    assert.throws(func() { iter.chain(5); }, "must be of type iterable");
  });
});

describe("iter: endless iterators", func() {
  test("count starts at 0 by default", func() {
    assert.equal(take(iter.count(), 3), [0, 1, 2]);
  });

  test("count with a start and a step", func() {
    assert.equal(take(iter.count(5), 3), [5, 6, 7]);
    assert.equal(take(iter.count(0, 2), 4), [0, 2, 4, 6]);
    assert.equal(take(iter.count(10, -3), 3), [10, 7, 4]);
  });

  test("count next()", func() {
    var c = iter.count(3);
    assert.equal(c.next(), { value: 3, done: false });
    assert.equal(c.next(), { value: 4, done: false });
  });

  test("cycle repeats the input forever", func() {
    assert.equal(take(iter.cycle([1, 2]), 5), [1, 2, 1, 2, 1]);
    var c = iter.cycle([1, 2]);
    assert.equal(c.next().value, 1);
    assert.equal(c.next().value, 2);
    assert.equal(c.next().value, 1);
  });

  test("cycle of nothing is empty", func() {
    assert.equal(drain(iter.cycle([])), []);
  });

  test("repeat with and without a count", func() {
    assert.equal(drain(iter.repeat("x", 3)), ["x", "x", "x"]);
    assert.equal(take(iter.repeat(1), 3), [1, 1, 1]);
    assert.equal(drain(iter.repeat("a", 0)), []);
  });

  test("repeat next() ends after the count", func() {
    var r = iter.repeat("z", 2);
    assert.equal(r.next().value, "z");
    assert.equal(r.next().value, "z");
    assert.equal(r.next().done, true);
  });

  test("validation", func() {
    assert.throws(func() { iter.count("a"); }, "must be of type number");
    assert.throws(func() { iter.cycle(5); }, "must be of type iterable");
    assert.throws(func() { iter.repeat("x", -1); }, "non-negative number");
  });

  test("endless iterators compose with zip", func() {
    assert.equal(
      take(iter.zip(iter.count(), iter.cycle(["a", "b"])), 3),
      [[0, "a"], [1, "b"], [2, "a"]]
    );
  });

  test("iterators can be zipped together", func() {
    assert.equal(drain(iter.zip(iter.range(3), iter.range(10, 13))), [[0, 10], [1, 11], [2, 12]]);
  });
});

describe("iter: filtering", func() {
  test("takeWhile stops at the first failing value", func() {
    assert.equal(drain(iter.takeWhile([1, 2, 3, 1], func(x) { return x < 3; })), [1, 2]);
  });

  test("takeWhile can read an endless range", func() {
    assert.equal(drain(iter.takeWhile(iter.range(100), func(x) { return x < 4; })), [0, 1, 2, 3]);
  });

  test("takeWhile next()", func() {
    var t = iter.takeWhile([1, 2, 3], func(x) { return x < 3; });
    assert.equal(t.next().value, 1);
    assert.equal(t.next().value, 2);
    assert.equal(t.next().done, true);
    assert.equal(t.next().done, true);
  });

  test("dropWhile skips the leading values", func() {
    assert.equal(drain(iter.dropWhile([1, 2, 3, 1], func(x) { return x < 3; })), [3, 1]);
    var d = iter.dropWhile([1, 2, 3, 1], func(x) { return x < 3; });
    assert.equal(d.next().value, 3);
    assert.equal(d.next().value, 1);
    assert.equal(d.next().done, true);
  });

  test("filterFalse keeps the values the predicate rejects", func() {
    assert.equal(drain(iter.filterFalse([1, 2, 3, 4], func(x) { return x % 2 == 0; })), [1, 3]);
    var f = iter.filterFalse([1, 2, 3, 4], func(x) { return x % 2 == 0; });
    assert.equal(f.next().value, 1);
    assert.equal(f.next().value, 3);
    assert.equal(f.next().done, true);
  });

  test("compress selects by a mask", func() {
    assert.equal(drain(iter.compress(["a", "b", "c", "d"], [1, 0, true, false])), ["a", "c"]);
    var c = iter.compress([1, 2, 3], [1, 0, 1]);
    assert.equal(c.next().value, 1);
    assert.equal(c.next().value, 3);
    assert.equal(c.next().done, true);
  });

  test("the predicate must be a function", func() {
    assert.throws(func() { iter.takeWhile([1], 5); }, "must be of type function");
    assert.throws(func() { iter.dropWhile([1], 5); }, "must be of type function");
    assert.throws(func() { iter.filterFalse([1], 5); }, "must be of type function");
  });
});

describe("iter: grouping and accumulating", func() {
  test("groupBy groups consecutive equal values", func() {
    var groups = [];
    for (var g in iter.groupBy([1, 1, 2, 2, 2, 1])) {
      groups[length(groups)] = [g.key, drain(g.group)];
    }
    assert.equal(groups, [[1, [1, 1]], [2, [2, 2, 2]], [1, [1]]]);
  });

  test("groupBy over a string", func() {
    var sizes = [];
    for (var g in iter.groupBy("aabbbc")) { sizes[length(sizes)] = [
      g.key,
      length(drain(g.group))
    ]; }
    assert.equal(sizes, [["a", 2], ["b", 3], ["c", 1]]);
  });

  test("groupBy with a key function", func() {
    var keys = [];
    for (var g in iter.groupBy(["a", "A", "b", "B"], func(x) { return x == "a" || x == "A"; })) {
      keys[length(keys)] = g.key;
    }
    assert.equal(keys, [true, false]);
  });

  test("groupBy next()", func() {
    var g = iter.groupBy([1, 1, 2]);
    var first = g.next();
    var second = g.next();
    assert.equal(first.value.key, 1);
    assert.equal(drain(first.value.group), [1, 1]);
    assert.equal(second.value.key, 2);
    assert.equal(drain(second.value.group), [2]);
    assert.isTrue(g.next().done);
  });

  test("accumulate sums by default", func() {
    assert.equal(drain(iter.accumulate([1, 2, 3, 4])), [1, 3, 6, 10]);
    assert.equal(drain(iter.accumulate(["a", "b", "c"])), ["a", "ab", "abc"]);
    assert.equal(drain(iter.accumulate([])), []);
  });

  test("accumulate with a function and an initial value", func() {
    assert.equal(drain(iter.accumulate([1, 2, 3, 4], func(a, b) { return a * b; })), [1, 2, 6, 24]);
    assert.equal(drain(iter.accumulate([1, 2, 3], func(a, b) { return a + b; }, 10)), [11, 13, 16]);
  });

  test("accumulate with only an initial value", func() {
    assert.equal(drain(iter.accumulate([1, 2], nil, 100)), [101, 103]);
  });

  test("accumulate next()", func() {
    var a = iter.accumulate([1, 2, 3]);
    assert.equal(a.next().value, 1);
    assert.equal(a.next().value, 3);
    assert.equal(a.next().value, 6);
    assert.isTrue(a.next().done);
  });

  test("pairwise yields overlapping pairs", func() {
    assert.equal(drain(iter.pairwise([1, 2, 3, 4])), [[1, 2], [2, 3], [3, 4]]);
    assert.equal(drain(iter.pairwise([1])), []);
    assert.equal(drain(iter.pairwise([])), []);
  });

  test("pairwise next()", func() {
    var p = iter.pairwise([1, 2, 3]);
    assert.equal(p.next().value, [1, 2]);
    assert.equal(p.next().value, [2, 3]);
    assert.isTrue(p.next().done);
  });
});

describe("iter: flatten", func() {
  test("flattens one level by default", func() {
    assert.equal(drain(iter.flatten([1, [2, [3, [4]]]])), [1, 2, [3, [4]]]);
  });

  test("a depth", func() {
    assert.equal(drain(iter.flatten([1, [2, [3, [4]]]], 2)), [1, 2, 3, [4]]);
    assert.equal(drain(iter.flatten([1, [2, [3, [4]]]], 9)), [1, 2, 3, 4]);
    assert.equal(drain(iter.flatten([1, [2]], 0)), [1, [2]]);
  });

  test("next()", func() {
    var f = iter.flatten([1, [2]]);
    assert.equal(f.next().value, 1);
    assert.equal(f.next().value, 2);
    assert.isTrue(f.next().done);
  });

  test("a negative depth is rejected", func() {
    assert.throws(func() { iter.flatten([1], -1); }, "non-negative number");
  });
});

describe("iter: misc", func() {
  test("symbol is the iterator symbol", func() {
    assert.equal(typeof iter.symbol, "symbol");
  });

  test("for-in over any iterator can be left with break", func() {
    var seen = 0;
    for (var v in iter.count()) {
      seen++;
      if (v == 4) { break; }
    }
    assert.equal(seen, 5);
  });
});

describe("iter: functions over any iterable", func() {
  test("map and filter are lazy and take the sequence first", func() {
    var evens = iter.filter(iter.range(1, 20), func(n) { return n % 2 == 0; });
    var squares = iter.map(evens, func(n) { return n * n; });

    assert.equal(iter.toArray(iter.take(squares, 4)), [4, 16, 36, 64]);
  });

  test("take stops asking an endless source", func() {
    var asked = 0;
    var watched = iter.map(iter.count(), func(n) { asked++; return n; });

    assert.equal(iter.toArray(iter.take(watched, 3)), [0, 1, 2]);
    assert.equal(asked, 3);
  });

  test("skip drops the first values", func() {
    assert.equal(iter.toArray(iter.skip(iter.range(6), 4)), [4, 5]);
    assert.equal(iter.toArray(iter.skip([1, 2], 5)), []);
  });

  test("toArray and forEach accept plain arrays and strings", func() {
    var seen = [];

    iter.forEach("ab", func(c) { seen[length(seen)] = c; });

    assert.equal(seen, ["a", "b"]);
    assert.equal(iter.toArray([3, 4]), [3, 4]);
    assert.equal(iter.toArray({ k: 1 }), [{ key: "k", value: 1 }]);
  });

  test("a count must be a non-negative int", func() {
    assert.throws(func() { iter.take([1], -1); }, "non-negative int");
    assert.throws(func() { iter.skip([1], "2"); }, "non-negative int");
  });

  test("a callback must be a function", func() {
    assert.throws(func() { iter.map([1], 5); }, "must be of type function");
    assert.throws(func() { iter.filter([1], nil); }, "must be of type function");
  });

  test("an iterator has next and nothing chained on it", func() {
    var it = iter.range(3);

    assert.isTrue("next" in it);
    assert.isFalse("map" in it);
    assert.isFalse("toArray" in it);
  });
});

describe("iter: custom iterables", func() {
  test("a struct that declares symbol.iterator", func() {
    assert.equal(iter.toArray(Countdown(3)), [3, 2, 1]);
    assert.equal(iter.toArray(iter.map(Countdown(2), func(n) { return n * 10; })), [20, 10]);
  });

  test("an object with symbol.iterator is walked, not listed by key", func() {
    assert.equal(iter.toArray(countTo(3)), [1, 2, 3]);
  });

  test("every function takes one", func() {
    assert.equal(iter.toArray(iter.zip(Countdown(2), countTo(5))), [[2, 1], [1, 2]]);
    assert.equal(iter.toArray(iter.enumerate(Countdown(1))), [{ index: 0, value: 1 }]);
    assert.equal(iter.toArray(iter.chain(Countdown(1), countTo(1))), [1, 1]);
    assert.equal(iter.toArray(iter.pairwise(countTo(3))), [[1, 2], [2, 3]]);
    assert.equal(iter.toArray(iter.accumulate(countTo(3))), [1, 3, 6]);
  });

  test("Iterator() over one gives next() and for-in the same steps", func() {
    var it = iter.Iterator(Countdown(4));

    assert.equal(it.next().value, 4);

    var rest = [];

    for (var n in it) { rest[length(rest)] = n; }

    assert.equal(rest, [3, 2, 1]);
    assert.isTrue(it.next().done);
  });

  test("a struct without the member is not iterable", func() {
    struct Plain { var a; }

    assert.throws(func() { iter.Iterator(Plain(1)); }, "must be of type iterable");
  });

  test("a factory that does not return next is reported", func() {
    var broken = { [symbol.iterator]: func() { return {}; } };

    assert.throws(func() { iter.toArray(broken); }, "must return a <next> function");
  });
});

describe("iter: a step may suspend", func() {
  test("a map callback that sleeps", func() {
    var slow = iter.map(iter.range(3), func(n) {
      time.Sleep(2);
      return n + 100;
    });

    assert.equal(iter.toArray(slow), [100, 101, 102]);
  });

  test("a filter callback that waits on a channel", func() {
    var gate = syncbox.Chan(10);

    for (var i = 0; i < 5; i++) { gate.send(i % 2 == 0); }

    var kept = iter.filter(iter.range(5), func(n) { return gate.recv(); });

    assert.equal(iter.toArray(kept), [0, 2, 4]);
  });

  test("other tasks run while a sequence is being drained", func() {
    var ticks = 0;

    var ticker = spawn {
      for (var i = 0; i < 3; i++) {
        time.Sleep(1);
        ticks++;
      }
    };

    iter.forEach(iter.range(3), func(n) { time.Sleep(3); });

    wait ticker;

    assert.equal(ticks, 3);
  });
});

finish("iter");
