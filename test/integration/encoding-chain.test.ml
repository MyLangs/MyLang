// ============================================================================
//  Encodings, end to end, across the libraries that produce and consume them.
//
//  Each library has its own tests for its own codec. What those cannot show is whether
//  the codecs agree with each other: whether hex from `crypto` is hex to `binary`, whether
//  text that went out through `json` comes back through `strings` unharmed, whether a
//  value packed by one library and unpacked by another is the same value or merely a
//  similar one.
//
//  Every test here is a round trip with a check at the far end that is stricter than
//  "it did not throw": the digest, the length and the contents all have to agree.
// ============================================================================

import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:fs";
import "core:path";
import "core:os";
import "core:bytes";
import "core:binary";
import "core:crypto";
import "core:compress";
import "core:archive";
import "core:json";
import "core:strings";
import "core:arrays";
import "core:objects";
import "core:uuid";
import "core:net/url";
import "core:validation" as v;
import "core:numbers/bigint";

var dir = path.join(os.tmpdir(), "mylang-integration-encoding");

func freshDir() {
  var utils = fs.FSUtils();

  utils.removeDir(dir);
  utils.ensureDir(dir);
}

// Text that goes wrong the moment something treats bytes as characters.
var awkward = "ASCII, accents: éàü, CJK: 日本語, emoji: 🙂🌍, quotes: \"'`, a tab:\there";

describe("two libraries' idea of the same encoding agree", func() {
  test("hex: crypto and binary produce and accept each other's", func() {
    var value = crypto.randomBytes(48);

    var fromCrypto = crypto.hexEncode(value);
    var fromBinary = binary.hex(value);

    assert.equal(strings.toLowerCase(fromCrypto), strings.toLowerCase(fromBinary));
    assert.isTrue(bytes.equal(crypto.hexDecode(fromBinary), value));
    assert.isTrue(bytes.equal(binary.fromHex(fromCrypto), value));
  });

  test("base64: crypto and bytes produce and accept each other's", func() {
    var value = crypto.randomBytes(48);

    var fromCrypto = crypto.base64Encode(value);
    var fromBytes = bytes.Bytes(value).toString("base64");

    assert.equal(fromCrypto, fromBytes);
    assert.isTrue(bytes.equal(crypto.base64Decode(fromBytes), value));
    assert.isTrue(bytes.equal(bytes.Bytes(fromCrypto, "base64"), value));
  });

  test("utf8: text measured by bytes is text decoded by bytes", func() {
    var value = bytes.Bytes(awkward);

    assert.equal(length(value), bytes.byteLength(awkward));
    assert.greater(length(value), length(awkward)); // multi-byte characters
    assert.equal(value.toString(), awkward);
    assert.equal(value.toString("utf8"), awkward);
  });

  test("a uuid is the same value as text, as hex and as bytes", func() {
    var id = uuid.v4();

    assert.isTrue(uuid.isValid(id));
    assert.equal(uuid.version(id), 4);

    var asBytes = uuid.toBytes(id);

    assert.equal(length(asBytes), 16);
    assert.equal(uuid.fromBytes(asBytes), id);
    assert.equal(uuid.fromHex(uuid.toHex(id)), id);
    assert.equal(strings.toLowerCase(binary.hex(asBytes)), uuid.toHex(id));
    assert.isTrue(uuid.equal(uuid.fromBytes(asBytes), id));
  });

  test("percent-encoding: url and crypto agree on a component", func() {
    var component = "a value/with spaces&signs=🙂";

    var fromUrl = url.encodeURIComponent(component);
    var fromCrypto = crypto.urlEncode(component);

    assert.equal(url.decodeURIComponent(fromUrl), component);
    assert.equal(crypto.urlDecode(fromCrypto), component);
    assert.equal(url.decodeURIComponent(fromCrypto), component);
    assert.equal(crypto.urlDecode(fromUrl), component);
  });
});

describe("awkward text survives every chain", func() {
  beforeEach(freshDir);

  test("json -> disk -> json keeps every character", func() {
    var record = { text: awkward, nested: { again: awkward }, list: [awkward] };
    var file = path.join(dir, "text.json");

    fs.writeFile(file, json.stringify(record));

    var back = json.parse(fs.readFile(file).toString());

    assert.equal(back.text, awkward);
    assert.equal(back.nested.again, awkward);
    assert.equal(back.list[0], awkward);
    assert.equal(length(back.text), length(awkward));
  });

  test("base64 -> gzip -> tar -> disk -> back", func() {
    var encoded = crypto.base64Encode(awkward);
    var packed = compress.gzip(encoded);
    var tarball = archive.tar([{ name: "text.b64.gz", data: packed }]);
    var file = path.join(dir, "text.tar");

    fs.writeFile(file, tarball);

    var entry = archive.untar(fs.readFile(file))[0];
    var unpacked = compress.gunzip(entry.data).toString();

    assert.equal(unpacked, encoded);
    assert.equal(crypto.base64Decode(unpacked).toString(), awkward);
  });

  test("a url carrying the text round trips through json", func() {
    var built = url.format({
      protocol: "https:",
      hostname: "example.com",
      pathname: "/search",
      search: "?q=" + url.encodeURIComponent(awkward)
    });

    // `format` hands back a URL, and `URL` takes one back, so the two compose
    var address = url.URL(built).href();

    // only the text travels through json: a URL is a thing, not a record
    var carried = json.parse(json.stringify({ href: address })).href;
    var parsed = url.URL(carried);

    assert.equal(parsed.href(), address);
    assert.equal(parsed.hostname(), "example.com");
    assert.equal(parsed.pathname(), "/search");
    assert.equal(
      url.decodeURIComponent(strings.replaceAll(parsed.search(), "?q=", "")),
      awkward
    );
  });

  test("text written with binary and read back is the same text", func() {
    var w = binary.writer();

    w.varint(bytes.byteLength(awkward));
    w.string(awkward);

    var built = w.build();
    var r = binary.reader(built);
    var size = r.varint();

    assert.equal(size, bytes.byteLength(awkward));
    assert.equal(r.string(size), awkward);
    assert.equal(r.remaining(), 0);
  });
});

