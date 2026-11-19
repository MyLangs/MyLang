import "core:test" as { describe, test, assert, finish };

describe("Numbers", func() {
  test("integer literals", func() {
    assert.equal(42, 42);
    assert.equal(0, 0);
    assert.equal(-7, -7);
    assert.typeOf(42, "int");
  });

  test("float literals", func() {
    assert.equal(3.14, 3.14);
    assert.equal(0.5, 0.5);
    assert.typeOf(3.14, "float");
    assert.typeOf(-0.25, "float");
  });

  test("hexadecimal literals", func() {
    assert.equal(0xFF, 255);
    assert.equal(0x10, 16);
  });

  test("binary literals", func() {
    assert.equal(0b101, 5);
    assert.equal(0b1111, 15);
  });

  test("octal literals", func() {
    assert.equal(0o17, 15);
    assert.equal(0o10, 8);
  });

  test("scientific notation", func() {
    assert.equal(1e3, 1000);
    assert.equal(1.5e-3, 0.0015);
    assert.equal(2e0, 2);
  });

  test("underscore digit separators", func() {
    assert.equal(1_000, 1000);
    assert.equal(1_000_000, 1000000);
  });

  test("special numeric values", func() {
    assert.typeOf(1 / 0, "infinity");
    assert.typeOf(0 / 0, "nan");
  });
});

describe("BigInt", func() {
  test("literal has bigint type", func() {
    assert.typeOf(123n, "bigint");
  });

  test("arithmetic stays bigint", func() {
    assert.equal(2n + 3n, 5n);
    assert.equal(6n * 7n, 42n);
    assert.equal(10n - 4n, 6n);
    assert.typeOf(2n * 3n, "bigint");
  });

  test("arbitrary precision", func() {
    assert.equal(9007199254740993n + 1n, 9007199254740994n);
  });
});

describe("Strings", func() {
  test("double and single quotes", func() {
    assert.equal("hello", "hello");
    assert.equal("hello", "hello");
    assert.typeOf("x", "string");
  });

  test("escape sequences", func() {
    assert.equal(length("a\tb"), 3);
    assert.equal(length("a\nb"), 3);
    assert.equal('q"q', 'q"q');
    assert.equal(length("back\\slash"), 10);
  });

  test("unicode and hex escapes", func() {
    assert.equal("\u0041", "A");
    assert.equal("\x41", "A");
  });

  test("concatenation", func() {
    assert.equal("Hello, " + "World!", "Hello, World!");
    assert.equal("a" + "b" + "c", "abc");
  });

  test("concatenation with numbers coerces to text", func() {
    assert.equal("n=" + 5, "n=5");
    assert.equal(1 + 2 + "x", "3x");
    assert.equal("x" + 1 + 2, "x12");
  });

  test("indexing", func() {
    assert.equal("hello"[0], "h");
    assert.equal("hello"[4], "o");
  });

  test("length", func() {
    assert.equal(length("Hello"), 5);
    assert.equal(length(""), 0);
    assert.equal("hello".length, 5);
  });

  test("multi-line text blocks", func() {
    var text = """line1
line2""";
    assert.includes(text, "line1");
    assert.includes(text, "line2");
    assert.equal(length(text), 11);
  });

  test("comparison", func() {
    assert.isTrue("a" < "b");
    assert.isTrue("b" > "a");
    assert.isTrue("abc" == "abc");
    assert.isTrue("a" != "b");
  });
});

describe("String interpolation", func() {
  test("variable", func() {
    var name = "World";
    assert.equal($"Hello, {name}!", "Hello, World!");
  });

  test("expressions", func() {
    assert.equal($"1 + 2 = {1 + 2}", "1 + 2 = 3");
    var a = 4;
    assert.equal($"{a * a}", "16");
  });

  test("multiple placeholders", func() {
    var first = "Ada";
    var last = "Lovelace";
    assert.equal($"{first} {last}", "Ada Lovelace");
  });

  test("member access and calls", func() {
    var user = { name: "Alice", age: 30 };
    func double(n) { return n * 2; }
    assert.equal($"{user.name} is {user.age}", "Alice is 30");
    assert.equal($"twice: {double(21)}", "twice: 42");
  });

  test("ternary inside placeholder", func() {
    var n = 3;
    assert.equal($"{n > 2 ? 'big' : 'small'}", "big");
  });

  test("text without placeholders", func() {
    assert.equal($"plain", "plain");
  });
});

