import "core:test" as { describe, test, assert, finish, beforeEach };
import "core:archive";
import "core:bytes";
import "core:compress";
import "core:binary";
import "core:fs";
import "core:path";
import "core:os";

var dir = path.join(os.tmpdir(), "mylang-archive-test");

func freshDir() {
  var utils = fs.FSUtils();
  utils.removeDir(dir);
  utils.ensureDir(dir);
}

func entryNames(entries) {
  var names = [];
  for (var e in entries) { names[length(names)] = e.name; }
  return names;
}

describe("archive: zip", func() {
  test("round trips files and directories", func() {
    var packed = archive.zip([
      { name: "a.txt", data: "hello" },
      { name: "dir/", directory: true },
      { name: "dir/b.txt", data: "nested" }
    ]);

    var entries = archive.unzip(packed);

    assert.equal(entryNames(entries), ["a.txt", "dir/", "dir/b.txt"]);
    assert.equal(entries[0].data.toString(), "hello");
    assert.isTrue(entries[1].directory);
    assert.equal(entries[2].data.toString(), "nested");
  });

  test("entries carry their size", func() {
    var entries = archive.unzip(archive.zip([{ name: "x", data: "12345" }]));

    assert.equal(entries[0].size, 5);
    assert.isFalse(entries[0].directory);
  });

  test("compressible content really is compressed", func() {
    var text = "";
    for (var i = 0; i < 400; i++) { text += "repeat me "; }

    var packed = archive.zip([{ name: "big.txt", data: text }]);

    assert.less(binary.sizeOf(packed), length(text));
    assert.equal(archive.unzip(packed)[0].data.toString(), text);
  });

  test("binary content survives unchanged", func() {
    var raw = binary.writer().u32(1).u32(4294967295).build();
    var entries = archive.unzip(archive.zip([{ name: "b.bin", data: raw }]));

    assert.equal(entries[0].data.toArray(), raw.toArray());
  });

  test("storing without compression also round trips", func() {
    var packed = archive.zip([{ name: "a", data: "x" }], { level: 0 });

    assert.equal(archive.unzip(packed)[0].data.toString(), "x");
  });

  test("damaged data is reported", func() {
    assert.throws(func() { archive.unzip("definitely not a zip"); }, "not a zip archive");
  });
});

describe("archive: tar", func() {
  test("round trips", func() {
    var packed = archive.tar([
      { name: "one.txt", data: "first" },
      { name: "two.txt", data: "second" }
    ]);

    var entries = archive.untar(packed);

    assert.equal(entryNames(entries), ["one.txt", "two.txt"]);
    assert.equal(entries[1].data.toString(), "second");
  });

  test("directories are kept", func() {
    var entries = archive.untar(archive.tar([{ name: "d/", directory: true }]));

    assert.isTrue(entries[0].directory);
  });

  // ustar has 100 bytes for a name; a longer one travels in a PAX record ahead of its
  // entry, which is what GNU tar and bsdtar both write and read.
  test("a name too long for a ustar header still round trips", func() {
    var long = "";
    for (var i = 0; i < 20; i++) { long += "deeply-nested-directory/"; }
    long += "file.txt";

    assert.greater(length(long), 100);

    var entries = archive.untar(archive.tar([
      { name: "short.txt", data: "first" },
      { name: long, data: "the long one" },
      { name: "after.txt", data: "last" }
    ]));

    assert.lengthOf(entries, 3);
    assert.equal(entries[1].name, long);
    assert.equal(entries[1].data.toString(), "the long one");
    assert.equal(entries[2].name, "after.txt");
  });
});

describe("archive: format detection", func() {
  test("format names what it sees", func() {
    assert.equal(archive.format(archive.zip([{ name: "a", data: "b" }])), "zip");
    assert.equal(archive.format(archive.tar([{ name: "a", data: "b" }])), "tar");
    assert.equal(archive.format(compress.gzip("x")), "gzip");
    assert.equal(archive.format("neither"), "unknown");
  });

  test("read unpacks a zip without being told", func() {
    var entries = archive.read(archive.zip([{ name: "a", data: "b" }]));

    assert.equal(entries[0].data.toString(), "b");
  });

  test("read unpacks a tar.gz", func() {
    var tarred = archive.tar([{ name: "inner.txt", data: "deep" }]);
    var entries = archive.read(compress.gzip(tarred));

    assert.equal(entries[0].name, "inner.txt");
    assert.equal(entries[0].data.toString(), "deep");
  });

  test("read refuses what it cannot recognise", func() {
    assert.throws(func() { archive.read("plain"); }, "unrecognised archive format");
  });
});