describe("a value through a whole chain comes back identical", func() {
  beforeEach(freshDir);

  test("record -> json -> gzip -> base64 -> disk -> all the way back", func() {
    var record = {
      id: uuid.v4(),
      title: awkward,
      counts: [1, 2, 3, 5, 8, 13],
      flags: { active: true, archived: false },
      ratio: 0.125
    };

    var text = json.stringify(record);
    var packed = compress.gzip(text);
    var encoded = crypto.base64Encode(packed);
    var file = path.join(dir, "record.b64");

    fs.writeFile(file, encoded);

    // and back, one step at a time
    var readBack = fs.readFile(file).toString();
    var decoded = crypto.base64Decode(readBack);
    var unpacked = compress.gunzip(decoded).toString();
    var restored = json.parse(unpacked);

    assert.equal(restored.id, record.id);
    assert.equal(restored.title, awkward);
    assert.equal(restored.counts, record.counts);
    assert.equal(restored.flags.active, true);
    assert.equal(restored.ratio, 0.125);
    assert.equal(json.stringify(restored), text);
  });

  test("encrypted, packed, archived, and all of it undone", func() {
    var secret = strings.repeat("the contents that must not change. ", 200);
    var password = "a password for the test";

    var packed = compress.brotli(secret);
    var sealed = crypto.encrypt(packed, password);
    var bundle = archive.zip([{ name: "sealed.bin", data: sealed }]);
    var file = path.join(dir, "sealed.zip");

    fs.writeFile(file, bundle);

    var entry = archive.unzip(fs.readFile(file))[0];
    var opened = crypto.decrypt(entry.data, password);
    var restored = compress.unbrotli(opened).toString();

    assert.equal(entry.name, "sealed.bin");
    assert.equal(restored, secret);
    assert.equal(crypto.sha256(restored), crypto.sha256(secret));
  });

  test("the wrong password is refused, not quietly wrong", func() {
    var sealed = crypto.encrypt("the contents", "the right password");

    assert.throws(func() { return crypto.decrypt(sealed, "the wrong password"); });
  });

  test("a digest of the chain's ends is the only check that matters", func() {
    var source = crypto.randomBytes(200000);
    var before = crypto.sha256(source);

    var file = path.join(dir, "noise.bin");

    fs.writeFile(file, source);

    compress.file("gzip", file, path.join(dir, "noise.gz"));
    compress.file("gunzip", path.join(dir, "noise.gz"), path.join(dir, "noise.back"));

    assert.equal(crypto.hashFile(path.join(dir, "noise.back"), "sha256"), before);
    assert.equal(crypto.crc32(fs.readFile(path.join(dir, "noise.back"))), crypto.crc32(source));
  });
});

describe("numbers keep their value across the seams", func() {
  test("every width binary writes is the width it reads", func() {
    var w = binary.writer();

    w.u8(255);
    w.i8(-128);
    w.u16(65535);
    w.i16(-32768);
    w.u32(4294967295);
    w.i32(-2147483648);
    w.f32(0.5);
    w.f64(0.1);

    var r = binary.reader(w.build());

    assert.equal(r.u8(), 255);
    assert.equal(r.i8(), -128);
    assert.equal(r.u16(), 65535);
    assert.equal(r.i16(), -32768);
    assert.equal(r.u32(), 4294967295);
    assert.equal(r.i32(), -2147483648);
    assert.closeTo(r.f32(), 0.5, 0.0000001);
    assert.closeTo(r.f64(), 0.1, 0.0000000001);
    assert.isTrue(r.eof());
  });

  test("a bigint written as eight bytes is the same bigint", func() {
    var value = bigint.fromString("9007199254740993");
    var w = binary.writer();

    w.u64(value);

    var back = binary.reader(w.build()).u64();

    assert.equal(bigint.toString(back), "9007199254740993");
    assert.isTrue(bigint.equal(back, value));
  });

  test("json keeps a float a float and an int an int", func() {
    var record = { count: 42, ratio: 1.5, big: 9007199254740991 };
    var back = json.parse(json.stringify(record));

    assert.typeOf(back.count, "int");
    assert.typeOf(back.ratio, "float");
    assert.equal(back.count, 42);
    assert.equal(back.ratio, 1.5);
    assert.equal(back.big, 9007199254740991);
  });

  test("a varint and a fixed width describe the same number", func() {
    for (var n in [0, 1, 127, 128, 16383, 16384, 1000000]) {
      var varint = binary.writer();
      var fixed = binary.writer();

      varint.varint(n);
      fixed.u32(n);

      assert.equal(binary.reader(varint.build()).varint(), n);
      assert.equal(binary.reader(fixed.build()).u32(), n);
      assert.lessOrEqual(length(varint.build()), 5);
    }
  });
});

