import "core:test" as { describe, test, assert, beforeEach, afterEach, finish };
import "fs";
import "os";
import "path";
import "time";
import "uuid";
import "strings"
import "core:coreio";

// Every test works in its own scratch directory under the system temp dir.
var root = path.join(os.tmpdir(), "mylang-test-fs-" + uuid.v4());
var dir = "";

func freshDir() {
  dir = path.join(root, uuid.v4());
  fs.makedir(dir, { recursive: true });
}

func cleanup() {
  fs.removedir(root, { recursive: true, force: true });
}

// Poll until `check()` is truthy (callbacks run asynchronously).
func waitUntil(check) {
  for (var i = 0; i < 100; i++) {
    if (check()) { return true; }
    time.Sleep(10);
  }
  return false;
}

describe("fs: files", func() {
  beforeEach(freshDir);

  test("writeFile and readFile round-trip text", func() {
    var f = path.join(dir, "a.txt");
    assert.isNil(fs.writeFile(f, "hello\nworld"));
    var data = fs.readFile(f);
    assert.equal(data.length, 11);
    assert.equal(data.toString(), "hello\nworld");
  });

  test("writeFile replaces existing content", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "long content");
    fs.writeFile(f, "short");
    assert.equal(fs.readFile(f).toString(), "short");
  });

  test("writeFile accepts a bytes buffer", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "copy me");
    var data = fs.readFile(f);
    var g = path.join(dir, "b.txt");
    fs.writeFile(g, data);
    assert.equal(fs.readFile(g).toString(), "copy me");
  });

  test("writeFile rejects unsupported data", func() {
    var f = path.join(dir, "a.txt");
    assert.throws(func() { fs.writeFile(f, 5); }, "must be of type buffer, bytes or string");
    assert.throws(func() { fs.writeFile(f, true); }, "must be of type buffer, bytes or string");
  });

  // Binary data is converted by the shared kernel, so every library takes the same
  // inputs: a string, a `bytes` value, a buffer, or an array of byte values.
  test("writeFile accepts an array of byte values", func() {
    var f = path.join(dir, "bytes.txt");
    fs.writeFile(f, [104, 105]);
    assert.equal(fs.readFile(f).toString(), "hi");
  });

  test("appendFile adds to the end", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "one");
    fs.appendFile(f, "-two");
    fs.appendFile(f, "-three");
    assert.equal(fs.readFile(f).toString(), "one-two-three");
  });

  test("appendFile creates a missing file", func() {
    var f = path.join(dir, "new.txt");
    fs.appendFile(f, "x");
    assert.equal(fs.readFile(f).toString(), "x");
  });

  test("readFile of a missing file fails with ENOENT", func() {
    assert.throws(func() { fs.readFile(path.join(dir, "missing.txt")); }, "ENOENT");
  });

  test("empty files and unicode content", func() {
    var f = path.join(dir, "u.txt");
    fs.writeFile(f, "");
    assert.equal(fs.readFile(f).length, 0);
    fs.writeFile(f, "héllo wörld ✓");
    assert.equal(fs.readFile(f).toString(), "héllo wörld ✓");
  });

  test("copyFile", func() {
    var a = path.join(dir, "a.txt");
    var b = path.join(dir, "b.txt");
    fs.writeFile(a, "payload");
    fs.copyFile(a, b);
    assert.equal(fs.readFile(b).toString(), "payload");
    assert.isTrue(fs.exists(a));
  });

  test("copyFile with COPYFILE_EXCL refuses to overwrite", func() {
    var a = path.join(dir, "a.txt");
    var b = path.join(dir, "b.txt");
    fs.writeFile(a, "new");
    fs.writeFile(b, "old");
    assert.throws(func() { fs.copyFile(a, b, fs.constants.COPYFILE_EXCL); }, "EEXIST");
    assert.equal(fs.readFile(b).toString(), "old");
  });

  test("rename moves a file", func() {
    var a = path.join(dir, "a.txt");
    var b = path.join(dir, "b.txt");
    fs.writeFile(a, "x");
    fs.rename(a, b);
    assert.isFalse(fs.exists(a));
    assert.isTrue(fs.exists(b));
  });

  test("unlink deletes a file and fails when it is gone", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "x");
    fs.unlink(f);
    assert.isFalse(fs.exists(f));
    assert.throws(func() { fs.unlink(f); }, "ENOENT");
  });

  test("truncate to a length", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "hello world");
    fs.truncate(f, 5);
    assert.equal(fs.readFile(f).toString(), "hello");
  });

  test("truncate without a length empties the file", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "hello");
    fs.truncate(f);
    assert.equal(fs.readFile(f).length, 0);
  });
});

