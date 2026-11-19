import "core:test" as { describe, test, assert, finish };

describe("Arithmetic", func() {
  test("addition, subtraction, multiplication", func() {
    assert.equal(2 + 3, 5);
    assert.equal(10 - 4, 6);
    assert.equal(6 * 7, 42);
  });

  test("division is not truncating", func() {
    assert.equal(7 / 2, 3.5);
    assert.equal(10 / 5, 2);
  });

  test("modulo", func() {
    assert.equal(7 % 3, 1);
    assert.equal(10 % 5, 0);
    assert.equal(-7 % 3, -1);
  });

  test("exponentiation", func() {
    assert.equal(2 ** 10, 1024);
    assert.equal(9 ** 0.5, 3);
    assert.equal(5 ** 0, 1);
  });

  test("floating point arithmetic", func() {
    assert.closeTo(0.1 + 0.2, 0.3);
    assert.equal(1.5 + 1.5, 3);
  });

  test("division by zero is infinity", func() {
    assert.typeOf(1 / 0, "infinity");
    assert.typeOf(0 / 0, "nan");
  });

  test("unary minus and plus", func() {
    var a = 5;
    assert.equal(-a, -5);
    assert.equal(+a, 5);
    assert.equal(-(-a), 5);
  });

  test("unary plus / minus convert numeric strings", func() {
    assert.equal(+"123", 123);
    assert.equal(-"456", -456);
  });
});

describe("Precedence and grouping", func() {
  test("multiplication before addition", func() {
    assert.equal(1 + 2 * 3, 7);
    assert.equal(10 - 4 / 2, 8);
  });

  test("exponent before multiplication", func() {
    assert.equal(1 + 2 * 3 ** 2, 19);
  });

  test("parentheses override precedence", func() {
    assert.equal((5 + 3) * 2 - 4 / 2, 14);
    assert.equal(2 * (3 + 4), 14);
  });

  test("left associativity of - and /", func() {
    assert.equal(10 - 3 - 2, 5);
    assert.equal(100 / 10 / 5, 2);
  });

  test("comparison binds looser than arithmetic", func() {
    assert.isTrue(1 + 1 == 2);
    assert.isTrue(2 * 3 > 5);
  });

  test("a parenthesised expression can start a return statement", func() {
    func f(a, b, c) { return (a + b) * c; }
    assert.equal(f(1, 2, 3), 9);
    func g(a) { return (a + 1) + 2; }
    assert.equal(g(1), 4);
    func h(a) { return (a + 1) == 3 ? "yes" : "no"; }
    assert.equal(h(2), "yes");
  });
});

describe("Comparison", func() {
  test("relational operators", func() {
    assert.isTrue(1 < 2);
    assert.isTrue(2 <= 2);
    assert.isFalse(3 > 4);
    assert.isTrue(4 >= 4);
  });

  test("equality of primitives", func() {
    assert.isTrue(1 == 1);
    assert.isTrue(1 != 2);
    assert.isTrue(1 == 1.0);
    assert.isTrue("a" == "a");
    assert.isTrue(true == true);
    assert.isTrue(nil == nil);
  });

  test("deep equality of arrays", func() {
    assert.isTrue([1, 2, 3] == [1, 2, 3]);
    assert.isTrue([1, [2, [3]]] == [1, [2, [3]]]);
    assert.isFalse([1, 2] == [1, 3]);
    assert.isTrue([1, 2] != [2, 1]);
  });

  test("deep equality of objects", func() {
    assert.isTrue({ a: 1, b: [1, 2] } == { a: 1, b: [1, 2] });
    assert.isFalse({ a: 1 } == { a: 2 });
    assert.isTrue({ a: 1 } != { a: 2 });
  });

  test("a reference equals itself", func() {
    var a = [1];
    var b = a;
    assert.isTrue(a == b);
  });
});

describe("Logical operators", func() {
  test("&& and || return operands, not just booleans", func() {
    assert.equal(true && "hello", "hello");
    assert.equal(false || "default", "default");
    assert.equal(0 && 1, 0);
    assert.equal(nil || "x", "x");
    assert.equal("a" || "b", "a");
  });

  test("! negates truthiness", func() {
    assert.isTrue(!false);
    assert.isTrue(!nil);
    assert.isTrue(!0);
    assert.isTrue(!"");
    assert.isFalse(!"text");
    assert.isTrue(!!"text");
  });

  test("&& does not evaluate the right side when the left is falsy", func() {
    var calls = 0;
    func side() { calls++; return true; }
    var r = false && side();
    assert.equal(calls, 0);
    assert.equal(r, false);
    var r2 = true && side();
    assert.equal(calls, 1);
    assert.equal(r2, true);
  });

  test("|| does not evaluate the right side when the left is truthy", func() {
    var calls = 0;
    func side() { calls++; return false; }
    var r = true || side();
    assert.equal(calls, 0);
    assert.equal(r, true);
    var r2 = false || side();
    assert.equal(calls, 1);
    assert.equal(r2, false);
  });

  test("short-circuit guards against nil access", func() {
    var user = nil;
    var ok = user != nil && user.name == "x";
    assert.isFalse(ok);
    var name = user == nil || user.name;
    assert.isTrue(name);
  });

  test("short-circuit with undefined names on the right", func() {
    assert.equal(false && thisNameDoesNotExist, false);
    assert.equal(true || thisNameDoesNotExist, true);
  });
});

