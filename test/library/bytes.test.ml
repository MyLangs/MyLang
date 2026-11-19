import "core:test" as { describe, test, assert, finish };
import "bytes";

func text(parts) {
  var out = [];
  for (var p in parts) { out[length(out)] = p.toString(); }
  return out;
}

describe("bytes: creating", func() {
  test("from a string", func() {
    var b = bytes.Bytes("hello");
    assert.equal(b.length, 5);
    assert.equal(b.toString(), "hello");
    assert.typeOf(b, "object");
  });

  test("from an array of byte values", func() {
    var b = bytes.Bytes([104, 105]);
    assert.equal(b.toString(), "hi");
    assert.equal(b.toArray(), [104, 105]);
  });

  test("empty, or a zero-filled buffer of a given size", func() {
    assert.equal(bytes.Bytes().length, 0);
    assert.equal(bytes.Bytes(3).toArray(), [0, 0, 0]);
  });

  test("from encoded text", func() {
    assert.equal(bytes.Bytes("68656c6c6f", "hex").toString(), "hello");
    assert.equal(bytes.Bytes("aGVsbG8=", "base64").toString(), "hello");
  });

  test("a copy of another Bytes is independent", func() {
    var original = bytes.Bytes("hello");
    var copy = bytes.Bytes(original);
    copy.set(0, 72);
    assert.equal(copy.toString(), "Hello");
    assert.equal(original.toString(), "hello");
  });

  test("multi-byte text counts bytes, not characters", func() {
    var b = bytes.Bytes("héllo");
    assert.equal(b.length, 6);
    assert.equal(b.toString(), "héllo");
  });

  test("invalid sources are rejected", func() {
    assert.throws(func() { bytes.Bytes({}); }, "Invalid source type");
    assert.throws(func() { bytes.Bytes(-1); }, "cannot be negative");
    assert.throws(func() { bytes.Bytes("zz", "nope"); }, "Invalid encoding");
  });
});

describe("bytes: reading and writing", func() {
  test("get reads one byte", func() {
    var b = bytes.Bytes("abc");
    assert.equal(b.get(0), 97);
    assert.equal(b.get(2), 99);
  });

  test("get validates the index", func() {
    var b = bytes.Bytes("abc");
    assert.throws(func() { b.get(9); }, "out of bounds");
    assert.throws(func() { b.get(-1); }, "out of bounds");
    assert.throws(func() { b.get("x"); }, "must be of type integer");
  });

  test("set changes a byte in place", func() {
    var b = bytes.Bytes("abc");
    b.set(1, 66);
    assert.equal(b.toString(), "aBc");
  });

  test("set validates index and value", func() {
    var b = bytes.Bytes("abc");
    assert.throws(func() { b.set(5, 1); }, "out of bounds");
    assert.throws(func() { b.set(0, 256); }, "between 0 and 255");
    assert.throws(func() { b.set(0, -1); }, "between 0 and 255");
  });

  test("slice and subarray return the requested range", func() {
    var b = bytes.Bytes("hello");
    assert.equal(b.slice(1, 3).toString(), "el");
    assert.equal(b.slice(2).toString(), "llo");
    assert.equal(b.slice(0, 0).length, 0);
    assert.equal(b.subarray(1, 4).toString(), "ell");
  });

  test("slice leaves the original unchanged", func() {
    var b = bytes.Bytes("hello");
    var part = b.slice(0, 2);
    part.set(0, 72);
    assert.equal(b.toString(), "hello");
  });

  test("toString with an encoding", func() {
    var b = bytes.Bytes("hello");
    assert.equal(b.toString("hex"), "68656c6c6f");
    assert.equal(b.toString("base64"), "aGVsbG8=");
    assert.equal(b.toString("utf8"), "hello");
    assert.equal(b.toString("ascii"), "hello");
    assert.equal(b.decode(), "hello");
  });

  test("toArray and toArrayBuffer", func() {
    var b = bytes.Bytes("hi");
    assert.equal(b.toArray(), [104, 105]);
    assert.typeOf(b.toArrayBuffer(), "object");
  });

  test("a Bytes value can be iterated byte by byte", func() {
    var seen = [];
    for (var v in bytes.Bytes("ab")) { seen[length(seen)] = v; }
    assert.equal(seen, [97, 98]);
  });
});