describe("fs: directories", func() {
  beforeEach(freshDir);

  test("makedir creates a directory", func() {
    var d = path.join(dir, "sub");
    fs.makedir(d);
    assert.isTrue(fs.stat(d).isDirectory());
  });

  test("makedir fails when the parent is missing", func() {
    assert.throws(func() { fs.makedir(path.join(dir, "a/b/c")); }, "ENOENT");
  });

  test("makedir with recursive creates the whole path", func() {
    var deep = path.join(dir, "a/b/c");
    fs.makedir(deep, { recursive: true });
    assert.isTrue(fs.exists(deep));
  });

  test("makedir of an existing directory fails", func() {
    assert.throws(func() { fs.makedir(dir); }, "EEXIST");
  });

  test("readdir lists entries", func() {
    fs.writeFile(path.join(dir, "b.txt"), "");
    fs.writeFile(path.join(dir, "a.txt"), "");
    fs.makedir(path.join(dir, "sub"));
    var names = fs.readdir(dir);
    assert.lengthOf(names, 3);
    assert.includes(names, "a.txt");
    assert.includes(names, "b.txt");
    assert.includes(names, "sub");
  });

  test("readdir of an empty directory", func() {
    assert.equal(fs.readdir(dir), []);
  });

  test("readdir of a missing directory fails", func() {
    assert.throws(func() { fs.readdir(path.join(dir, "nope")); }, "ENOENT");
  });

  test("removedir with recursive deletes a whole tree", func() {
    var tree = path.join(dir, "tree");
    fs.makedir(path.join(tree, "a/b"), { recursive: true });
    fs.writeFile(path.join(tree, "a/b/file.txt"), "x");
    fs.removedir(tree, { recursive: true });
    assert.isFalse(fs.exists(tree));
  });

  test("removedir with force ignores a missing path", func() {
    assert.doesNotThrow(func() { fs.removedir(path.join(dir, "nope"), { force: true }); });
  });

  test("removedir without options refuses a non-empty directory", func() {
    var tree = path.join(dir, "tree");
    fs.makedir(tree);
    fs.writeFile(path.join(tree, "f"), "x");
    assert.throws(func() { fs.removedir(tree); });
    assert.isTrue(fs.exists(tree));
  });
});

