import "core:test" as { describe, test, assert, finish };

describe("Declaration and calls", func() {
  test("declared functions are callable", func() {
    func add(a, b) { return a + b; }
    assert.equal(add(2, 3), 5);
  });

  test("functions are values", func() {
    func twice(x) { return x * 2; }
    var f = twice;
    assert.equal(f(4), 8);
    assert.equal(typeof f, "function");
  });

  test("anonymous function expressions", func() {
    var sq = func(x) { return x * x; };
    assert.equal(sq(7), 49);
  });

  test("functions can be stored in arrays and objects", func() {
    var ops = [func(a) { return a + 1; }, func(a) { return a * 2; }];
    assert.equal(ops[0](10), 11);
    assert.equal(ops[1](10), 20);
    var table = { inc: func(a) { return a + 1; } };
    assert.equal(table.inc(1), 2);
    assert.equal(table["inc"](5), 6);
  });

  test("a function returns nil when nothing is returned", func() {
    func noReturn() { var x = 1; }
    func emptyReturn() { return; }
    assert.isNil(noReturn());
    assert.isNil(emptyReturn());
  });

  test("return exits immediately", func() {
    var reached = false;
    func f() { return 1; reached = true; }
    f();
    assert.isFalse(reached);
  });

  test("return inside nested blocks and loops", func() {
    func firstEven(list) {
      for (var n in list) {
        if (n % 2 == 0) { return n; }
      }
      return nil;
    }
    assert.equal(firstEven([1, 3, 4, 6]), 4);
    assert.isNil(firstEven([1, 3]));
  });

  test("calling something that is not a function fails", func() {
    var n = 5;
    assert.throws(func() { n(); }, "unknown function");
    assert.throws(func() { notDefinedAnywhere(); }, "is not defined");
  });
});

describe("Parameters", func() {
  test("default values", func() {
    func make(name, age = 18, role = "user") { return [name, age, role]; }
    assert.equal(make("a"), ["a", 18, "user"]);
    assert.equal(make("b", 5), ["b", 5, "user"]);
    assert.equal(make("c", 6, "admin"), ["c", 6, "admin"]);
  });

  test("defaults can use earlier parameters", func() {
    func f(a, b = a * 2) { return [a, b]; }
    assert.equal(f(3), [3, 6]);
    assert.equal(f(3, 1), [3, 1]);
  });

  test("an explicit nil argument is not replaced by the default", func() {
    func f(a = 5) { return a; }
    assert.isNil(f(nil));
    assert.equal(f(), 5);
  });

  test("missing arguments are nil", func() {
    func f(a, b) { return [a, b]; }
    assert.equal(f(1), [1, nil]);
  });

  test("extra arguments are ignored", func() {
    func f(a) { return a; }
    assert.equal(f(1, 2, 3), 1);
  });

  test("rest parameter collects the remaining arguments", func() {
    func sum(...nums) {
      var total = 0;
      for (var n in nums) { total += n; }
      return total;
    }
    assert.equal(sum(1, 2, 3, 4, 5), 15);
    assert.equal(sum(), 0);
  });

  test("rest parameter after fixed parameters", func() {
    func f(first, ...rest) { return [first, rest]; }
    assert.equal(f(1, 2, 3), [1, [2, 3]]);
    assert.equal(f(1), [1, []]);
  });

  test("arguments exposes every passed value", func() {
    func f() { return arguments; }
    assert.equal(f(1, "two", true), [1, "two", true]);
    assert.equal(f(), []);
  });

  test("arguments are passed by value for primitives", func() {
    func bump(n) { n += 100; return n; }
    var v = 1;
    assert.equal(bump(v), 101);
    assert.equal(v, 1);
  });

  test("collections are passed by reference", func() {
    func fill(list) { list[length(list)] = "x"; }
    func rename(obj) { obj.name = "changed"; }
    var l = [];
    var o = { name: "orig" };
    fill(l);
    rename(o);
    assert.equal(l, ["x"]);
    assert.equal(o.name, "changed");
  });
});

describe("Argument evaluation", func() {
  test("arguments are evaluated left to right", func() {
    var order = [];
    func mark(n) { order[length(order)] = n; return n; }
    func three(a, b, c) { return a + b + c; }
    assert.equal(three(mark(1), mark(2), mark(3)), 6);
    assert.equal(order, [1, 2, 3]);
  });

  test("side effects in arguments hit the real variable", func() {
    var i = 0;
    func id(x) { return x; }
    id(i++);
    id(i++);
    id(i++);
    assert.equal(i, 3);
  });

  test("closures passed as arguments update outer variables", func() {
    var count = 0;
    func run(cb) { cb(); cb(); }
    run(func() { count += 1; });
    assert.equal(count, 2);
  });

  test("closures passed as arguments can be stored and called later", func() {
    var hits = 0;
    var saved = [];
    func register(cb) { saved[length(saved)] = cb; }
    register(func() { hits += 1; });
    register(func() { hits += 10; });
    for (var cb in saved) { cb(); }
    assert.equal(hits, 11);
  });
});