describe("bytes: searching", func() {
  var b = bytes.Bytes("hello");

  test("indexOf accepts text, a byte value or another Bytes", func() {
    assert.equal(b.indexOf("l"), 2);
    assert.equal(b.indexOf("lo"), 3);
    assert.equal(b.indexOf(108), 2);
    assert.equal(b.indexOf(bytes.Bytes("ll")), 2);
    assert.equal(b.indexOf("z"), -1);
    assert.equal(b.indexOf("l", 3), 3);
  });

  test("lastIndexOf", func() {
    assert.equal(b.lastIndexOf("l"), 3);
    assert.equal(b.lastIndexOf("z"), -1);
  });

  test("includes", func() {
    assert.isTrue(b.includes("ell"));
    assert.isTrue(b.includes(104));
    assert.isFalse(b.includes("zzz"));
  });

  test("startsWith and endsWith", func() {
    assert.isTrue(b.startsWith("he"));
    assert.isTrue(b.startsWith(bytes.Bytes("hel")));
    assert.isFalse(b.startsWith("lo"));
    assert.isTrue(b.endsWith("lo"));
    assert.isFalse(b.endsWith("he"));
  });

  test("invalid search values are rejected", func() {
    assert.throws(func() { b.indexOf([1]); }, "Search value must be");
    assert.throws(func() { b.startsWith(5); }, "Prefix must be");
  });
});

describe("bytes: transforming", func() {
  test("concat appends text, an array or another Bytes", func() {
    var b = bytes.Bytes("hello");
    assert.equal(b.concat(bytes.Bytes(" world")).toString(), "hello world");
    assert.equal(b.concat("!").toString(), "hello!");
    assert.equal(bytes.Bytes([1]).concat([2, 3]).toArray(), [1, 2, 3]);
    assert.equal(b.toString(), "hello");
  });

  test("repeat", func() {
    assert.equal(bytes.Bytes("ab").repeat(3).toString(), "ababab");
    assert.equal(bytes.Bytes("ab").repeat(0).length, 0);
  });

  test("reverse returns a reversed copy", func() {
    var b = bytes.Bytes("abc");
    assert.equal(b.reverse().toString(), "cba");
    assert.equal(b.toString(), "abc");
  });

  test("split by a separator", func() {
    assert.equal(text(bytes.Bytes("a,b,c").split(",")), ["a", "b", "c"]);
    assert.equal(text(bytes.Bytes("a--b--c").split("--")), ["a", "b", "c"]);
  });

  test("copy duplicates the buffer", func() {
    var b = bytes.Bytes([1, 2, 3]);
    var c = b.copy();
    c.set(0, 9);
    assert.equal(b.toArray(), [1, 2, 3]);
    assert.equal(c.toArray(), [9, 2, 3]);
  });

  test("fill returns a filled copy", func() {
    var b = bytes.Bytes(3);
    assert.equal(b.fill(65).toString(), "AAA");
    assert.equal(b.fill("z").toString(), "zzz");
    assert.equal(bytes.Bytes(4).fill(1, 1, 3).toArray(), [0, 1, 1, 0]);
    assert.equal(b.toArray(), [0, 0, 0]);
  });

  test("fill validates its value", func() {
    assert.throws(func() { bytes.Bytes(2).fill(300); }, "between 0 and 255");
    assert.throws(func() { bytes.Bytes(2).fill("ab"); }, "single character");
  });
});

describe("bytes: comparing", func() {
  test("equals compares the content", func() {
    var b = bytes.Bytes("hello");
    assert.isTrue(b.equals(bytes.Bytes("hello")));
    assert.isTrue(b.equals("hello"));
    assert.isFalse(b.equals(bytes.Bytes("hellO")));
    assert.isFalse(b.equals(bytes.Bytes("hell")));
    assert.isFalse(b.equals(5));
  });

  test("compare orders byte by byte", func() {
    assert.equal(bytes.Bytes("a").compare(bytes.Bytes("b")), -1);
    assert.equal(bytes.Bytes("b").compare(bytes.Bytes("a")), 1);
    assert.equal(bytes.Bytes("a").compare(bytes.Bytes("a")), 0);
    assert.equal(bytes.Bytes("a").compare(bytes.Bytes("ab")), -1);
  });

  test("a value is not equal to a modified copy", func() {
    var a = bytes.Bytes("abc");
    var b = a.copy();
    b.set(2, 100);
    assert.isFalse(a.equals(b));
    assert.equal(a.compare(b), -1);
  });
});