describe("fs: inspection", func() {
  beforeEach(freshDir);

  test("exists", func() {
    var f = path.join(dir, "a.txt");
    assert.isFalse(fs.exists(f));
    fs.writeFile(f, "x");
    assert.isTrue(fs.exists(f));
    assert.isTrue(fs.exists(dir));
  });

  test("stat describes a file", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "12345");
    var s = fs.stat(f);
    assert.isTrue(s.isFile());
    assert.isFalse(s.isDirectory());
    assert.isFalse(s.isSymbolicLink());
    assert.equal(s.size(), 5);
  });

  test("stat describes a directory", func() {
    var s = fs.stat(dir);
    assert.isTrue(s.isDirectory());
    assert.isFalse(s.isFile());
  });

  test("stat exposes times, mode and owners", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "x");
    var s = fs.stat(f);
    assert.typeOf(s.mode(), "int");
    assert.typeOf(s.uid(), "int");
    assert.typeOf(s.gid(), "int");
    assert.typeOf(s.mtime(), "object");
    assert.typeOf(s.ctime(), "object");
    assert.typeOf(s.atime(), "object");
    assert.typeOf(s.birthtime(), "object");
  });

  test("stat of a missing path fails", func() {
    assert.throws(func() { fs.stat(path.join(dir, "nope")); }, "ENOENT");
  });

  test("lstat", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "x");
    assert.isTrue(fs.lstat(f).isFile());
  });

  test("access succeeds for an existing file and fails for a missing one", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "x");
    assert.isNil(fs.access(f));
    assert.isNil(fs.access(f, fs.constants.R_OK));
    assert.throws(func() { fs.access(path.join(dir, "nope")); }, "ENOENT");
  });

  test("access constants", func() {
    assert.equal(fs.constants.F_OK, 0);
    assert.equal(fs.constants.R_OK, 4);
    assert.equal(fs.constants.W_OK, 2);
    assert.equal(fs.constants.X_OK, 1);
    assert.typeOf(fs.constants.COPYFILE_EXCL, "int");
  });

  test("chmod changes the permission bits", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "x");

    if (os.platform() == "win32") {
      fs.chmod(f, 0o444);
      assert.equal(fs.stat(f).mode() & 0o200, 0);

      fs.chmod(f, 0o666);
      assert.equal(fs.stat(f).mode() & 0o200, 0o200);
    } else {
      fs.chmod(f, 0o600);
      assert.equal(fs.stat(f).mode() % 512, 0o600);

      fs.chmod(f, 0o644);
      assert.equal(fs.stat(f).mode() % 512, 0o644);
    }
  });
});

describe("fs: links", func() {
  beforeEach(freshDir);

  test("symlink, readlink, realpath and lstat", func() {
    var target = path.join(dir, "target.txt");
    var link = path.join(dir, "link");

    fs.writeFile(target, "x");

    try {
      fs.symlink(target, link, "file");
    } catch (e) {
      if (os.platform() == "win32" && e.code == "EPERM") {
        return;
      }
      throw e;
    }

    assert.equal(fs.readlink(link), target);
    assert.isTrue(fs.lstat(link).isSymbolicLink());
    assert.isTrue(fs.stat(link).isFile());
    assert.equal(fs.realpath(link), fs.realpath(target));
  });

  test("reading through a symlink", func() {
    var target = path.join(dir, "target.txt");
    var link = path.join(dir, "link");
    fs.writeFile(target, "through");

    try {
      fs.symlink(target, link);
    } catch (e) {
      if (os.platform() == "win32" && e.code == "EPERM") {
        return;
      }
      throw e;
    }

    assert.equal(fs.readFile(link).toString(), "through");
  });
});

describe("fs: file descriptors", func() {
  beforeEach(freshDir);

  test("open, write and close", func() {
    var f = path.join(dir, "fd.txt");
    var fd = fs.open(f, "w");
    assert.typeOf(fd, "int");
    assert.equal(fs.write(fd, "abc"), 3);
    fs.close(fd);
    assert.equal(fs.readFile(f).toString(), "abc");
  });

  test("open for reading a missing file fails", func() {
    assert.throws(func() { fs.open(path.join(dir, "nope"), "r"); }, "ENOENT");
  });

  test("fstat reports the size of an open file", func() {
    var f = path.join(dir, "fd.txt");
    fs.writeFile(f, "12345678");
    var fd = fs.open(f, "r");
    assert.equal(fs.FStat(fd).size(), 8);
    fs.close(fd);
  });

  test("close needs a numeric descriptor", func() {
    assert.throws(func() { fs.close("x"); }, "must be of type");
  });
});