describe("Booleans and nil", func() {
  test("boolean literals", func() {
    assert.isTrue(true);
    assert.isFalse(false);
    assert.typeOf(true, "boolean");
  });

  test("nil literal", func() {
    assert.isNil(nil);
    assert.typeOf(nil, "nil");
  });

  test("uninitialised variable is nil", func() {
    var x;
    assert.isNil(x);
  });
});

describe("Array literals", func() {
  test("basic array", func() {
    var a = [1, 2, 3];
    assert.equal(a, [1, 2, 3]);
    assert.equal(length(a), 3);
    assert.typeOf(a, "array");
  });

  test("empty array", func() {
    assert.equal(length([]), 0);
  });

  test("mixed types", func() {
    var a = [1, "two", true, nil, [3]];
    assert.equal(length(a), 5);
    assert.equal(a[1], "two");
    assert.equal(a[4][0], 3);
  });

  test("trailing comma", func() {
    assert.equal([1, 2, 3,], [1, 2, 3]);
  });

  test("element expressions", func() {
    var x = 10;
    assert.equal([1 + 1, 2 * 2, 3 ** 2, x > 5 ? 100 : 200], [2, 4, 9, 100]);
  });

  test("nested indexing", func() {
    assert.equal([[1, 2], [3, [4, 5]]][1][1][0], 4);
  });
});

describe("Object literals", func() {
  test("basic object", func() {
    var o = { name: "Alice", age: 30 };
    assert.equal(o.name, "Alice");
    assert.equal(o["age"], 30);
    assert.typeOf(o, "object");
  });

  test("empty object", func() {
    assert.equal(length({}), 0);
  });

  test("nested objects", func() {
    var o = { a: { b: { c: 42 } } };
    assert.equal(o.a.b.c, 42);
  });

  test("string keys", func() {
    var o = { "my key": 1, "other-key": 2 };
    assert.equal(o["my key"], 1);
    assert.equal(o["other-key"], 2);
  });

  test("property shorthand", func() {
    var v = 5;
    var w = "x";
    assert.equal({ v, w }, { v: 5, w: "x" });
  });

  test("computed keys", func() {
    var k = "dyn";
    var o = { [k]: 1, [1 + 2]: "c" };
    assert.equal(o.dyn, 1);
    assert.equal(o["3"], "c");
  });

  test("function properties", func() {
    var o = { add: func(a, b) { return a + b; } };
    assert.equal(o.add(2, 3), 5);
  });

  test("method shorthand", func() {
    var o = { n: 3, double() { return this.n * 2; } };
    assert.equal(o.double(), 6);
  });

  test("trailing comma", func() {
    assert.equal({ a: 1, b: 2, }, { a: 1, b: 2 });
  });

  test("length counts keys", func() {
    assert.equal(length({ a: 1, b: 2 }), 2);
  });
});

describe("typeof", func() {
  struct Sample { var a; }
  enum Level { Low, High }
  func plain() {}

  test("primitive types", func() {
    assert.equal(typeof 1, "int");
    assert.equal(typeof 1.5, "float");
    assert.equal(typeof 3n, "bigint");
    assert.equal(typeof "s", "string");
    assert.equal(typeof true, "boolean");
    assert.equal(typeof nil, "nil");
  });

  test("container types", func() {
    assert.equal(typeof [], "array");
    assert.equal(typeof {}, "object");
  });

  test("callable and declared types", func() {
    assert.equal(typeof plain, "function");
    assert.equal(typeof func() {}, "function");
    assert.equal(typeof Sample, "struct");
    assert.equal(typeof Level, "enum");
  });

  test("symbols", func() {
    assert.equal(typeof symbol.iterator, "symbol");
  });
});

describe("length()", func() {
  test("of strings, arrays and objects", func() {
    assert.equal(length("Hello"), 5);
    assert.equal(length([1, 2, 3]), 3);
    assert.equal(length({ a: 1, b: 2 }), 2);
  });

  test("of numbers counts digits", func() {
    assert.equal(length(123.45), 5);
    assert.equal(length(12345n), 5);
  });

  test("of booleans", func() {
    assert.equal(length(true), 1);
    assert.equal(length(false), 1);
  });

  test("of nil is zero", func() {
    assert.equal(length(nil), 0);
  });

  test("of a function is its parameter count", func() {
    assert.equal(length(func(a1, a2) {}), 2);
  });
});

describe("Comments", func() {
  test("line comments are ignored", func() {
    var x = 1; // trailing comment
    assert.equal(x, 1);
  });

  test("block comments are ignored", func() {
    /* a block
       comment */
    var y = 2 /* inline */ + 3;
    assert.equal(y, 5);
  });
});

finish("literals");