describe("Bitwise operators", func() {
  test("and, or, xor, not", func() {
    assert.equal(6 & 3, 2);
    assert.equal(6 | 3, 7);
    assert.equal(6 ^ 3, 5);
    assert.equal(~5, -6);
  });

  test("shifts", func() {
    assert.equal(1 << 4, 16);
    assert.equal(-16 >> 2, -4);
    assert.equal(-16 >>> 2, 1073741820);
    assert.equal(16 >> 2, 4);
  });
});

describe("Increment and decrement", func() {
  test("postfix ++ and --", func() {
    var i = 5;
    i++;
    assert.equal(i, 6);
    i--;
    i--;
    assert.equal(i, 4);
  });

  test("postfix yields the old value", func() {
    var i = 5;
    var old = i++;
    assert.equal(old, 5);
    assert.equal(i, 6);
    var old2 = i--;
    assert.equal(old2, 6);
    assert.equal(i, 5);
  });

  test("works as a call argument", func() {
    var i = 0;
    func id(x) { return x; }
    id(i++);
    id(i++);
    assert.equal(i, 2);
  });
});

describe("Compound assignment", func() {
  test("arithmetic forms", func() {
    var a = 25;
    a -= 5;
    assert.equal(a, 20);
    a += 10;
    assert.equal(a, 30);
    a /= 10;
    assert.equal(a, 3);
    a *= 10;
    assert.equal(a, 30);
    a **= 2;
    assert.equal(a, 900);
    a %= 8;
    assert.equal(a, 4);
  });

  test("bitwise forms", func() {
    var a = 6;
    a |= 3;
    assert.equal(a, 7);
    var b = 6;
    b &= 3;
    assert.equal(b, 2);
    var c = 6;
    c ^= 3;
    assert.equal(c, 5);
  });

  test("shift forms", func() {
    var n = 3;
    n <<= 2;
    assert.equal(n, 12);
    var m = -16;
    m >>= 2;
    assert.equal(m, -4);
    var l = -16;
    l >>>= 2;
    assert.equal(l, 1073741820);
  });

  test("string concatenation with +=", func() {
    var s = "a";
    s += "b";
    s += 1;
    assert.equal(s, "ab1");
  });

  test("logical forms", func() {
    var a = 1;
    a &&= 5;
    assert.equal(a, 5);
    var b = 0;
    b &&= 5;
    assert.equal(b, 0);
    var c = 0;
    c ||= 7;
    assert.equal(c, 7);
    var d = 2;
    d ||= 7;
    assert.equal(d, 2);
  });

  test("logical forms are lazy", func() {
    var calls = 0;
    func side() { calls++; return 9; }
    var a = 0;
    a &&= side();
    var b = 1;
    b ||= side();
    assert.equal(calls, 0);
    var c = 1;
    c &&= side();
    assert.equal(calls, 1);
    assert.equal(c, 9);
  });

  test("on object members", func() {
    var o = { n: 10, s: "x", z: 0, t: 3 };
    o.n += 5;
    assert.equal(o.n, 15);
    o.n -= 3;
    assert.equal(o.n, 12);
    o.n *= 2;
    assert.equal(o.n, 24);
    o.n /= 4;
    assert.equal(o.n, 6);
    o.n %= 4;
    assert.equal(o.n, 2);
    o.n **= 3;
    assert.equal(o.n, 8);
    o.s += "y";
    assert.equal(o.s, "xy");
    o.z ||= 4;
    assert.equal(o.z, 4);
    o.t &&= 8;
    assert.equal(o.t, 8);
  });

  test("on array elements", func() {
    var a = [1, 2, 3];
    a[0] += 10;
    a[1] *= 5;
    a[2] -= 1;
    assert.equal(a, [11, 10, 2]);
  });
});

describe("Ternary operator", func() {
  test("selects a branch", func() {
    assert.equal(5 > 3 ? "big" : "small", "big");
    assert.equal(1 > 3 ? "big" : "small", "small");
  });

  test("branches are expressions", func() {
    var y = 5;
    var x = 10;
    var b = 3;
    assert.equal(y > 2 ? x * 2 : 4 + b, 20);
  });

  test("can be chained", func() {
    func grade(s) { return s >= 90 ? "A" : s >= 80 ? "B" : "C"; }
    assert.equal(grade(95), "A");
    assert.equal(grade(85), "B");
    assert.equal(grade(50), "C");
  });

  test("falsy conditions", func() {
    assert.equal(0 ? 1 : 2, 2);
    assert.equal("" ? 1 : 2, 2);
    assert.equal(nil ? 1 : 2, 2);
    assert.equal(false ? 1 : 2, 2);
  });

  test("empty collections are falsy, non-empty are truthy", func() {
    assert.equal([] ? 1 : 2, 2);
    assert.equal({} ? 1 : 2, 2);
    assert.equal([1] ? 1 : 2, 1);
    assert.equal({ a: 1 } ? 1 : 2, 1);
  });

  test("only the chosen branch is evaluated", func() {
    var calls = 0;
    func side() { calls++; return 1; }
    var r = true ? 10 : side();
    assert.equal(r, 10);
    assert.equal(calls, 0);
  });
});

describe("in operator", func() {
  test("object keys", func() {
    assert.isTrue("a" in { a: 1 });
    assert.isFalse("b" in { a: 1 });
  });
});

finish("operators");