describe("bytes: module functions", func() {
  test("is recognises Bytes values", func() {
    assert.isTrue(bytes.is(bytes.Bytes("x")));
    assert.isFalse(bytes.is("x"));
    assert.isFalse(bytes.is(nil));
    assert.isFalse(bytes.is([1, 2]));
  });

  test("alloc", func() {
    assert.equal(bytes.alloc(3).toArray(), [0, 0, 0]);
    assert.equal(bytes.alloc(3, 7).toArray(), [7, 7, 7]);
    assert.equal(bytes.alloc(4, "ab").toString(), "abab");
    assert.equal(bytes.alloc(4, "6162", "hex").toString(), "abab");
    assert.equal(bytes.alloc(0).length, 0);
  });

  test("allocUnsafe and allocUnsafeSlow have the requested size", func() {
    assert.equal(bytes.allocUnsafe(4).length, 4);
    assert.equal(bytes.allocUnsafeSlow(2).length, 2);
  });

  test("alloc rejects a negative size", func() {
    assert.throws(func() { bytes.alloc(-1); });
  });

  test("byteLength of Bytes and of text", func() {
    assert.equal(bytes.byteLength(bytes.Bytes("héllo")), 6);
    assert.equal(bytes.byteLength("héllo"), 6);
    assert.equal(bytes.byteLength("hello"), 5);
  });

  test("compare and equal accept Bytes values", func() {
    assert.equal(bytes.compare(bytes.Bytes("a"), bytes.Bytes("b")), -1);
    assert.equal(bytes.compare(bytes.Bytes("abc"), bytes.Bytes("abd")), -1);
    assert.equal(bytes.compare(bytes.Bytes("b"), bytes.Bytes("a")), 1);
    assert.equal(bytes.compare(bytes.Bytes("a"), bytes.Bytes("a")), 0);
    assert.isTrue(bytes.equal(bytes.Bytes("a"), bytes.Bytes("a")));
    assert.isFalse(bytes.equal(bytes.Bytes("a"), bytes.Bytes("b")));
    assert.isFalse(bytes.equal(bytes.Bytes("a"), bytes.Bytes("ab")));
  });

  test("concat joins a list of Bytes", func() {
    var r = bytes.concat([bytes.Bytes("ab"), bytes.Bytes("cd")]);
    assert.isTrue(bytes.is(r));
    assert.equal(r.toString(), "abcd");
    assert.equal(bytes.concat([bytes.Bytes("ab"), bytes.Bytes("cd")], 3).toString(), "abc");
  });

  test("join puts a separator between the parts", func() {
    assert.equal(
      bytes.join(
        bytes.Bytes("-"),
        [bytes.Bytes("a"), bytes.Bytes("b"), bytes.Bytes("c")]
      ).toString(),
      "a-b-c"
    );
    assert.equal(bytes.join(",", ["x", "y"]).toString(), "x,y");
    assert.equal(bytes.join(",", []).length, 0);
    assert.equal(bytes.join(",", [bytes.Bytes("only")]).toString(), "only");
  });

  test("join rejects unsupported items", func() {
    assert.throws(func() { bytes.join(",", [5]); }, "All items must be");
  });

  test("trim, trimLeft and trimRight", func() {
    var padded = bytes.Bytes("  hi  ");
    assert.equal(bytes.trim(padded).toString(), "hi");
    assert.equal(bytes.trimLeft(padded).toString(), "hi  ");
    assert.equal(bytes.trimRight(padded).toString(), "  hi");
  });

  test("trim with a custom cut set", func() {
    assert.equal(bytes.trim(bytes.Bytes("xxhixx"), "x").toString(), "hi");
    assert.equal(bytes.trim(bytes.Bytes("xxhixx"), bytes.Bytes("x")).toString(), "hi");
    assert.equal(bytes.trimLeft(bytes.Bytes("xxhixx"), "x").toString(), "hixx");
  });

  test("isEncoding", func() {
    assert.isTrue(bytes.isEncoding("utf8"));
    assert.isTrue(bytes.isEncoding("hex"));
    assert.isTrue(bytes.isEncoding("base64"));
    assert.isFalse(bytes.isEncoding("nope"));
  });
});

