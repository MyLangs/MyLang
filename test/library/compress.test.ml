import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:compress";
import "core:binary";
import "core:bytes";
import "core:fs";
import "core:path";
import "core:os";

var sample = "";
for (var i = 0; i < 200; i++) { sample += "the quick brown fox jumps over the lazy dog "; }

describe("compress: round trips", func() {
  test("gzip", func() {
    var packed = compress.gzip(sample);

    assert.less(binary.sizeOf(packed), length(sample));
    assert.equal(compress.gunzip(packed).toString(), sample);
  });

  test("deflate", func() {
    assert.equal(compress.inflate(compress.deflate(sample)).toString(), sample);
  });

  test("raw deflate (no zlib header)", func() {
    var raw = compress.deflateRaw(sample);
    var wrapped = compress.deflate(sample);

    assert.less(binary.sizeOf(raw), binary.sizeOf(wrapped));
    assert.equal(compress.inflateRaw(raw).toString(), sample);
  });

  test("brotli", func() {
    assert.equal(compress.unbrotli(compress.brotli(sample)).toString(), sample);
  });

  test("empty input", func() {
    assert.equal(compress.gunzip(compress.gzip("")).toString(), "");
  });

  test("binary input, not only text", func() {
    var raw = binary.writer().u32(1).u32(2).u32(3).build();

    assert.equal(compress.gunzip(compress.gzip(raw)).toArray(), raw.toArray());
  });
});

describe("compress: levels", func() {
  test("a higher level packs at least as well", func() {
    var fast = compress.gzip(sample, { level: 1 });
    var best = compress.gzip(sample, { level: 9 });

    assert.lessOrEqual(binary.sizeOf(best), binary.sizeOf(fast));
  });

  test("an impossible level is refused", func() {
    assert.throws(func() { compress.gzip(sample, { level: 42 }); }, "between 0 and 9");
    assert.throws(func() { compress.brotli(sample, { level: 42 }); }, "between 0 and 11");
  });
});

describe("compress: recognising data", func() {
  test("detect names the format", func() {
    assert.equal(compress.detect(compress.gzip(sample)), "gzip");
    assert.equal(compress.detect(compress.deflate(sample)), "deflate");
    assert.equal(compress.detect("plain text that is not compressed"), "unknown");
  });

  test("decompress unpacks without being told which", func() {
    assert.equal(compress.decompress(compress.gzip(sample)).toString(), sample);
    assert.equal(compress.decompress(compress.deflate(sample)).toString(), sample);
  });

  test("decompress says so when it cannot tell", func() {
    assert.throws(func() { compress.decompress("not compressed"); }, "cannot tell");
  });

  test("corrupted data is reported, not returned", func() {
    assert.throws(func() { compress.gunzip("\u001f\u008bbroken"); });
  });
});

describe("compress: helpers", func() {
  test("ratio reports how much was saved", func() {
    var ratio = compress.ratio(sample, compress.gzip(sample));

    assert.greater(ratio, 0.5);
    assert.lessOrEqual(ratio, 1);
  });

  test("the constants are the usual zlib levels", func() {
    assert.equal(compress.constants.BEST_SPEED, 1);
    assert.equal(compress.constants.BEST_COMPRESSION, 9);
  });
});

describe("compress: fits the rest of the ecosystem", func() {
  test("input may be a string, bytes or a byte array", func() {
    assert.equal(compress.gunzip(compress.gzip("hi")).toString(), "hi");
    assert.equal(compress.gunzip(compress.gzip(bytes.Bytes("hi"))).toString(), "hi");
    assert.equal(compress.gunzip(compress.gzip([104, 105])).toString(), "hi");
  });

  test("output is an ordinary bytes value", func() {
    var packed = compress.gzip("hi");

    assert.typeOf(binary.sizeOf(packed), "int");
    assert.typeOf(packed.toString("hex"), "string");
  });
});

describe("compress: streaming", func() {
  // The whole-buffer functions need the input and the output in memory at once. These
  // do not, which is what makes them usable on a file larger than the memory limit.
  test("a stream packs data that arrives in pieces", func() {
    var packer = defer compress.stream("gzip");

    for (var i = 0; i < 5; i++) { packer.write($"chunk {i} "); }

    var packed = packer.finish();

    assert.equal(
      compress.gunzip(packed).toString(),
      "chunk 0 chunk 1 chunk 2 chunk 3 chunk 4 "
    );
  });

  test("a stream can be read before it is finished", func() {
    var packer = defer compress.stream("gzip");

    packer.write(sample);

    assert.typeOf(packer.buffered(), "int");
    assert.notNil(packer.read());
  });

  test("every transform is available as a stream", func() {
    for (var kind in compress.transforms) {
      var s = compress.stream(kind);
      assert.equal(s.kind, kind);
      s.close();
    }
  });

  test("an unknown transform is refused", func() {
    assert.throws(func() { compress.stream("rot13"); }, "unknown transform");
    assert.throws(func() { compress.file("rot13", "a", "b"); }, "unknown transform");
  });

  test("a closed stream is an error, not silence", func() {
    var packer = compress.stream("gzip");
    packer.close();

    assert.throws(func() { packer.write("x"); }, "already closed");
  });

  test("defer releases a stream", func() {
    func scoped() {
      var packer = defer compress.stream("gzip");
      return packer;
    }

    assert.isTrue(scoped().closed);
  });
});

describe("compress: file to file", func() {
  var dir = path.join(os.tmpdir(), "mylang-compress-test");

  beforeEach(func() {
    var utils = fs.FSUtils();
    utils.removeDir(dir);
    utils.ensureDir(dir);
  });

  test("a file round trips through gzip without being held in memory", func() {
    var source = path.join(dir, "source.txt");
    var packed = path.join(dir, "source.txt.gz");
    var back = path.join(dir, "back.txt");

    fs.writeFile(source, sample);

    var written = compress.file("gzip", source, packed);

    assert.greater(written, 0);
    assert.less(written, length(sample));

    compress.file("gunzip", packed, back);

    assert.equal(fs.readFile(back).toString(), sample);
  });

  test("the deflate family works the same way", func() {
    var source = path.join(dir, "d.txt");
    var packed = path.join(dir, "d.z");
    var back = path.join(dir, "d.back");

    fs.writeFile(source, sample);
    compress.file("deflate", source, packed);
    compress.file("inflate", packed, back);

    assert.equal(fs.readFile(back).toString(), sample);
  });

  test("a missing source is reported", func() {
    assert.throws(
      func() { compress.file("gzip", path.join(dir, "nope.txt"), path.join(dir, "out.gz")); },
      "cannot gzip"
    );
  });
});

finish("compress");