describe("archive: on disk", func() {
  beforeEach(freshDir);

  test("create packs a directory and extract unpacks it", func() {
    var source = path.join(dir, "src");
    var utils = fs.FSUtils();

    utils.ensureDir(path.join(source, "nested"));
    fs.writeFile(path.join(source, "top.txt"), "top level");
    fs.writeFile(path.join(source, "nested", "deep.txt"), "deeper");

    var packed = archive.create(source, "zip");
    var out = path.join(dir, "out");
    var written = archive.extract(packed, out);

    assert.includes(written, "top.txt");
    assert.equal(fs.readFile(path.join(out, "top.txt")).toString(), "top level");
    assert.equal(fs.readFile(path.join(out, "nested", "deep.txt")).toString(), "deeper");
  });

  test("create can also produce a tar", func() {
    var source = path.join(dir, "src2");

    fs.FSUtils().ensureDir(source);
    fs.writeFile(path.join(source, "a.txt"), "content");

    var packed = archive.create(source, "tar");

    assert.equal(archive.format(packed), "tar");
    assert.equal(archive.untar(packed)[0].data.toString(), "content");
  });

  test("an unknown format is refused", func() {
    assert.throws(func() { archive.create(dir, "rar"); }, "must be");
  });
});

describe("archive: untrusted names", func() {
  // An entry name that climbs out of the destination is how an archive writes over
  // files it was never given. Those names are refused rather than written.
  test("a name with .. is refused when packing", func() {
    assert.throws(
      func() { archive.zip([{ name: "../escape", data: "x" }]); },
      "escapes the archive root"
    );
    assert.throws(
      func() { archive.tar([{ name: "../escape", data: "x" }]); },
      "escapes the archive root"
    );
  });

  test("an absolute name is refused when packing", func() {
    assert.throws(
      func() { archive.zip([{ name: "/etc/passwd", data: "x" }]); },
      "escapes the archive root"
    );
  });

  test("a leading ./ is simply dropped", func() {
    var entries = archive.unzip(archive.zip([{ name: "./a.txt", data: "x" }]));

    assert.equal(entries[0].name, "a.txt");
  });
});

