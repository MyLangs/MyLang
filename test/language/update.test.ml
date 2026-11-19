import "core:test" as { describe, test, assert, finish };

// `++` and `--` on a member: `o.n++`, `items[i]--`, `this.count++`, `Type.static++`.
// A member is stepped through the same path as `+= 1`, so every rule an assignment obeys
// holds for `++` as well.

struct Counter {
  static var created = 0;
  private var count;

  func init() {
    this.count = 0;
    Counter.created++;
  }

  func bump() {
    this.count++;
    return this.count;
  }

  func drop() {
    this.count--;
    return this.count;
  }

  func peekAfter() { return this.count++; }
}

var calls = 0;
var shared = { n: 0 };

func target() {
  calls++;
  return shared;
}

describe("++ and -- on a member", func() {
  test("a field steps up and down", func() {
    var o = { n: 5 };

    o.n++;
    o.n++;
    o.n--;

    assert.equal(o.n, 6);
  });

  test("the expression's value is the value before the step", func() {
    var o = { n: 10 };
    var before = o.n++;

    assert.equal(before, 10);
    assert.equal(o.n, 11);
    assert.equal(o.n-- + 100, 111);
    assert.equal(o.n, 10);
  });

  test("an element of an array, by index", func() {
    var items = [1, 2, 3];
    var i = 1;

    items[i]++;
    items[2]--;
    items[0]++;

    assert.equal(items, [2, 3, 2]);
  });

  test("a nested member", func() {
    var o = { inner: { deep: { n: 1 } } };

    o.inner.deep.n++;

    assert.equal(o.inner.deep.n, 2);
  });

  test("the object is evaluated once", func() {
    calls = 0;
    shared.n = 0;

    target().n++;

    assert.equal(calls, 1);
    assert.equal(shared.n, 1);
  });

  test("the index is evaluated once", func() {
    var items = [0, 0, 0];
    var reads = 0;

    func at() {
      reads++;
      return 1;
    }

    items[at()]++;

    assert.equal(reads, 1);
    assert.equal(items, [0, 1, 0]);
  });
});

describe("++ and -- inside a struct", func() {
  test("this.field in a method, including a private one", func() {
    var c = Counter();

    c.bump();
    c.bump();

    assert.equal(c.bump(), 3);
    assert.equal(c.drop(), 2);
  });

  test("a static member through the type", func() {
    var before = Counter.created;

    Counter();
    Counter();

    assert.equal(Counter.created, before + 2);
  });

  test("the postfix value inside a method", func() {
    var c = Counter();

    assert.equal(c.peekAfter(), 0);
    assert.equal(c.peekAfter(), 1);
  });

  test("a private member stays private", func() {
    var c = Counter();

    assert.throws(func() { c.count++; }, "private member 'count'");
  });
});

describe("++ and -- refuse what += refuses", func() {
  test("only numbers step", func() {
    var o = { s: "text" };

    assert.throws(func() { o.s++; }, "only work on number");
  });

  test("a missing member is an error, not nil + 1", func() {
    var o = {};

    assert.throws(func() { o.missing++; }, "does not exist");
  });

  test("a bare name still works as it always did", func() {
    var i = 0;

    i++;
    i++;
    i--;

    assert.equal(i, 1);
  });
});

finish("language: update expressions");
