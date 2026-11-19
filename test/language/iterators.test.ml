import "core:test" as { describe, test, assert, finish };

func Range(start, endA) {
  return {
    [symbol.iterator]: func() {
      var current = start;
      var end = endA;

      return {
        next: func() {
          if (current >= end) {
            return { done: true, value: nil };
          }
          var value = current;
          current++;
          return { done: false, value: value };
        }
      };
    }
  };
}

describe("Custom iterators (symbol.iterator)", func() {
  test("for-in walks a custom iterable", func() {
    var out = [];
    for (var n in Range(0, 5)) { out[length(out)] = n; }
    assert.equal(out, [0, 1, 2, 3, 4]);
  });

  test("an empty range does not iterate", func() {
    var runs = 0;
    for (var n in Range(3, 3)) { runs++; }
    assert.equal(runs, 0);
  });

  test("break stops the iteration", func() {
    var out = [];
    for (var n in Range(0, 100)) {
      if (n == 3) { break; }
      out[length(out)] = n;
    }
    assert.equal(out, [0, 1, 2]);
  });

  test("continue skips a value", func() {
    var out = [];
    for (var n in Range(0, 5)) {
      if (n % 2 == 1) { continue; }
      out[length(out)] = n;
    }
    assert.equal(out, [0, 2, 4]);
  });

  test("each loop gets a fresh iterator", func() {
    var range = Range(0, 3);
    var first = [];
    var second = [];
    for (var n in range) { first[length(first)] = n; }
    for (var n in range) { second[length(second)] = n; }
    assert.equal(first, [0, 1, 2]);
    assert.equal(second, [0, 1, 2]);
  });

  test("nested iteration over two ranges", func() {
    var pairs = 0;
    for (var a in Range(0, 3)) {
      for (var b in Range(0, 2)) { pairs++; }
    }
    assert.equal(pairs, 6);
  });

  test("symbol.iterator is a symbol", func() {
    assert.equal(typeof symbol.iterator, "symbol");
  });

  test("the iterator protocol can be driven by hand", func() {
    var it = Range(10, 12)[symbol.iterator]();
    var a = it.next();
    var b = it.next();
    var c = it.next();
    assert.equal(a, { done: false, value: 10 });
    assert.equal(b, { done: false, value: 11 });
    assert.equal(c.done, true);
  });
});

describe("Built-in iteration", func() {
  test("arrays yield values", func() {
    var out = [];
    for (var v in ["a", "b"]) { out[length(out)] = v; }
    assert.equal(out, ["a", "b"]);
  });

  test("objects yield keys", func() {
    var out = [];
    for (var k in { x: 1, y: 2 }) { out[length(out)] = k; }
    assert.equal(out, ["x", "y"]);
  });

  test("strings yield characters", func() {
    var out = [];
    for (var c in "hey") { out[length(out)] = c; }
    assert.equal(out, ["h", "e", "y"]);
  });
});

finish("iterators");
