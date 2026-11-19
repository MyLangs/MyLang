import "core:test" as { describe, test, assert, finish };
import "json";

describe("json.parse", func() {
  test("objects, arrays and nested values", func() {
    var v = json.parse('{"a":1,"b":[1,2,{"c":null}],"d":"x","e":true}');
    assert.equal(v.a, 1);
    assert.equal(v.b[1], 2);
    assert.isNil(v.b[2].c);
    assert.equal(v.d, "x");
    assert.isTrue(v.e);
  });

  test("primitives", func() {
    assert.equal(json.parse("42"), 42);
    assert.equal(json.parse("1.5"), 1.5);
    assert.equal(json.parse('"s"'), "s");
    assert.equal(json.parse("true"), true);
    assert.isNil(json.parse("null"));
    assert.equal(json.parse("[1,2]"), [1, 2]);
  });

  test("whitespace is ignored", func() {
    assert.equal(json.parse('  { "a" :  [ 1 , 2 ] }  '), { a: [1, 2] });
  });

  test("invalid JSON raises a parse error", func() {
    assert.throws(func() { json.parse("{bad"); }, "JSON Parse Error");
    assert.throws(func() { json.parse(""); }, "JSON Parse Error");
    assert.throws(func() { json.parse("[1,"); }, "JSON Parse Error");
  });

  test("the input must be a string", func() {
    assert.throws(func() { json.parse(5); }, "must be of type string");
    assert.throws(func() { json.parse(nil); }, "must be of type string");
  });

  test("a reviver can transform values", func() {
    var v = json.parse('{"a":1,"b":2}', func(k, val) {
      return typeof val == "int" ? val * 10 : val;
    });
    assert.equal(v, { a: 10, b: 20 });
  });

  test("a reviver is called children first, ending with the root", func() {
    var keys = [];
    json.parse('{"a":{"b":1},"c":2}', func(k, val) {
      keys[length(keys)] = k;
      return val;
    });
    assert.equal(keys, ["b", "a", "c", ""]);
  });

  test("a reviver sees array elements too", func() {
    var v = json.parse("[1,2,3]", func(k, val) {
      return typeof val == "int" ? val + 1 : val;
    });
    assert.equal(v, [2, 3, 4]);
  });

  test("the reviver must be a function", func() {
    assert.throws(func() { json.parse("1", 5); }, "must be of type func");
  });
});

describe("json.stringify", func() {
  test("objects and arrays", func() {
    assert.equal(
      json.stringify({ a: 1, b: [1, 2], c: { d: "x" }, e: nil, f: true }),
      '{"a":1,"b":[1,2],"c":{"d":"x"},"e":null,"f":true}'
    );
  });

  test("primitives", func() {
    assert.equal(json.stringify(1), "1");
    assert.equal(json.stringify("s"), '"s"');
    assert.equal(json.stringify(true), "true");
    assert.equal(json.stringify(nil), "null");
    assert.equal(json.stringify([1, "a"]), '[1,"a"]');
    assert.equal(json.stringify([]), "[]");
    assert.equal(json.stringify({}), "{}");
  });

  test("special characters are escaped", func() {
    assert.equal(json.stringify('a"b\nc'), '"a\\"b\\nc"');
  });

  test("non-finite numbers become null", func() {
    assert.equal(json.stringify([0 / 0, 1 / 0]), "[null,null]");
  });

  test("a numeric indent pretty-prints", func() {
    assert.equal(json.stringify({ a: 1 }, nil, 2), '{\n  "a": 1\n}');
    assert.equal(json.stringify([1, 2], nil, 2), "[\n  1,\n  2\n]");
  });

  test("a string indent is used as the indentation", func() {
    assert.equal(json.stringify({ a: 1 }, nil, "--"), '{\n--"a": 1\n}');
  });

  test("an array replacer selects keys", func() {
    assert.equal(json.stringify({ a: 1, b: 2, c: 3 }, ["a", "c"]), '{"a":1,"c":3}');
  });

  test("a function replacer can change values", func() {
    var r = json.stringify({ a: 1, b: 2 }, func(k, v) {
      return typeof v == "int" ? v * 2 : v;
    });
    assert.equal(r, '{"a":2,"b":4}');
  });

  test("a function replacer receives every key, root first", func() {
    var keys = [];
    json.stringify({ a: { b: 1 }, c: [5] }, func(k, v) {
      keys[length(keys)] = k;
      return v;
    });
    assert.equal(keys, ["", "a", "b", "c", "0"]);
  });

  test("a replacer returning nil writes null", func() {
    var r = json.stringify({ a: 1, b: 2 }, func(k, v) { return k == "a" ? nil : v; });
    assert.equal(r, '{"a":null,"b":2}');
  });

  test("functions are skipped like in JSON", func() {
    assert.equal(json.stringify({ f: func() {}, a: 1 }), '{"a":1}');
    assert.equal(json.stringify({ a: [func() {}, 1] }), '{"a":[null,1]}');
  });

  test("struct instances serialise their data fields", func() {
    struct Point { var x; var y; func len() { return 1; } }
    var parsed = json.parse(json.stringify(Point(1, 2)));
    assert.equal(parsed.x, 1);
    assert.equal(parsed.y, 2);
    assert.equal(length(parsed), 2);
  });

  test("circular structures are rejected", func() {
    var o = {};
    o.self = o;
    assert.throws(func() { json.stringify(o); }, "circular");
  });

  test("bigint values are rejected", func() {
    assert.throws(func() { json.stringify({ a: 5n }); }, "BigInt");
  });

  test("parse(stringify(x)) round-trips", func() {
    var data = { a: [1, { b: "c" }], d: nil, e: true, f: 1.5, g: "text" };
    assert.equal(json.parse(json.stringify(data)), data);
  });
});

finish("json");
