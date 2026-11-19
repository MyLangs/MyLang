import "core:test" as { describe, test, beforeEach, assert, finish };
import "crypto";
import "binary";
import "bytes";
import "fs";
import "os";
import "path";
import "uuid";
import "strings";

var FOX = "The quick brown fox jumps over the lazy dog";

describe("crypto: hashing", func() {
  test("md5", func() {
    assert.equal(crypto.md5("hello"), "5d41402abc4b2a76b9719d911017c592");
    assert.equal(crypto.md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  });

  test("sha1", func() {
    assert.equal(crypto.sha1("hello"), "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
  });

  test("sha256", func() {
    assert.equal(
      crypto.sha256("hello"),
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
    assert.equal(
      crypto.sha256(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  test("sha384 and sha512", func() {
    assert.equal(
      crypto.sha384("hello"),
      "59e1748777448c69de6b800d7a33bbfb9ff1b463e44354c3553bcdb9c666fa90125a3c79f90397bdf5f6a13de828684f"
    );
    assert.equal(
      crypto.sha512("hello"),
      "9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043"
    );
  });

  test("hash selects the algorithm by name", func() {
    assert.equal(crypto.hash("sha256", "hello"), crypto.sha256("hello"));
    assert.equal(crypto.hash("md5", "hello"), crypto.md5("hello"));
  });

  test("hash can encode the digest differently", func() {
    assert.equal(
      crypto.hash("sha256", "hello", "base64"),
      "LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ="
    );
  });

  test("Bytes values can be hashed", func() {
    assert.equal(crypto.sha256(bytes.Bytes("hello")), crypto.sha256("hello"));
  });

  test("an unknown algorithm is rejected", func() {
    assert.throws(func() { crypto.hash("nope", "x"); }, "Unsupported hash algorithm");
  });

  test("the data must be text or bytes", func() {
    assert.throws(func() { crypto.sha256(5); }, "must be of type buffer or string");
    assert.throws(func() { crypto.md5(nil); }, "must be of type buffer or string");
  });

  test("hashFile hashes the content of a file", func() {
    var f = path.join(os.tmpdir(), "mylang-hashfile-" + uuid.v4() + ".txt");
    fs.writeFile(f, "hello");
    assert.equal(crypto.hashFile(f), crypto.sha256("hello"));
    assert.equal(crypto.hashFile(f, "md5"), crypto.md5("hello"));
    fs.unlink(f);
  });

  test("hashFile of a missing file is an error", func() {
    assert.throws(func() { crypto.hashFile("/definitely/not/here"); }, "File not found");
  });

  test("crc32", func() {
    assert.equal(crypto.crc32("hello"), 907060870);
    assert.equal(crypto.crc32(""), 0);
    assert.equal(crypto.crc32(FOX), 1095738169);
  });
});

describe("crypto: HMAC", func() {
  // the data comes first, then the key
  test("hmacSha256 matches the published vector", func() {
    assert.equal(
      crypto.hmacSha256(FOX, "key"),
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
    );
  });

  test("hmacMd5 matches the published vector", func() {
    assert.equal(crypto.hmacMd5(FOX, "key"), "80070713463e7749b90c2dc24911e275");
  });

  test("hmacSha512 has the right length", func() {
    assert.lengthOf(crypto.hmacSha512("x", "key"), 128);
  });

  test("hmac takes the algorithm first", func() {
    assert.equal(crypto.hmac("sha256", FOX, "key"), crypto.hmacSha256(FOX, "key"));
  });

  test("a different key gives a different tag", func() {
    assert.notEqual(crypto.hmacSha256("data", "key1"), crypto.hmacSha256("data", "key2"));
  });
});

describe("crypto: encodings", func() {
  test("base64", func() {
    assert.equal(crypto.base64Encode("hello"), "aGVsbG8=");
    assert.equal(crypto.base64Decode("aGVsbG8=").toString(), "hello");
    assert.equal(crypto.base64Encode(""), "");
  });

  test("base64 round-trips unicode", func() {
    assert.equal(crypto.base64Decode(crypto.base64Encode("héllo ✓")).toString(), "héllo ✓");
  });

  test("url-safe base64", func() {
    assert.equal(crypto.base64Encode("??>>"), "Pz8+Pg==");
    assert.equal(crypto.base64Encode("??>>", true), "Pz8-Pg");
  });

  test("hex", func() {
    assert.equal(crypto.hexEncode("hello"), "68656c6c6f");
    assert.equal(crypto.hexDecode("68656c6c6f").toString(), "hello");
    assert.equal(crypto.hexDecode(crypto.hexEncode("héllo")).toString(), "héllo");
  });

  test("url encoding", func() {
    assert.equal(crypto.urlEncode("a b&c=d/é"), "a%20b%26c%3Dd%2F%C3%A9");
    assert.equal(crypto.urlDecode("a%20b%26c%3Dd"), "a b&c=d");
    assert.equal(crypto.urlDecode(crypto.urlEncode("x y/é?")), "x y/é?");
  });
});

describe("crypto: randomness", func() {
  test("randomBytes returns Bytes of the requested size", func() {
    var a = crypto.randomBytes(16);
    assert.isTrue(bytes.is(a));
    assert.equal(a.length, 16);
    assert.notEqual(a.toString("hex"), crypto.randomBytes(16).toString("hex"));
  });

  test("randomBytes with an encoding returns text", func() {
    var s = crypto.randomBytes(8, "hex");
    assert.typeOf(s, "string");
    assert.lengthOf(s, 16);
  });

  test("randomBytes needs a positive size", func() {
    assert.throws(func() { crypto.randomBytes(0); }, "must be positive");
  });

  test("randomInt stays inside [min, max)", func() {
    for (var i = 0; i < 200; i++) {
      var r = crypto.randomInt(5, 10);
      assert.isTrue(r >= 5 && r < 10, "value " + r);
    }
    var single = crypto.randomInt(3);
    assert.isTrue(single >= 0 && single < 3);
  });

  test("randomInt rejects an inverted range", func() {
    assert.throws(func() { crypto.randomInt(10, 5); }, "min must be less than max");
  });

  test("randomUUID", func() {
    var u = crypto.randomUUID();
    assert.lengthOf(u, 36);
    assert.equal(u[14], "4");
    assert.notEqual(u, crypto.randomUUID());
  });

  test("randomString", func() {
    var s = crypto.randomString(20);
    assert.typeOf(s, "string");
    assert.lengthOf(s, 20);
    assert.lengthOf(crypto.randomString(8, "abc"), 8);
  });

  test("randomString draws only from the character set", func() {
    var s = crypto.randomString(60, "ab");
    for (var c in s) { assert.includes(["a", "b"], c); }
  });

  test("randomString needs a positive length", func() {
    assert.throws(func() { crypto.randomString(0); }, "must be positive");
  });

  test("randomPassword has the requested length", func() {
    assert.lengthOf(crypto.randomPassword(16), 16);
    assert.lengthOf(crypto.randomPassword(40), 40);
  });

  test("randomPassword honours the character class options", func() {
    var digits = crypto.randomPassword(30, { lowercase: false, uppercase: false, symbols: false });
    for (var c in digits) { assert.isTrue(c >= "0" && c <= "9", "char " + c); }
    var alnum = crypto.randomPassword(40, { symbols: false });
    for (var d in alnum) {
      assert.isTrue(
        (d >= "0" && d <= "9") || (d >= "a" && d <= "z") || (d >= "A" && d <= "Z"),
        "char " + d
      );
    }
  });
});

describe("crypto: symmetric encryption", func() {
  test("aesEncrypt / aesDecrypt round-trip (GCM)", func() {
    var r = crypto.aesEncrypt("secret message", "my-key", { outputFormat: "object" });
    assert.typeOf(r.encrypted, "string");
    assert.typeOf(r.iv, "string");
    assert.typeOf(r.authTag, "string");
    assert.equal(r.algorithm, "aes-256-gcm");
    assert.equal(
      crypto.aesDecrypt(r.encrypted, "my-key", { iv: r.iv, authTag: r.authTag }),
      "secret message"
    );
  });

  test("a fresh random IV is used each time", func() {
    var a = crypto.aesEncrypt("same", "k", { outputFormat: "object" });
    var b = crypto.aesEncrypt("same", "k", { outputFormat: "object" });
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.encrypted, b.encrypted);
  });

  test("an explicit IV makes the output deterministic", func() {
    var iv = "00112233445566778899aabbccddeeff";
    var a = crypto.aesEncrypt("data", "k", { iv: iv });
    var b = crypto.aesEncrypt("data", "k", { iv: iv });
    assert.equal(a, b);
  });

  test("CBC mode needs no auth tag", func() {
    var r = crypto.aesEncrypt(
      "hello world",
      "key",
      { algorithm: "aes-256-cbc", outputFormat: "object" }
    );
    assert.isFalse("authTag" in r);
    assert.equal(
      crypto.aesDecrypt(r.encrypted, "key", { algorithm: "aes-256-cbc", iv: r.iv }),
      "hello world"
    );
  });

  test("other key sizes", func() {
    var r = crypto.aesEncrypt("x", "k", { algorithm: "aes-128-gcm", outputFormat: "object" });
    assert.equal(
      crypto.aesDecrypt(
        r.encrypted,
        "k",
        { algorithm: "aes-128-gcm", iv: r.iv, authTag: r.authTag }
      ),
      "x"
    );
  });

  test("base64 output encoding", func() {
    var r = crypto.aesEncrypt("hello", "k", { encoding: "base64", outputFormat: "object" });
    assert.equal(
      crypto.aesDecrypt(r.encrypted, "k", { encoding: "base64", iv: r.iv, authTag: r.authTag }),
      "hello"
    );
  });

  test("Bytes can be used for the data and the key", func() {
    var r = crypto.aesEncrypt(bytes.Bytes("raw"), bytes.Bytes("k"), { outputFormat: "object" });
    assert.equal(crypto.aesDecrypt(r.encrypted, "k", { iv: r.iv, authTag: r.authTag }), "raw");
  });

  test("a wrong key fails authentication", func() {
    var r = crypto.aesEncrypt("secret", "key1", { outputFormat: "object" });
    assert.throws(
      func() { crypto.aesDecrypt(r.encrypted, "key2", { iv: r.iv, authTag: r.authTag }); },
      "Decryption error"
    );
  });

  test("tampered ciphertext fails authentication", func() {
    var r = crypto.aesEncrypt("secret", "key", { outputFormat: "object" });
    assert.throws(
      func() { crypto.aesDecrypt("00" + r.encrypted, "key", { iv: r.iv, authTag: r.authTag }); },
      "Decryption error"
    );
  });

  test("decryption needs an IV, and GCM needs the auth tag", func() {
    assert.throws(func() { crypto.aesDecrypt("00", "k", {}); }, "IV is required");
    var r = crypto.aesEncrypt("x", "k", { outputFormat: "object" });
    assert.throws(
      func() { crypto.aesDecrypt(r.encrypted, "k", { iv: r.iv }); },
      "Auth tag is required"
    );
  });

  test("encrypt / decrypt with a password", func() {
    var sealed = crypto.encrypt("top secret", "password");
    assert.isTrue(bytes.is(sealed));
    assert.greater(sealed.length, 64);
    assert.equal(crypto.decrypt(sealed, "password").toString(), "top secret");
  });

  test("encrypt can produce encoded text", func() {
    var sealed = crypto.encrypt("top secret", "password", { encoding: "hex" });
    assert.typeOf(sealed, "string");
    assert.equal(crypto.decrypt(sealed, "password", { encoding: "hex" }).toString(), "top secret");
  });

  test("encrypt uses a random salt and IV", func() {
    assert.notEqual(
      crypto.encrypt("x", "p", { encoding: "hex" }),
      crypto.encrypt("x", "p", { encoding: "hex" })
    );
  });

  test("decrypt with the wrong password fails", func() {
    assert.throws(
      func() { crypto.decrypt(crypto.encrypt("x", "right"), "wrong"); },
      "Decryption failed"
    );
  });
});

describe("crypto: key derivation", func() {
  test("pbkdf2 matches the RFC 6070 vectors", func() {
    assert.equal(
      crypto.pbkdf2("password", "salt", 1, 20, "sha1"),
      "0c60c80f961f0e71f3a9b524af6012062fe037a6"
    );
    assert.equal(
      crypto.pbkdf2("password", "salt", 2, 20, "sha1"),
      "ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957"
    );
  });

  test("pbkdf2 output length", func() {
    assert.lengthOf(crypto.pbkdf2("pw", "s", 10, 32), 64);
  });

  test("pbkdf2 can return Bytes", func() {
    var k = crypto.pbkdf2("password", "salt", 1, 20, "sha1", nil);
    assert.isTrue(bytes.is(k));
    assert.equal(k.length, 20);
  });

  test("scrypt is deterministic and sensitive to its input", func() {
    assert.lengthOf(crypto.scrypt("pw", "salt", 16), 32);
    assert.equal(crypto.scrypt("pw", "salt", 16), crypto.scrypt("pw", "salt", 16));
    assert.notEqual(crypto.scrypt("pw", "salt", 16), crypto.scrypt("pw2", "salt", 16));
  });

  test("hkdf matches RFC 5869 test case 1", func() {
    var ikm = bytes.Bytes("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b", "hex");
    var salt = bytes.Bytes("000102030405060708090a0b0c", "hex");
    var info = bytes.Bytes("f0f1f2f3f4f5f6f7f8f9", "hex");
    assert.equal(
      crypto.hkdf("sha256", ikm, salt, info, 42),
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"
    );
  });

  test("hkdf depends on the info string", func() {
    var a = crypto.hkdf("sha256", "input-key", "salt", "info", 32);
    assert.lengthOf(a, 64);
    assert.equal(a, crypto.hkdf("sha256", "input-key", "salt", "info", 32));
    assert.notEqual(a, crypto.hkdf("sha256", "input-key", "salt", "other", 32));
  });

  test("deriveKey returns the key together with its parameters", func() {
    var r = crypto.deriveKey("pw", "salt", { iterations: 10, keyLength: 16 });
    assert.lengthOf(r.key, 32);
    assert.equal(r.iterations, 10);
    assert.equal(r.algorithm, "sha256");
    assert.equal(r.salt, "73616c74");
    assert.equal(crypto.deriveKey("pw", "salt", { iterations: 10, keyLength: 16 }).key, r.key);
  });

  test("deriveKey without a salt generates one", func() {
    var a = crypto.deriveKey("pw", nil, { iterations: 10 });
    var b = crypto.deriveKey("pw", nil, { iterations: 10 });
    assert.lengthOf(a.salt, 64);
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.key, b.key);
  });

  test("validation", func() {
    assert.throws(func() { crypto.pbkdf2("p", "s", 0, 10); }, "must be positive");
    assert.throws(func() { crypto.pbkdf2("p", "s", 10, -1); }, "must be positive");
  });
});

describe("crypto: password hashing", func() {
  test("hashPassword and verifyPassword", func() {
    var h = crypto.hashPassword("secret", { saltRounds: 4 });
    assert.isTrue(crypto.verifyPassword("secret", h));
    assert.isFalse(crypto.verifyPassword("wrong", h));
  });

  test("the stored hash is self-describing", func() {
    var h = crypto.hashPassword("secret", { saltRounds: 4 });
    assert.equal(h[0], "$");
    assert.isTrue(strings.startsWith(h, "$pbkdf2$16$"));
  });

  test("the same password hashes differently each time (random salt)", func() {
    assert.notEqual(
      crypto.hashPassword("s", { saltRounds: 2 }),
      crypto.hashPassword("s", { saltRounds: 2 })
    );
  });

  test("another digest algorithm still verifies", func() {
    var h = crypto.hashPassword("secret", { saltRounds: 3, algorithm: "sha512" });
    assert.isTrue(crypto.verifyPassword("secret", h));
    assert.isFalse(crypto.verifyPassword("nope", h));
  });

  test("malformed hashes are rejected", func() {
    assert.throws(func() { crypto.verifyPassword("x", "not-a-hash"); }, "Invalid hash format");
  });
});

describe("crypto: signatures", func() {
  var pair = crypto.generateKeyPair("rsa", { modulusLength: 1024 });

  test("generateKeyPair returns PEM text", func() {
    assert.typeOf(pair.publicKey, "string");
    assert.includes(pair.publicKey, "BEGIN PUBLIC KEY");
    assert.includes(pair.privateKey, "BEGIN PRIVATE KEY");
  });

  test("sign and verify", func() {
    var sig = crypto.sign("sha256", "message", pair.privateKey);
    assert.typeOf(sig, "string");
    assert.isTrue(crypto.verify("sha256", "message", pair.publicKey, sig));
  });

  test("a different message does not verify", func() {
    var sig = crypto.sign("sha256", "message", pair.privateKey);
    assert.isFalse(crypto.verify("sha256", "tampered", pair.publicKey, sig));
  });

  test("a different key does not verify", func() {
    var other = crypto.generateKeyPair("rsa", { modulusLength: 1024 });
    var sig = crypto.sign("sha256", "message", pair.privateKey);
    assert.isFalse(crypto.verify("sha256", "message", other.publicKey, sig));
  });

  test("base64 signatures", func() {
    var sig = crypto.sign("sha256", "m", pair.privateKey, { encoding: "base64" });
    assert.isTrue(crypto.verify("sha256", "m", pair.publicKey, sig, { encoding: "base64" }));
  });

  test("a signature can be returned as Bytes", func() {
    var sig = crypto.sign("sha256", "m", pair.privateKey, { encoding: nil });
    assert.isTrue(bytes.is(sig));
    assert.isTrue(crypto.verify("sha256", "m", pair.publicKey, sig));
  });

  test("elliptic curve keys use P-256 by default", func() {
    var ec = crypto.generateKeyPair("ec");
    var sig = crypto.sign("sha256", "m", ec.privateKey);
    assert.isTrue(crypto.verify("sha256", "m", ec.publicKey, sig));
  });

  test("a named curve can be chosen", func() {
    var ec = crypto.generateKeyPair("ec", { namedCurve: "secp256k1" });
    assert.typeOf(ec.publicKey, "string");
  });

  test("ed25519 keys", func() {
    var ed = crypto.generateKeyPair("ed25519");
    assert.includes(ed.privateKey, "BEGIN PRIVATE KEY");
  });

  test("an unsupported key type is rejected", func() {
    assert.throws(func() { crypto.generateKeyPair("nope"); }, "Key pair generation error");
  });

  test("signing with a broken key reports an error", func() {
    assert.throws(func() { crypto.sign("sha256", "m", "not a key"); }, "Signing error");
  });
});

describe("crypto: comparison and introspection", func() {
  test("timingSafeEqual", func() {
    assert.isTrue(crypto.timingSafeEqual("abc", "abc"));
    assert.isFalse(crypto.timingSafeEqual("abc", "abd"));
    assert.isFalse(crypto.timingSafeEqual("abc", "ab"));
  });

  test("constantTimeCompare", func() {
    assert.isTrue(crypto.constantTimeCompare("abc", "abc"));
    assert.isFalse(crypto.constantTimeCompare("abc", "abd"));
    assert.isFalse(crypto.constantTimeCompare("a", "ab"));
  });

  test("getHashes, getCiphers and getCurves list what is available", func() {
    assert.includes(crypto.getHashes(), "sha256");
    assert.includes(crypto.getCiphers(), "aes-256-gcm");
    assert.greater(length(crypto.getCurves()), 0);
  });
});

describe("crypto: hashing a file in pieces", func() {
  var dir = path.join(os.tmpdir(), "mylang-crypto-test");

  beforeEach(func() {
    var utils = fs.FSUtils();
    utils.removeDir(dir);
    utils.ensureDir(dir);
  });

  // The reason to hash by path rather than by value is a file too large to hold, so the
  // answer has to match the whole-value form exactly while never reading it all at once.
  test("the digest matches hashing the same bytes directly", func() {
    var file = path.join(dir, "data.bin");
    var content = "";

    for (var i = 0; i < 500; i++) { content += "some repeating content "; }

    fs.writeFile(file, content);

    assert.equal(
      crypto.hashFile(file, "sha256"),
      crypto.hash("sha256", content)
    );
  });

  test("a file larger than one read still hashes correctly", func() {
    var file = path.join(dir, "large.bin");
    var handle = defer fs.file(file, "w");
    var piece = bytes.alloc(64 * 1024, 42);

    // 4 MB: more than one read, so the pieces have to be fed to the hash in order
    for (var i = 0; i < 64; i++) { handle.write(piece); }

    handle.close();

    assert.equal(
      crypto.hashFile(file, "sha256"),
      crypto.hash("sha256", fs.readFile(file))
    );
  });

  test("a missing file is reported", func() {
    assert.throws(
      func() { crypto.hashFile(path.join(dir, "absent.bin"), "sha256"); },
      "File not found"
    );
  });
});

describe("crypto: binary survives every round trip", func() {
  // These decoders used to hand back a UTF-8 string, which destroyed any byte that is not
  // valid UTF-8: five bytes came back as eleven, with each bad byte replaced by U+FFFD.
  // Encrypting a key or an image and decrypting it did not give it back.
  var raw = bytes.Bytes([255, 254, 0, 128, 65]);

  test("base64 gives back exactly what went in", func() {
    var back = crypto.base64Decode(crypto.base64Encode(raw));

    assert.equal(length(back), 5);
    assert.isTrue(bytes.equal(back, raw));
  });

  test("hex gives back exactly what went in", func() {
    var back = crypto.hexDecode(crypto.hexEncode(raw));

    assert.equal(length(back), 5);
    assert.isTrue(bytes.equal(back, raw));
  });

  test("crypto and binary agree on hex", func() {
    assert.isTrue(bytes.equal(
      crypto.hexDecode(binary.hex(raw)),
      binary.fromHex(crypto.hexEncode(raw))
    ));
  });

  test("encryption round-trips arbitrary bytes", func() {
    var sealed = crypto.encrypt(raw, "a-password");
    var back = crypto.decrypt(sealed, "a-password");

    assert.equal(length(back), 5);
    assert.isTrue(bytes.equal(back, raw));
  });

  test("encryption round-trips a whole random block", func() {
    var block = crypto.randomBytes(5000);
    var back = crypto.decrypt(crypto.encrypt(block, "key"), "key");

    assert.equal(length(back), 5000);
    assert.isTrue(bytes.equal(back, block));
  });

  test("text still round-trips, through toString", func() {
    assert.equal(crypto.base64Decode(crypto.base64Encode("héllo ✓")).toString(), "héllo ✓");
    assert.equal(crypto.decrypt(crypto.encrypt("plain text", "k"), "k").toString(), "plain text");
  });
});

finish("crypto");