describe("fs: callback style", func() {
  beforeEach(freshDir);

  test("readFile with a callback", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "async");
    var got = [];
    fs.readFile(f, func(err, data) { got[length(got)] = [err, data.toString()]; });
    assert.isTrue(waitUntil(func() { return length(got) > 0; }));
    assert.equal(got[0], [nil, "async"]);
  });

  test("readFile with a callback reports errors", func() {
    var errors = [];
    fs.readFile(path.join(dir, "nope"), func(err) { errors[length(errors)] = err != nil; });
    assert.isTrue(waitUntil(func() { return length(errors) > 0; }));
    assert.isTrue(errors[0]);
  });

  test("writeFile with a callback", func() {
    var f = path.join(dir, "a.txt");
    var done = [];
    fs.writeFile(f, "cb", func(err) { done[length(done)] = err; });
    assert.isTrue(waitUntil(func() { return length(done) > 0; }));
    assert.isNil(done[0]);
    assert.equal(fs.readFile(f).toString(), "cb");
  });

  test("exists with a callback", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "x");
    var seen = [];
    fs.exists(f, func(ok) { seen[length(seen)] = ok; });
    assert.isTrue(waitUntil(func() { return length(seen) > 0; }));
    assert.isTrue(seen[0]);
  });

  test("readdir with a callback", func() {
    fs.writeFile(path.join(dir, "x.txt"), "");
    var names = [];
    fs.readdir(dir, func(err, files) { names = files; });
    assert.isTrue(waitUntil(func() { return length(names) > 0; }));
    assert.equal(names, ["x.txt"]);
  });

  test("stat with a callback", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "abc");
    var sizes = [];
    fs.stat(f, func(err, st) { sizes[length(sizes)] = st.size(); });
    assert.isTrue(waitUntil(func() { return length(sizes) > 0; }));
    assert.equal(sizes[0], 3);
  });

  test("options and a callback together", func() {
    var tree = path.join(dir, "x/y");
    var done = [];
    fs.makedir(tree, { recursive: true }, func(err, made) { done[length(done)] = err; });
    assert.isTrue(waitUntil(func() { return length(done) > 0; }));
    assert.isNil(done[0]);
    assert.isTrue(fs.exists(tree));
  });
});