describe("Closures", func() {
  test("counter keeps private state", func() {
    func makeCounter() {
      var c = 0;
      return func() { c++; return c; };
    }
    var next = makeCounter();
    next();
    next();
    assert.equal(next(), 3);
  });

  test("closures are independent", func() {
    func makeCounter() {
      var c = 0;
      return func() { c++; return c; };
    }
    var a = makeCounter();
    var b = makeCounter();
    a();
    a();
    assert.equal(a(), 3);
    assert.equal(b(), 1);
  });

  test("closure factory capturing a parameter", func() {
    func adder(n) { return func(x) { return x + n; }; }
    var add5 = adder(5);
    assert.equal(add5(10), 15);
    var add1 = adder(1);
    assert.equal(add1(2), 3);
  });

  test("shared state between sibling closures", func() {
    func make() {
      var value = 0;
      var inc = func() { value += 1; };
      var get = func() { return value; };
      return [inc, get];
    }
    var pair = make();
    pair[0]();
    pair[0]();
    assert.equal(pair[1](), 2);
  });

  test("a closure sees later changes to the captured variable", func() {
    var x = 1;
    func read() { return x; }
    x = 2;
    assert.equal(read(), 2);
  });
});

describe("Higher-order functions", func() {
  test("passing a function as an argument", func() {
    func apply(a, b, op) { return op(a, b); }
    assert.equal(apply(10, 5, func(x, y) { return x - y; }), 5);
    assert.equal(apply(10, 5, func(x, y) { return x * y; }), 50);
  });

  test("returning a function", func() {
    func multiplier(k) { return func(x) { return x * k; }; }
    var triple = multiplier(3);
    assert.equal(triple(7), 21);
  });

  test("function composition", func() {
    func compose(f, g) { return func(x) { return f(g(x)); }; }
    var inc = func(x) { return x + 1; };
    var dbl = func(x) { return x * 2; };
    var incAfterDouble = compose(inc, dbl);
    assert.equal(incAfterDouble(5), 11);
  });

  test("a callback receives each element", func() {
    func each(list, cb) { for (var item in list) { cb(item); } }
    var seen = [];
    each([1, 2, 3], func(x) { seen[length(seen)] = x * x; });
    assert.equal(seen, [1, 4, 9]);
  });
});

describe("Recursion", func() {
  test("factorial", func() {
    func fact(n) { if (n <= 1) { return 1; } return n * fact(n - 1); }
    assert.equal(fact(1), 1);
    assert.equal(fact(10), 3628800);
  });

  test("fibonacci", func() {
    func fib(n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }
    assert.equal(fib(15), 610);
  });

  test("mutual recursion", func() {
    func isEven(n) { if (n == 0) { return true; } return isOdd(n - 1); }
    func isOdd(n) { if (n == 0) { return false; } return isEven(n - 1); }
    assert.isTrue(isEven(10));
    assert.isTrue(isOdd(7));
    assert.isFalse(isEven(7));
  });

  test("deep recursion", func() {
    func depth(n) { if (n == 0) { return 0; } return 1 + depth(n - 1); }
    assert.equal(depth(2000), 2000);
  });
});

describe("Multiple return values", func() {
  test("tuple return and unpacking", func() {
    func info() { return ("Alice", 30, "admin"); }
    var (name, age, role) = info();
    assert.equal(name, "Alice");
    assert.equal(age, 30);
    assert.equal(role, "admin");
  });

  test("tuple values may be expressions", func() {
    func calc(a, b) { return (a + b, a * b, a - b); }
    var (sum, product, diff) = calc(6, 3);
    assert.equal(sum, 9);
    assert.equal(product, 18);
    assert.equal(diff, 3);
  });

  test("a single parenthesised value is not a tuple", func() {
    func one() { return (5 + 3); }
    assert.equal(one(), 8);
  });
});

describe("this and methods", func() {
  test("object methods see their object through this", func() {
    var counter = { n: 3, double: func() { return this.n * 2; } };
    assert.equal(counter.double(), 6);
  });

  test("this works for objects created inside a function", func() {
    func build() {
      var o = { n: 4, double: func() { return this.n * 2; } };
      return o.double();
    }
    assert.equal(build(), 8);
  });

  test("this works for objects created inside a closure argument", func() {
    func run(cb) { return cb(); }
    var r = run(func() {
      var o = { n: 5, double() { return this.n * 2; } };
      return o.double();
    });
    assert.equal(r, 10);
  });

  test("methods can mutate the object", func() {
    var acc = { total: 0, add: func(n) { this.total += n; } };
    acc.add(5);
    acc.add(7);
    assert.equal(acc.total, 12);
  });

  test("method chaining evaluates each step once", func() {
    var calc = {
      value: 0,
      add: func(n) { this.value += n; return this; },
      multiply: func(n) { this.value *= n; return this; }
    };
    calc.add(5).multiply(2);
    assert.equal(calc.value, 10);
  });

  test("the receiver expression of a call is evaluated once", func() {
    var calls = 0;
    var target = { ping: func() { return "pong"; } };
    func getTarget() { calls++; return target; }
    assert.equal(getTarget().ping(), "pong");
    assert.equal(calls, 1);
  });

  test("method shorthand", func() {
    var o = { who: "me", name() { return this.who; } };
    assert.equal(o.name(), "me");
  });
});

finish("functions");
