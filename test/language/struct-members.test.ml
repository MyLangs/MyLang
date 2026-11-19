import "core:test" as { describe, test, assert, finish };

// `private` and `static` members of a struct. There is no inheritance, so visibility is
// a flat question: `private` is reachable only from inside the same struct type, and
// `static` belongs to the type rather than to an instance.

struct Counter {
  static var created = 0;
  private var count;
  var label;

  func init(label) {
    this.label = label;
    this.count = 0;
    Counter.created += 1;
  }

  private func step(by) {
    this.count += by;
    return this.count;
  }

  func increment() { return this.step(1); }

  func add(n) { return this.step(n); }

  func value() { return this.count; }

  static func total() { return Counter.created; }

  static func reset() { Counter.created = 0; }
}

describe("struct: static members belong to the type", func() {
  test("a static field is shared by every instance", func() {
    Counter.reset();
    assert.equal(Counter.created, 0);

    Counter("a");
    Counter("b");

    assert.equal(Counter.created, 2);
  });

  test("a static method is called on the type", func() {
    Counter.reset();
    Counter("x");

    assert.equal(Counter.total(), 1);
  });

  test("a static field can be assigned through the type", func() {
    Counter.reset();
    Counter.created = 41;
    Counter.created += 1;

    assert.equal(Counter.created, 42);

    Counter.reset();
  });

  test("statics are not copied onto instances", func() {
    var c = Counter("solo");

    assert.isFalse("created" in c);
    assert.throws(func() { return c.created; }, "does not exist");
  });

  test("a static field keeps its value across instances", func() {
    Counter.reset();

    var first = Counter("first");
    var second = Counter("second");

    assert.equal(first.label, "first");
    assert.equal(second.label, "second");
    assert.equal(Counter.created, 2);
  });
});

describe("struct: private members are internal", func() {
  test("a private field cannot be read from outside", func() {
    var c = Counter("a");

    assert.throws(func() { return c.count; }, "private member 'count'");
  });

  test("a private field cannot be written from outside", func() {
    var c = Counter("a");

    assert.throws(func() { c.count = 99; }, "private member 'count'");
  });

  test("a private method cannot be called from outside", func() {
    var c = Counter("a");

    assert.throws(func() { c.step(1); }, "private member 'step'");
  });

  test("`in` does not reveal a private member", func() {
    var c = Counter("a");

    assert.isFalse("count" in c);
    assert.isFalse("step" in c);
    assert.isTrue("label" in c);
    assert.isTrue("increment" in c);
  });

  test("the struct's own methods reach its private members", func() {
    var c = Counter("a");

    assert.equal(c.increment(), 1);
    assert.equal(c.increment(), 2);
    assert.equal(c.add(10), 12);
    assert.equal(c.value(), 12);
  });

  test("two instances keep separate private state", func() {
    var a = Counter("a");
    var b = Counter("b");

    a.increment();
    a.increment();
    b.increment();

    assert.equal(a.value(), 2);
    assert.equal(b.value(), 1);
  });
});

describe("struct: modifiers in a struct expression", func() {
  var Point = struct {
    static var origin = "0,0";
    private var secret;
    var x;

    func init(x) {
      this.x = x;
      this.secret = x * 2;
    }

    func doubled() { return this.secret; }
  };

  test("a struct expression supports the same modifiers", func() {
    var p = Point(3);

    assert.equal(p.x, 3);
    assert.equal(p.doubled(), 6);
    assert.equal(Point.origin, "0,0");
    assert.throws(func() { return p.secret; }, "private member");
  });
});

describe("struct: modifiers are only modifiers inside a struct body", func() {
  test("`private` and `static` stay usable as ordinary names", func() {
    var private = 1;
    var static = 2;

    assert.equal(private + static, 3);

    var obj = { private: "a", static: "b" };

    assert.equal(obj.private, "a");
    assert.equal(obj.static, "b");
  });
});

finish("struct-members");