describe("what comes off the wire is checked before it is believed", func() {
  beforeEach(freshDir);

  test("validation accepts a record that made the whole trip", func() {
    var schema = v.object({
      id: v.string({ min: 36, max: 36 }),
      title: v.string({ min: 1 }),
      counts: v.array(v.integer({ min: 0 })),
      ratio: v.number({ min: 0, max: 1 })
    });

    var record = {
      id: uuid.v4(),
      title: awkward,
      counts: [1, 2, 3],
      ratio: 0.5
    };

    var carried = json.parse(compress.gunzip(compress.gzip(json.stringify(record))).toString());
    var result = v.check(schema, carried);

    assert.isTrue(result.valid);
    assert.lengthOf(result.errors, 0);
    assert.equal(result.value.title, awkward);
  });

  test("validation reports where a damaged record is wrong", func() {
    var schema = v.object({
      id: v.string({ min: 36, max: 36 }),
      counts: v.array(v.integer({ min: 0 }))
    });

    var result = v.check(schema, { id: "too short", counts: [1, -2, 3] });

    assert.isFalse(result.valid);
    assert.greaterOrEqual(length(result.errors), 2);

    var paths = arrays.map(result.errors, func(e) { return e.path; });

    assert.includes(paths, "id");
    assert.includes(paths, "counts[1]");
  });

  test("a truncated archive is reported, not half-read", func() {
    var bundle = archive.zip([{ name: "whole.txt", data: strings.repeat("x", 5000) }]);

    // the end-of-directory record is the last thing in a zip, so losing the tail is the
    // damage a reader is most likely to be handed
    var truncated = bytes.Bytes(bundle).slice(0, length(bundle) - 16);
    var err = assert.throws(func() { return archive.unzip(truncated); });

    assert.includes(err.message, "zip");

    // the whole thing still reads, so the check above is about the damage and not the slice
    assert.lengthOf(archive.unzip(bytes.Bytes(bundle).slice(0, length(bundle))), 1);
  });

  test("a truncated gzip stream is reported", func() {
    var packed = compress.gzip(strings.repeat("compressible ", 2000));
    var truncated = bytes.Bytes(packed).slice(0, 40);

    assert.throws(func() { return compress.gunzip(truncated); });
  });

  test("a binary reader will not read past what arrived", func() {
    var w = binary.writer();

    w.u32(7);

    var partial = bytes.Bytes(w.build()).slice(0, 2);
    var r = binary.reader(partial);

    assert.throws(func() { return r.u32(); });
  });

  test("a digest that does not match says so", func() {
    var payload = crypto.randomBytes(1000);
    var damaged = bytes.ByteArray(payload);

    damaged.set(0, (payload.get(0) + 1) % 256);

    assert.notEqual(crypto.sha256(damaged), crypto.sha256(payload));
    assert.isFalse(crypto.timingSafeEqual(
      crypto.hexDecode(crypto.sha256(damaged)),
      crypto.hexDecode(crypto.sha256(payload))
    ));
  });
});

describe("objects and arrays keep their shape through json", func() {
  test("keys, values and entries agree after a round trip", func() {
    var record = { b: 2, a: 1, c: 3 };
    var back = json.parse(json.stringify(record));

    assert.equal(arrays.sort(objects.keys(back)), ["a", "b", "c"]);
    assert.equal(arrays.sort(objects.values(back)), [1, 2, 3]);
    assert.equal(objects.fromEntries(objects.entries(back)), record);
  });

  test("an empty object and an empty array stay different", func() {
    var back = json.parse(json.stringify({ object: {}, array: [] }));

    assert.typeOf(back.object, "object");
    assert.typeOf(back.array, "array");
    assert.lengthOf(back.array, 0);
    assert.lengthOf(objects.keys(back.object), 0);
  });

  test("nil survives as nil", func() {
    var back = json.parse(json.stringify({ missing: nil, present: 1 }));

    assert.isNil(back.missing);
    assert.equal(back.present, 1);
  });

  test("deep nesting comes back at the same depth", func() {
    var deep = { level: 1, next: { level: 2, next: { level: 3, next: { level: 4 } } } };
    var back = json.parse(json.stringify(deep));

    assert.equal(back.next.next.next.level, 4);
    assert.equal(json.stringify(back), json.stringify(deep));
  });
});

finish("integration: encoding chain");
