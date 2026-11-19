import "core:test" as { describe, test, assert, finish };

describe("Declarations", func() {
  test("var with initial value", func() {
    var x = 10;
    assert.equal(x, 10);
  });

  test("var without value is nil", func() {
    var x;
    assert.isNil(x);
  });

  test("var can be assigned later", func() {
    var x;
    x = 5;
    assert.equal(x, 5);
  });

  test("a variable can change type", func() {
    var x = 1;
    x = "now a string";
    assert.equal(x, "now a string");
    x = [1, 2];
    assert.equal(x, [1, 2]);
  });

  test("initialiser may use earlier variables", func() {
    var a = 2;
    var b = a * 3;
    var c = a + b;
    assert.equal(c, 8);
  });

  test("redeclaring in the same scope is an error", func() {
    assert.throws(func() {
      var a = 1;
      var a = 2;
    }, "has been initialized");
  });
});

describe("Scope", func() {
  test("block scope hides inner declarations", func() {
    assert.throws(func() {
      if (true) { var inner = 5; }
      var leaked = inner;
    }, "is not defined");
  });

  test("a block may shadow an outer variable", func() {
    var a = 1;
    if (true) {
      var a = 2;
      assert.equal(a, 2);
    }
    assert.equal(a, 1);
  });

  test("assignment inside a block updates the outer variable", func() {
    var a = 1;
    if (true) { a = 2; }
    assert.equal(a, 2);
  });

  test("loop variables do not leak", func() {
    for (var i = 0; i < 2; i++) {}
    assert.throws(func() { var x = i; }, "is not defined");
  });

  test("function parameters shadow outer variables", func() {
    var x = 1;
    func f(x) { x = 5; return x; }
    assert.equal(f(2), 5);
    assert.equal(x, 1);
  });

  test("functions see and update outer variables", func() {
    var total = 0;
    func add(n) { total += n; }
    add(1);
    add(2);
    assert.equal(total, 3);
  });

  test("undefined names raise an error", func() {
    assert.throws(func() { var v = definitelyNotDefined; }, "is not defined");
  });

  test("assigning to an undeclared name raises an error", func() {
    assert.throws(func() { undeclaredTarget = 5; }, "is not defined");
  });

  test('typeof on an unknown name is "nil"', func() {
    assert.equal(typeof nothingByThisName, "nil");
  });
});

describe("Constants", func() {
  test("const cannot be reassigned", func() {
    assert.throws(func() {
      var m = 100 as const;
      m = 200;
    }, "constant variable");
  });

  test("const values stay readable", func() {
    var m = 100 as const;
    assert.equal(m + 1, 101);
  });

  test("const collections can still be modified", func() {
    var cart = [] as const;
    cart[0] = "laptop";
    cart[1] = "mouse";
    assert.equal(cart, ["laptop", "mouse"]);
  });

  test("const collections cannot be rebound", func() {
    assert.throws(func() {
      var cart = [] as const;
      cart = ["phone"];
    }, "constant variable");
  });

  test("const cannot be reassigned from a nested function", func() {
    var c = 1 as const;
    func change() { c = 2; }
    assert.throws(func() { change(); }, "constant variable");
    assert.throws(func() { c = 3; }, "constant variable");
    assert.equal(c, 1);
  });

  test("const stays const when passed to a function (contents are mutable)", func() {
    var list = [1, 2] as const;
    func touch(a) { a[0] = 9; }
    touch(list);
    assert.equal(list, [9, 2]);
  });
});

describe("Readonly", func() {
  test("readonly cannot be reassigned", func() {
    assert.throws(func() {
      var v = 1 as readonly;
      v = 2;
    }, "constant variable");
  });

  test("readonly arrays reject element assignment", func() {
    assert.throws(func() {
      var prices = [99, 199] as readonly;
      prices[0] = 50;
    }, "only permits reading");
  });

  test("readonly objects reject property assignment", func() {
    assert.throws(func() {
      var config = { a: 1 } as readonly;
      config.a = 50;
    }, "read-only property");
  });

  test("readonly collections can be read", func() {
    var prices = [99, 199] as readonly;
    assert.equal(prices[1], 199);
    assert.equal(length(prices), 2);
    var config = { a: 1 } as readonly;
    assert.equal(config.a, 1);
  });

  test("readonly collections cannot be modified from a nested function", func() {
    var list = [1, 2] as readonly;
    var cfg = { a: 1 } as readonly;
    func changeList() { list[0] = 9; }
    func changeCfg() { cfg.a = 9; }
    assert.throws(func() { changeList(); }, "only permits reading");
    assert.throws(func() { changeCfg(); }, "read-only property");
    assert.equal(list, [1, 2]);
    assert.equal(cfg.a, 1);
  });

  test("readonly is preserved when passed to a function", func() {
    var prices = [1, 2] as readonly;
    func touch(a) { a[0] = 9; }
    assert.throws(func() { touch(prices); }, "only permits reading");
    assert.equal(prices, [1, 2]);
  });
});