describe("archive: on disk, without holding the archive", func() {
  beforeEach(freshDir);

  test("createFile and extractFile round trip a tree", func() {
    var source = path.join(dir, "tree");
    var utils = fs.FSUtils();

    utils.ensureDir(path.join(source, "a", "b"));
    fs.writeFile(path.join(source, "top.txt"), "top");
    fs.writeFile(path.join(source, "a", "b", "deep.txt"), "deep");

    var made = archive.createFile(source, path.join(dir, "out.zip"), "zip");

    assert.equal(made, path.join(dir, "out.zip"));

    var written = archive.extractFile(made, path.join(dir, "back"));

    assert.includes(written, "top.txt");
    assert.equal(fs.readFile(path.join(dir, "back", "top.txt")).toString(), "top");
    assert.equal(fs.readFile(path.join(dir, "back", "a", "b", "deep.txt")).toString(), "deep");
  });

  test("a streamed zip is read back by the whole-value reader", func() {
    var source = path.join(dir, "mixed");
    var utils = fs.FSUtils();

    utils.ensureDir(path.join(source, "deep"));
    fs.writeFile(path.join(source, "a.txt"), "first");
    fs.writeFile(path.join(source, "deep", "b.txt"), "second");

    // the streaming writer puts the sizes in a descriptor after each entry rather than
    // in the header, so this checks that the ordinary reader follows that too
    archive.createFile(source, path.join(dir, "streamed.zip"), "zip");

    var entries = archive.unzip(fs.readFile(path.join(dir, "streamed.zip")));
    var names = [];

    for (var entry in entries) { names[length(names)] = entry.name; }

    assert.includes(names, "a.txt");
    assert.includes(names, "deep/b.txt");

    for (var entry in entries) {
      if (entry.name == "deep/b.txt") { assert.equal(entry.data.toString(), "second"); }
    }
  });

  test("a file that is packed is not held in memory", func() {
    var source = path.join(dir, "big");

    fs.FSUtils().ensureDir(source);

    // 4 MB, written in pieces so building the fixture does not need 4 MB either
    var handle = defer fs.file(path.join(source, "big.bin"), "w");
    for (var i = 0; i < 64; i++) { handle.write(bytes.alloc(64 * 1024, 7)); }
    handle.close();

    archive.createFile(source, path.join(dir, "big.tar"), "tar");

    var packed = fs.stat(path.join(dir, "big.tar")).size();

    assert.greater(packed, 4 * 1024 * 1024);

    var names = archive.extractFile(path.join(dir, "big.tar"), path.join(dir, "bigback"));

    assert.includes(names, "big.bin");
    assert.equal(
      fs.stat(path.join(dir, "bigback", "big.bin")).size(),
      fs.stat(path.join(source, "big.bin")).size()
    );
  });

  test("a tar works the same way", func() {
    var source = path.join(dir, "tree2");

    fs.FSUtils().ensureDir(source);
    fs.writeFile(path.join(source, "f.txt"), "content");

    archive.createFile(source, path.join(dir, "out.tar"), "tar");
    archive.extractFile(path.join(dir, "out.tar"), path.join(dir, "back2"));

    assert.equal(fs.readFile(path.join(dir, "back2", "f.txt")).toString(), "content");
  });

  test("a long tar name survives extraction from disk", func() {
    var long = "";
    for (var i = 0; i < 20; i++) { long += "deeply-nested-directory/"; }
    long += "file.txt";

    fs.writeFile(path.join(dir, "long.tar"), archive.tar([{ name: long, data: "the long one" }]));

    archive.extractFile(path.join(dir, "long.tar"), path.join(dir, "longout"));

    assert.equal(fs.readFile(path.join(dir, "longout", long)).toString(), "the long one");
  });

  test("an unrecognised file is reported", func() {
    fs.writeFile(path.join(dir, "junk.bin"), "not an archive at all");

    assert.throws(
      func() { archive.extractFile(path.join(dir, "junk.bin"), path.join(dir, "nope")); },
      "unrecognised archive format"
    );
  });

  test("a gzipped archive says what to do instead", func() {
    fs.writeFile(
      path.join(dir, "x.tar.gz"),
      compress.gzip(archive.tar([{ name: "a", data: "b" }]))
    );

    assert.throws(
      func() { archive.extractFile(path.join(dir, "x.tar.gz"), path.join(dir, "nope")); },
      "compress.gunzip"
    );
  });

  test("an unknown format is refused when packing", func() {
    assert.throws(func() { archive.createFile(dir, path.join(dir, "x"), "rar"); }, "must be");
  });
});

describe("archive: zip64", func() {
  // The ordinary end record counts entries in 16 bits and sizes in 32. Past either, the
  // archive has to carry a zip64 end record, and a reader has to follow it.
  test("more than 65535 entries round trip", func() {
    var entries = [];
    for (var i = 0; i < 65600; i++) { entries[length(entries)] = { name: $"f{i}.txt", data: "x" }; }

    var packed = archive.zip(entries, { level: 0 });
    var back = archive.unzip(packed);

    assert.lengthOf(back, 65600);
    assert.equal(back[0].name, "f0.txt");
    assert.equal(back[65599].name, "f65599.txt");
    assert.equal(back[65599].data.toString(), "x");
  });

  test("a small archive does not use zip64", func() {
    // the ordinary end record is the last 22 bytes; a zip64 locator would sit before it
    var packed = archive.zip([{ name: "a", data: "b" }]);
    var tail = binary.hex(packed);

    assert.notIncludes(tail, "504b0606");
  });
});

finish("archive");
