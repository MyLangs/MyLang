import "core:test" as { describe, test, assert, finish };
import "uuid";

var SAMPLE_V1 = "123e4567-e89b-12d3-a456-426614174000";
var SAMPLE_V4 = "550e8400-e29b-41d4-a716-446655440000";

describe("uuid: generation", func() {
  test("v4 has the canonical shape", func() {
    var u = uuid.v4();
    assert.typeOf(u, "string");
    assert.lengthOf(u, 36);
    assert.equal(u[8], "-");
    assert.equal(u[13], "-");
    assert.equal(u[18], "-");
    assert.equal(u[23], "-");
    assert.equal(u[14], "4");
    assert.isTrue(uuid.isValid(u));
  });

  test("v4 values are unique", func() {
    var seen = {};
    for (var i = 0; i < 100; i++) { seen[uuid.v4()] = true; }
    assert.equal(length(seen), 100);
  });

  test("generate makes a valid version 4 uuid", func() {
    var u = uuid.generate();
    assert.isTrue(uuid.isValid(u));
    assert.equal(uuid.version(u), 4);
  });

  test("v1 is time based", func() {
    var u = uuid.v1();
    assert.isTrue(uuid.isValid(u));
    assert.equal(uuid.version(u), 1);
    assert.notEqual(uuid.v1(), uuid.v1());
  });

  test("v1 accepts an explicit node", func() {
    var u = uuid.v1("01:23:45:67:89:ab");
    assert.isTrue(uuid.isValid(u));
    assert.includes(u, "0123456789ab");
  });

  test("v3 is deterministic and matches the RFC vector", func() {
    var a = uuid.v3(uuid.namespaceDNS(), "python.org");
    assert.equal(a, "6fa459ea-ee8a-3ca4-894e-db77e160355e");
    assert.equal(uuid.v3(uuid.namespaceDNS(), "python.org"), a);
    assert.equal(uuid.version(a), 3);
  });

  test("v5 is deterministic and matches the RFC vector", func() {
    var a = uuid.v5(uuid.namespaceDNS(), "python.org");
    assert.equal(a, "886313e1-3b8a-5372-9b90-0c9aee199e5d");
    assert.equal(uuid.version(a), 5);
  });

  test("the namespace changes the result", func() {
    assert.notEqual(uuid.v5(uuid.namespaceDNS(), "x"), uuid.v5(uuid.namespaceURL(), "x"));
  });

  test("v3 / v5 reject an invalid namespace", func() {
    assert.throws(func() { uuid.v5("not-a-uuid", "x"); }, "Invalid namespace");
    assert.throws(func() { uuid.v3("not-a-uuid", "x"); }, "Invalid namespace");
  });

  test("batch generates several unique uuids", func() {
    var list = uuid.batch(5);
    assert.lengthOf(list, 5);
    var seen = {};
    for (var u in list) { seen[u] = true; assert.isTrue(uuid.isValid(u)); }
    assert.equal(length(seen), 5);
  });

  test("batch defaults to one and rejects a non-positive count", func() {
    assert.lengthOf(uuid.batch(), 1);
    assert.throws(func() { uuid.batch(0); }, "must be positive");
  });
});

describe("uuid: well-known values", func() {
  test("namespaces", func() {
    assert.equal(uuid.namespaceDNS(), "6ba7b810-9dad-11d1-80b4-00c04fd430c8");
    assert.equal(uuid.namespaceURL(), "6ba7b811-9dad-11d1-80b4-00c04fd430c8");
    assert.equal(uuid.namespaceOID(), "6ba7b812-9dad-11d1-80b4-00c04fd430c8");
    assert.equal(uuid.namespaceX500(), "6ba7b814-9dad-11d1-80b4-00c04fd430c8");
  });

  test("nil uuid", func() {
    assert.equal(uuid.nil(), "00000000-0000-0000-0000-000000000000");
    assert.isTrue(uuid.isNil(uuid.nil()));
    assert.isFalse(uuid.isNil(uuid.v4()));
  });
});

describe("uuid: inspection", func() {
  test("isValid", func() {
    assert.isTrue(uuid.isValid(SAMPLE_V1));
    assert.isTrue(uuid.isValid(SAMPLE_V4));
    assert.isFalse(uuid.isValid("nope"));
    assert.isFalse(uuid.isValid(""));
    assert.isFalse(uuid.isValid("123e4567e89b12d3a456426614174000"));
  });

  test("version reads the version digit", func() {
    assert.equal(uuid.version(SAMPLE_V1), 1);
    assert.equal(uuid.version(SAMPLE_V4), 4);
    assert.equal(uuid.version(uuid.v4()), 4);
  });

  test("version rejects malformed input", func() {
    assert.throws(func() { uuid.version("nope"); }, "Invalid UUID format");
  });

  test("parse exposes the fields", func() {
    var p = uuid.parse(SAMPLE_V1);
    assert.equal(p.hex, "123e4567e89b12d3a456426614174000");
    assert.equal(p.version, 1);
    assert.equal(p.variant, 2);
    assert.equal(p.fields.timeLow, "123e4567");
    assert.equal(p.fields.timeMid, "e89b");
    assert.equal(p.node, "426614174000");
    assert.lengthOf(p.bytes, 16);
  });

  test("getTime works for version 1 only", func() {
    var t = uuid.getTime(uuid.v1());
    assert.typeOf(t, "int");
    assert.greater(t, 0);
    assert.throws(func() { uuid.getTime(uuid.v4()); }, "version 1");
  });

  test("compare orders uuids", func() {
    var a = "123e4567-e89b-12d3-a456-426614174000";
    var b = "123e4567-e89b-12d3-a456-426614174001";
    assert.equal(uuid.compare(a, b), -1);
    assert.equal(uuid.compare(b, a), 1);
    assert.equal(uuid.compare(a, a), 0);
  });

  test("equal ignores case", func() {
    assert.isTrue(uuid.equal("123E4567-E89B-12D3-A456-426614174000", SAMPLE_V1));
    assert.isFalse(uuid.equal(SAMPLE_V1, SAMPLE_V4));
  });
});

describe("uuid: conversion", func() {
  test("toBytes and fromBytes round-trip", func() {
    var bytes = uuid.toBytes(SAMPLE_V1);
    assert.lengthOf(bytes, 16);
    assert.equal(bytes[0], 18);
    assert.equal(uuid.fromBytes(bytes), SAMPLE_V1);
  });

  test("toHex and fromHex round-trip", func() {
    assert.equal(uuid.toHex(SAMPLE_V1), "123e4567e89b12d3a456426614174000");
    assert.equal(uuid.fromHex("123e4567e89b12d3a456426614174000"), SAMPLE_V1);
  });

  test("short and fromShort round-trip", func() {
    var u = uuid.v4();
    var s = uuid.short(u);
    assert.less(length(s), 36);
    assert.greaterOrEqual(length(s), 20);
    assert.equal(uuid.fromShort(s), u);
  });

  test("malformed input is rejected", func() {
    assert.throws(func() { uuid.toBytes("nope"); }, "Invalid UUID format");
    assert.throws(func() { uuid.fromBytes([1, 2, 3]); }, "16 integers");
    assert.throws(func() { uuid.fromHex("xyz"); }, "32 characters");
    assert.throws(func() { uuid.fromShort("!!"); }, "Invalid character");
    assert.throws(func() { uuid.parse(5); }, "must be of type string");
  });
});

finish("uuid");
