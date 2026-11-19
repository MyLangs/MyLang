// ============================================================================
//  Data moving between libraries.
//
//  The unit tests prove each library works on its own. These prove the seams: that a
//  `bytes` value from one library is accepted by the next without conversion, that a
//  round trip through several of them comes back identical, and that the shared binary
//  type really is shared rather than four similar types that happen to look alike.
// ============================================================================

import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:fs";
import "core:path";
import "core:os";
import "core:bytes";
import "core:binary";
import "core:archive";
import "core:compress";
import "core:crypto";
import "core:json";
import "core:arrays";
import "core:strings";

var dir = path.join(os.tmpdir(), "mylang-integration-data");

func freshDir() {
  var utils = fs.FSUtils();

  utils.removeDir(dir);
  utils.ensureDir(dir);
}

describe("bytes is one type, not four look-alikes", func() {
  beforeEach(freshDir);

  test("a value from fs is accepted by compress, crypto and binary", func() {
    var file = path.join(dir, "payload.bin");
    var original = "";

    for (var i = 0; i < 200; i++) { original += "repeating payload "; }

    fs.writeFile(file, original);

    var fromDisk = fs.readFile(file);

    // each of these takes the value the one before it produced, with no conversion
    var packed = compress.gzip(fromDisk);
    var digest = crypto.sha256(packed);
    var reader = binary.reader(packed);

    assert.isTrue(bytes.is(fromDisk));
    assert.isTrue(bytes.is(packed));
    assert.equal(length(digest), 64);
    assert.equal(reader.u8(), 31); // gzip's first magic byte
    assert.equal(compress.gunzip(packed).toString(), original);
  });

  test("a value from crypto is accepted by fs and bytes", func() {
    var random = crypto.randomBytes(64);
    var file = path.join(dir, "random.bin");

    fs.writeFile(file, random);

    var back = fs.readFile(file);

    assert.equal(length(back), 64);
    assert.isTrue(bytes.equal(random, back));
    assert.equal(bytes.compare(random, back), 0);
  });

  test("a value built by binary is accepted by archive", func() {
    var w = binary.writer();

    w.u32(0xdeadbeef);
    w.string("embedded");

    var built = w.build();

    var packed = archive.tar([{ name: "built.bin", data: built }]);
    var entries = archive.untar(packed);

    assert.lengthOf(entries, 1);
    assert.isTrue(bytes.equal(entries[0].data, built));
    assert.equal(binary.reader(entries[0].data).u32(), 0xdeadbeef);
  });

  test("length() agrees with every library's own idea of size", func() {
    var value = crypto.randomBytes(1000);
    var file = path.join(dir, "size.bin");

    fs.writeFile(file, value);

    assert.equal(length(value), 1000);
    assert.equal(value.length, 1000);
    assert.equal(fs.stat(file).size(), 1000);
    assert.equal(binary.sizeOf(value), 1000);
    assert.equal(length(fs.readFile(file)), 1000);
  });
});

describe("round trips through several libraries", func() {
  beforeEach(freshDir);

  // The question is not whether each step works, but whether the composition does.
  test("json -> gzip -> tar -> disk -> back again", func() {
    var record = {
      name: "integration",
      numbers: [1, 2, 3, 4, 5],
      nested: { deep: { value: true } }
    };

    var text = json.stringify(record);
    var packed = compress.gzip(text);
    var tarball = archive.tar([{ name: "record.json.gz", data: packed }]);
    var file = path.join(dir, "bundle.tar");

    fs.writeFile(file, tarball);

    var entries = archive.untar(fs.readFile(file));
    var unpacked = compress.gunzip(entries[0].data);
    var back = json.parse(unpacked.toString());

    assert.equal(back.name, record.name);
    assert.equal(back.nested.deep.value, true);
    assert.lengthOf(back.numbers, 5);
    assert.equal(arrays.reduce(back.numbers, func(a, b) { return a + b; }, 0), 15);
  });

  test("every compression transform survives a tar and a file", func() {
    var payload = "";

    for (var i = 0; i < 100; i++) { payload += "some compressible text "; }

    for (var kind in ["gzip", "deflate", "deflateRaw", "brotli"]) {
      var packed = compress.gzip(payload);

      if (kind == "deflate") { packed = compress.deflate(payload); }
      if (kind == "deflateRaw") { packed = compress.deflateRaw(payload); }
      if (kind == "brotli") { packed = compress.brotli(payload); }

      var tarball = archive.tar([{ name: kind, data: packed }]);
      var file = path.join(dir, kind + ".tar");

      fs.writeFile(file, tarball);

      var entry = archive.untar(fs.readFile(file))[0];

      assert.equal(entry.name, kind);
      assert.isTrue(bytes.equal(entry.data, packed));
    }
  });

  test("a checksum taken before a round trip matches the one after", func() {
    var source = path.join(dir, "src");
    var utils = fs.FSUtils();

    utils.ensureDir(source);

    var digests = {};

    for (var i = 1; i <= 4; i++) {
      var name = $"file{i}.txt";
      var body = $"the contents of file {i}, repeated: " + strings.repeat("x", i * 100);

      fs.writeFile(path.join(source, name), body);
      digests[name] = crypto.sha256(body);
    }

    archive.createFile(source, path.join(dir, "all.tar"), "tar");
    compress.file("gzip", path.join(dir, "all.tar"), path.join(dir, "all.tar.gz"));
    compress.file("gunzip", path.join(dir, "all.tar.gz"), path.join(dir, "back.tar"));

    var restored = archive.extractFile(path.join(dir, "back.tar"), path.join(dir, "out"));

    assert.lengthOf(restored, 4);

    for (var name in restored) {
      var body = fs.readFile(path.join(dir, "out", name));

      assert.equal(crypto.sha256(body), digests[name]);
    }
  });

  test("hashing a file and hashing its contents agree, whatever the path", func() {
    var file = path.join(dir, "agree.bin");
    var body = crypto.randomBytes(300000);

    fs.writeFile(file, body);

    // hashFile reads in pieces; hash takes it whole. The answer must be the same.
    assert.equal(crypto.hashFile(file, "sha256"), crypto.hash("sha256", body));
    assert.equal(crypto.hashFile(file, "md5"), crypto.hash("md5", body));
    assert.equal(crypto.hashFile(file, "sha512"), crypto.hash("sha512", fs.readFile(file)));
  });
});

