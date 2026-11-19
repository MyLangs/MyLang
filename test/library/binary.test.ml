import "core:test" as { describe, test, assert, finish };
import "core:binary";
import "core:bytes";

describe("binary: writing and reading round trip", func() {
  test("fixed-width integers", func() {
    var w = binary.writer();
    w.u8(255);
    w.i8(-128);
    w.u16(65535);
    w.i16(-32768);
    w.u32(4294967295);
    w.i32(-2147483648);

    var r = binary.reader(w.build());

    assert.equal(r.u8(), 255);
    assert.equal(r.i8(), -128);
    assert.equal(r.u16(), 65535);
    assert.equal(r.i16(), -32768);
    assert.equal(r.u32(), 4294967295);
    assert.equal(r.i32(), -2147483648);
    assert.isTrue(r.eof());
  });

  test("floating point values", func() {
    var w = binary.writer();
    w.f32(0.5);
    w.f64(3.141592653589793);

    var r = binary.reader(w.build());

    assert.closeTo(r.f32(), 0.5, 0.0001);
    assert.closeTo(r.f64(), 3.141592653589793, 0.000000000001);
  });

  test("64-bit integers travel as bigint", func() {
    var w = binary.writer();
    w.u64(1234567890123n);
    w.i64(-42n);

    var r = binary.reader(w.build());

    assert.equal(r.u64(), 1234567890123n);
    assert.equal(r.i64(), -42n);
  });

  test("strings and raw bytes", func() {
    var w = binary.writer();
    w.string("MLNG");
    w.bytes([1, 2, 3]);

    var r = binary.reader(w.build());

    assert.equal(r.string(4), "MLNG");
    assert.equal(r.bytes(3).toArray(), [1, 2, 3]);
  });

  test("varints encode small numbers compactly", func() {
    var w = binary.writer();
    w.varint(0);
    w.varint(127);
    w.varint(128);
    w.varint(300);
    w.varint(1000000);

    var packed = w.build();
    assert.equal(packed.length, 1 + 1 + 2 + 2 + 3);

    var r = binary.reader(packed);
    assert.equal(r.varint(), 0);
    assert.equal(r.varint(), 127);
    assert.equal(r.varint(), 128);
    assert.equal(r.varint(), 300);
    assert.equal(r.varint(), 1000000);
  });
});

describe("binary: endianness", func() {
  test("big-endian is the default", func() {
    assert.equal(binary.hex(binary.writer().u32(1).build()), "00000001");
  });

  test("little-endian can be asked for", func() {
    assert.equal(binary.hex(binary.writer("le").u32(1).build()), "01000000");
  });

  test("a reader must use the same endianness as the writer", func() {
    var packed = binary.writer("le").u16(513).build();

    assert.equal(binary.reader(packed, "le").u16(), 513);
    assert.notEqual(binary.reader(packed, "be").u16(), 513);
  });

  test("an unknown endianness is refused", func() {
    assert.throws(func() { binary.writer("middle"); }, "must be");
  });
});

describe("binary: the cursor", func() {
  var data = binary.writer().u8(1).u8(2).u8(3).u8(4).build();

  test("position and remaining track the cursor", func() {
    var r = binary.reader(data);

    assert.equal(r.position(), 0);
    assert.equal(r.remaining(), 4);

    r.u16();

    assert.equal(r.position(), 2);
    assert.equal(r.remaining(), 2);
  });

  test("seek and skip move it", func() {
    var r = binary.reader(data);

    r.skip(2);
    assert.equal(r.u8(), 3);

    r.seek(0);
    assert.equal(r.u8(), 1);
  });

  test("reading past the end is an error, not silence", func() {
    var r = binary.reader(data);

    r.skip(4);
    assert.throws(func() { r.u8(); }, "read past the end");
  });

  test("seeking out of range is refused", func() {
    var r = binary.reader(data);

    assert.throws(func() { r.seek(99); }, "out of range");
  });

  test("bytes() and string() without a count take the rest", func() {
    var r = binary.reader(data);

    r.u8();
    assert.equal(r.bytes().length, 3);
  });
});

describe("binary: helpers", func() {
  test("hex round trip", func() {
    assert.equal(binary.hex(binary.fromHex("0a0b0c")), "0a0b0c");
  });

  test("fromHex refuses malformed text", func() {
    assert.throws(func() { binary.fromHex("abc"); }, "even-length");
    assert.throws(func() { binary.fromHex("zz"); }, "hexadecimal");
  });

  test("sizeOf measures any binary value", func() {
    assert.equal(binary.sizeOf("abc"), 3);
    assert.equal(binary.sizeOf([1, 2]), 2);
    assert.equal(binary.sizeOf(bytes.Bytes("hello")), 5);
  });

  test("concat joins chunks", func() {
    var joined = binary.concat(["ab", [99], bytes.Bytes("d")]);

    assert.equal(joined.toString(), "abcd");
  });
});

describe("binary: works with the rest of the ecosystem", func() {
  test("a writer's output is an ordinary bytes value", func() {
    var packed = binary.writer().string("hi").build();

    assert.equal(packed.toString(), "hi");
    assert.equal(bytes.byteLength(packed), 2);
  });

  test("a reader accepts anything binary", func() {
    assert.equal(binary.reader("abc").string(3), "abc");
    assert.equal(binary.reader([104, 105]).string(2), "hi");
    assert.equal(binary.reader(bytes.Bytes("xy")).string(2), "xy");
  });
});

finish("binary");