describe("bytes: ByteArray", func() {
  test("creation", func() {
    assert.equal(bytes.ByteArray().length, 0);
    assert.equal(bytes.ByteArray("hi").length, 2);
    assert.equal(bytes.ByteArray(3).length, 3);
    assert.equal(bytes.ByteArray([1, 2, 3]).length, 3);
    assert.equal(bytes.ByteArray(bytes.Bytes("xyz")).length, 3);
  });

  test("get and set", func() {
    var a = bytes.ByteArray([1, 2, 3]);
    assert.equal(a.get(1), 2);
    a.set(1, 20);
    assert.equal(a.get(1), 20);
  });

  test("append grows the array and updates length", func() {
    var a = bytes.ByteArray([1]);
    a.append(2);
    a.append(3);
    assert.equal(a.length, 3);
    assert.equal(a.get(2), 3);
  });

  test("append validates the item", func() {
    assert.throws(func() { bytes.ByteArray().append(300); }, "between 0 and 255");
    assert.throws(func() { bytes.ByteArray().append("x"); }, "between 0 and 255");
  });

  test("extend accepts arrays, text and Bytes", func() {
    var a = bytes.ByteArray([1]);
    a.extend([2, 3]);
    assert.equal(a.length, 3);
    a.extend("ab");
    assert.equal(a.length, 5);
    a.extend(bytes.Bytes("z"));
    assert.equal(a.length, 6);
    assert.equal(a.get(5), 122);
  });

  test("insert puts an item at a position", func() {
    var a = bytes.ByteArray([1, 3]);
    a.insert(1, 2);
    a.insert(0, 0);
    assert.equal(a.length, 4);
    assert.equal([a.get(0), a.get(1), a.get(2), a.get(3)], [0, 1, 2, 3]);
  });

  test("pop removes and returns an item", func() {
    var a = bytes.ByteArray([1, 2, 3]);
    assert.equal(a.pop(), 3);
    assert.equal(a.pop(0), 1);
    assert.equal(a.length, 1);
    assert.equal(a.get(0), 2);
  });

  test("pop on an empty array is an error", func() {
    assert.throws(func() { bytes.ByteArray().pop(); }, "empty bytearray");
  });

  test("remove deletes the first matching value", func() {
    var a = bytes.ByteArray([1, 2, 1]);
    a.remove(1);
    assert.equal(a.length, 2);
    assert.equal(a.get(0), 2);
    assert.throws(func() { bytes.ByteArray([1]).remove(9); }, "not in bytearray");
  });

  test("clear empties the array", func() {
    var a = bytes.ByteArray([1, 2]);
    a.clear();
    assert.equal(a.length, 0);
    a.append(7);
    assert.equal(a.length, 1);
  });

  test("a ByteArray can be used where Bytes are expected", func() {
    var a = bytes.ByteArray([104, 105]);
    a.append(33);
    assert.equal(bytes.byteLength(a), 3);
    assert.isTrue(bytes.is(a));
    assert.equal(bytes.concat([a, bytes.Bytes("?")]).toString(), "hi!?");
  });

  test("index validation", func() {
    assert.throws(func() { bytes.ByteArray([1]).get(5); }, "out of bounds");
  });
});

describe("bytes: the global length function", func() {
  // Every library that returns binary hands back one of these, and `length(data)` is the
  // obvious way to ask how big it is - it must answer in bytes, not in members.
  test("length() counts bytes, like the length member", func() {
    var b = bytes.Bytes("hello bytes");

    assert.equal(length(b), 11);
    assert.equal(length(b), b.length);
  });

  test("an empty value is zero, not its member count", func() {
    assert.equal(length(bytes.alloc(0)), 0);
  });

  test("a large value is counted exactly", func() {
    assert.equal(length(bytes.alloc(100000)), 100000);
  });
});

finish("bytes");