describe("streaming and whole-value forms produce the same bytes", func() {
  beforeEach(freshDir);

  test("compress.file and compress.gzip agree", func() {
    var body = "";

    for (var i = 0; i < 500; i++) { body += $"line {i} of the log\n"; }

    var source = path.join(dir, "log.txt");
    var streamed = path.join(dir, "streamed.gz");

    fs.writeFile(source, body);
    compress.file("gzip", source, streamed);

    // the packed bytes may differ (different block boundaries), but what comes back cannot
    assert.equal(compress.gunzip(fs.readFile(streamed)).toString(), body);
    assert.equal(compress.gunzip(compress.gzip(body)).toString(), body);
  });

  test("archive.createFile and archive.create hold the same entries", func() {
    var source = path.join(dir, "tree");
    var utils = fs.FSUtils();

    utils.ensureDir(path.join(source, "sub"));
    fs.writeFile(path.join(source, "top.txt"), "top");
    fs.writeFile(path.join(source, "sub", "deep.txt"), "deep");

    var whole = archive.create(source, "tar");

    archive.createFile(source, path.join(dir, "streamed.tar"), "tar");

    var fromWhole = [];
    var fromStream = [];

    for (var entry in archive.untar(whole)) {
      if (!entry.directory) { fromWhole[length(fromWhole)] = entry.name; }
    }

    for (var entry in archive.untar(fs.readFile(path.join(dir, "streamed.tar")))) {
      if (!entry.directory) { fromStream[length(fromStream)] = entry.name; }
    }

    assert.lengthOf(fromStream, length(fromWhole));
    assert.includes(fromStream, "top.txt");
    assert.includes(fromStream, "sub/deep.txt");
  });

  test("a stream fed in pieces equals the whole value packed at once", func() {
    var rows = [];

    for (var i = 0; i < 50; i++) { rows[length(rows)] = $"row {i}"; }

    var joined = arrays.join(rows, "\n");
    var packer = defer compress.stream("gzip");

    for (var pair in rows) { packer.write(pair); }

    // the stream had no separators, so compare against the same text without them
    var streamed = compress.gunzip(packer.finish()).toString();

    assert.equal(streamed, strings.replaceAll(joined, "\n", ""));
  });
});

describe("binary formats across the seams", func() {
  beforeEach(freshDir);

  test("a framed message written by binary is read back from disk", func() {
    var w = binary.writer();
    var names = ["alpha", "beta", "gamma"];

    w.u8(1);
    w.u16(length(names));

    for (var name in names) {
      w.u16(bytes.byteLength(name));
      w.string(name);
    }

    var file = path.join(dir, "frame.bin");

    fs.writeFile(file, w.build());

    var r = binary.reader(fs.readFile(file));

    assert.equal(r.u8(), 1);

    var count = r.u16();

    assert.equal(count, 3);

    var read = [];

    for (var i = 0; i < count; i++) {
      var size = r.u16();

      read[length(read)] = r.string(size);
    }

    assert.equal(arrays.join(read, ","), "alpha,beta,gamma");
    assert.equal(r.remaining(), 0);
    assert.isTrue(r.eof());
  });

  test("hex round trips through crypto and binary alike", func() {
    var value = crypto.randomBytes(32);

    var viaBinary = binary.fromHex(binary.hex(value));
    var viaCrypto = crypto.hexDecode(crypto.hexEncode(value));

    assert.isTrue(bytes.equal(viaBinary, value));
    assert.isTrue(bytes.equal(viaCrypto, value));
    assert.isTrue(bytes.equal(viaBinary, viaCrypto));
  });

  test("a reader refuses to run off the end of a real file", func() {
    var file = path.join(dir, "short.bin");

    fs.writeFile(file, bytes.alloc(4, 1));

    var r = binary.reader(fs.readFile(file));

    r.u32();

    assert.isTrue(r.eof());
    assert.throws(func() { r.u32(); });
  });
});

finish("integration: data");