describe("Multiple declarations", func() {
  test("var ( ... ) declares several variables", func() {
    var (first, last = "Doe", year = 1990, extra = 3 * 3);
    assert.isNil(first);
    assert.equal(last, "Doe");
    assert.equal(year, 1990);
    assert.equal(extra, 9);
  });

  test("members can carry readonly / const options", func() {
    var (year = 1990 as readonly, tag = "x" as const);
    assert.throws(func() { year = 5; }, "constant variable");
    assert.throws(func() { tag = "y"; }, "constant variable");
    assert.equal(year, 1990);
  });

  test("multiple return values are unpacked", func() {
    func info() { return ("Alice", 30, "admin"); }
    var (name, age, role) = info();
    assert.equal(name, "Alice");
    assert.equal(age, 30);
    assert.equal(role, "admin");
  });

  test("fewer targets than returned values", func() {
    func three() { return (1, 2, 3); }
    var (a, b) = three();
    assert.equal(a, 1);
    assert.equal(b, 2);
  });
});

describe("Lazy values", func() {
  test("evaluation is deferred until the first read", func() {
    var calls = 0;
    func expensive() { calls++; return 7; }
    var v = expensive() as lazy;
    assert.equal(calls, 0);
    var read = v;
    assert.equal(read, 7);
    assert.equal(calls, 1);
  });

  test("plain expressions work too", func() {
    var v = (1 + 2) as lazy;
    assert.equal(v, 3);
  });

  test("a lazy variable can be passed to a function", func() {
    func twice(x) { return x * 2; }
    var v = (1 + 2) as lazy;
    assert.equal(twice(v), 6);
  });

  test("a lazy variable can be read from a nested function", func() {
    var v = (20 + 1) as lazy;
    func read() { return v; }
    assert.equal(read(), 21);
  });
});

describe("Destructuring", func() {
  test("array destructuring with a rest element", func() {
    var numbers = [1, 2, 3, 4, 5];
    var [first, second, ...rest] = numbers;
    assert.equal(first, 1);
    assert.equal(second, 2);
    assert.equal(rest, [3, 4, 5]);
  });

  test("the rest element can be the only target or empty", func() {
    var [...all] = [1, 2];
    assert.equal(all, [1, 2]);
    var [a, ...none] = [1];
    assert.equal(a, 1);
    assert.equal(none, []);
  });

  test("missing elements are nil", func() {
    var [a, b, c] = [1];
    assert.equal(a, 1);
    assert.isNil(b);
    assert.isNil(c);
  });

  test("default values replace missing or nil elements", func() {
    var [a, b = 5, c = 7] = [1, nil, 3];
    assert.equal([a, b, c], [1, 5, 3]);
  });

  test("a string is destructured into characters", func() {
    var [h, i] = "hi";
    assert.equal(h + i, "hi");
  });

  test("the source can be any expression and is evaluated once", func() {
    var calls = 0;
    func source() { calls++; return [10, 20]; }
    var [x, y] = source();
    assert.equal(x + y, 30);
    assert.equal(calls, 1);
  });

  test("elements may be collections themselves", func() {
    var [list, obj] = [[1, 2], { k: 3 }];
    assert.equal(list, [1, 2]);
    assert.equal(obj.k, 3);
  });

  test("object destructuring by property name", func() {
    var { x, y } = { x: 1, y: 2, z: 3 };
    assert.equal(x, 1);
    assert.equal(y, 2);
  });

  test("README example: functions taken from an object", func() {
    var calculator = {
      value: 0,
      add: func(n) { this.value += n; return this; },
      result() { return this.value; }
    };
    var { value, add } = calculator;
    assert.equal(value, 0);
    assert.typeOf(add, "function");
  });

  test("renaming with key: alias", func() {
    var { name: n, age: years } = { name: "Ann", age: 30 };
    assert.equal(n, "Ann");
    assert.equal(years, 30);
  });

  test("object defaults and missing properties", func() {
    var { a, b = "fallback", c = 9, q } = { a: 1, c: nil };
    assert.equal(a, 1);
    assert.equal(b, "fallback");
    assert.equal(c, 9);
    assert.isNil(q);
  });

  test("struct instances can be destructured like objects", func() {
    struct Point { var x; var y; }
    var { x, y } = Point(3, 4);
    assert.equal(x + y, 7);
  });

  test("private (__) properties are not readable", func() {
    var { __secret, pub } = { __secret: 1, pub: 2 };
    assert.isNil(__secret);
    assert.equal(pub, 2);
  });

  test("a trailing comma is allowed", func() {
    var [a, b,] = [1, 2];
    var { x, y, } = { x: 3, y: 4 };
    assert.equal([a, b, x, y], [1, 2, 3, 4]);
  });

  test("works inside loops and closures", func() {
    var sums = [];
    for (var pair in [[1, 2], [3, 4]]) {
      var [a, b] = pair;
      sums[length(sums)] = a + b;
    }
    assert.equal(sums, [3, 7]);
    var [n] = [5];
    func twice() { return n * 2; }
    assert.equal(twice(), 10);
  });

  test("redeclaring an existing name is an error", func() {
    assert.throws(func() {
      var a = 1;
      var [a] = [2];
    }, "has been initialized");
  });

  test("the source must match the pattern", func() {
    assert.throws(func() { var [a] = 5; }, "cannot destructure int as an array");
    assert.throws(func() { var { a } = [1]; }, "cannot destructure array as an object");
    assert.throws(func() { var { a } = nil; }, "cannot destructure nil as an object");
  });
});

describe("Built-in globals", func() {
  test("process, global and this are objects", func() {
    assert.typeOf(process, "object");
    assert.typeOf(global, "object");
    assert.typeOf(this, "object");
  });

  test("arguments holds every passed value", func() {
    func f() { return arguments; }
    assert.equal(f(1, 2, 3), [1, 2, 3]);
    assert.equal(f(), []);
  });
});

finish("variables");