describe("fs: FSUtils", func() {
  beforeEach(freshDir);
  var utils = fs.FSUtils();

  test("ensureDir creates nested directories and is idempotent", func() {
    var d = path.join(dir, "x/y/z");
    utils.ensureDir(d);
    utils.ensureDir(d);
    assert.isTrue(fs.stat(d).isDirectory());
  });

  test("copyDir copies a tree", func() {
    var src = path.join(dir, "src");
    fs.makedir(path.join(src, "sub"), { recursive: true });
    fs.writeFile(path.join(src, "a.txt"), "A");
    fs.writeFile(path.join(src, "sub/b.txt"), "BB");
    var dst = path.join(dir, "copy");
    utils.copyDir(src, dst);
    assert.equal(fs.readFile(path.join(dst, "a.txt")).toString(), "A");
    assert.equal(fs.readFile(path.join(dst, "sub/b.txt")).toString(), "BB");
    assert.isTrue(fs.exists(path.join(src, "a.txt")));
  });

  test("move relocates a tree", func() {
    var src = path.join(dir, "src");
    fs.makedir(src);
    fs.writeFile(path.join(src, "a.txt"), "A");
    var dst = path.join(dir, "dst");
    utils.move(src, dst);
    assert.isFalse(fs.exists(src));
    assert.equal(fs.readFile(path.join(dst, "a.txt")).toString(), "A");
  });

  test("removeDir deletes recursively and ignores missing paths", func() {
    var d = path.join(dir, "tree/deep");
    fs.makedir(d, { recursive: true });
    utils.removeDir(path.join(dir, "tree"));
    assert.isFalse(fs.exists(path.join(dir, "tree")));
    assert.doesNotThrow(func() { utils.removeDir(path.join(dir, "never-existed")); });
  });

  test("getSize", func() {
    var f = path.join(dir, "a.txt");
    fs.writeFile(f, "12345");
    assert.equal(utils.getSize(f), 5);
    assert.throws(func() { utils.getSize(path.join(dir, "nope")); }, "ENOENT");
  });

  test("isEmpty", func() {
    var empty = path.join(dir, "empty");
    fs.makedir(empty);
    var full = path.join(dir, "full");
    fs.makedir(full);
    fs.writeFile(path.join(full, "f"), "");
    assert.isTrue(utils.isEmpty(empty));
    assert.isFalse(utils.isEmpty(full));
    assert.isFalse(utils.isEmpty(path.join(full, "f")));
    assert.isFalse(utils.isEmpty(path.join(dir, "nope")));
  });

  test("createTemp creates an empty file with the given prefix and suffix", func() {
    var t = utils.createTemp("pre-", ".log", dir);
    assert.isTrue(fs.exists(t));
    assert.equal(path.dirname(t), dir);
    assert.isTrue(strings.startsWith(path.basename(t), "pre-"));
    assert.equal(path.extname(t), ".log");
    assert.equal(fs.readFile(t).length, 0);
  });

  test("walk visits every entry with its stats", func() {
    var root = path.join(dir, "d");

    fs.makedir(path.join(root, "sub"), { recursive: true });
    fs.writeFile(path.join(root, "a.txt"), "A");
    fs.writeFile(path.join(root, "sub", "b.txt"), "BB");

    var seen = [];

    utils.walk(root, func(full, st) {
      seen[length(seen)] = path.relative(root, full)
        +(st.isDirectory() ? path.sep : "");
    });

    assert.equal(seen, [
      "a.txt",
      "sub" + path.sep,
      path.join("sub", "b.txt")
    ]);
  });

  test("walk with shallow does not descend", func() {
    fs.makedir(path.join(dir, "d/sub"), { recursive: true });
    fs.writeFile(path.join(dir, "d/sub/b.txt"), "BB");
    var seen = [];
    utils.walk(
      path.join(dir, "d"),
      func(full, st) { seen[length(seen)] = path.basename(full); },
      { shallow: true }
    );
    assert.equal(seen, ["sub"]);
  });

  test("walk stops descending when the callback returns false", func() {
    fs.makedir(path.join(dir, "d/sub"), { recursive: true });
    fs.writeFile(path.join(dir, "d/sub/b.txt"), "BB");
    var seen = [];
    utils.walk(path.join(dir, "d"), func(full, st) {
      seen[length(seen)] = path.basename(full);
      if (st.isDirectory()) { return false; }
    });
    assert.equal(seen, ["sub"]);
  });

  test("walk needs a function", func() {
    assert.throws(func() { utils.walk(dir, 5); }, "must be of type function");
  });
});

describe("fs: watching", func() {
  beforeEach(freshDir);

  test("a watcher reports changes through its listener", func() {
    var f = path.join(dir, "w.txt");
    fs.writeFile(f, "a");
    var events = [];
    var watcher = fs.Watcher(f, func(type, name) { events[length(events)] = type; });
    time.Sleep(30);
    fs.appendFile(f, "b");
    var seen = waitUntil(func() { return length(events) > 0; });
    watcher.close();
    assert.isTrue(seen);
    assert.equal(events[0], "change");
  });

  test("on('change') receives the changed file name", func() {
    var names = [];
    var watcher = fs.Watcher(dir, { recursive: false });
    watcher.on("change", func(type, name) { names[length(names)] = name; });
    time.Sleep(30);
    fs.writeFile(path.join(dir, "new.txt"), "x");
    var seen = waitUntil(func() { return length(names) > 0; });
    watcher.close();
    assert.isTrue(seen);
    assert.includes(names, "new.txt");
  });

  test("watching a missing path fails", func() {
    assert.throws(func() { fs.Watcher(path.join(dir, "nope")); }, "ENOENT");
  });
});

describe("fs: argument validation", func() {
  test("paths must be strings", func() {
    assert.throws(func() { fs.readFile(5); }, "must be of type string");
    assert.throws(func() { fs.exists(nil); }, "must be of type string");
    assert.throws(func() { fs.readdir(5); }, "must be of type string");
    assert.throws(func() { fs.rename("a", 5); }, "must be of type string");
  });
});

cleanup();

finish("fs");
