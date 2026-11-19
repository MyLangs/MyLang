import "core:test" as { describe, test, assert, finish };
import "path";
import "os";

var isWindows = os.platform() == "win32";
var sep = isWindows ? "\\" : "/";
var delimiter = isWindows ? ";" : ":";

describe("path: building", func() {
  test("join combines segments with the separator", func() {
    assert.equal(path.join("a", "b", "c"), "a" + sep + "b" + sep + "c");
    assert.equal(path.join("a", "", "b"), "a" + sep + "b");
  });

  test("join resolves . and ..", func() {
    assert.equal(path.join("/a/b", "../c"), sep + "a" + sep + "c");
    assert.equal(path.join("a", ".", "b"), "a" + sep + "b");
  });

  test("resolve builds an absolute path", func() {
    var root = path.parse(path.resolve(".")).root;

    assert.equal(path.resolve("/a/b", "../c"), path.join(root, "a", "c"));
    assert.equal(path.resolve("/x", "y", "z"), path.join(root, "x", "y", "z"));
    assert.equal(path.resolve("/x", "/y"), path.join(root, "y"));
  });

  test("normalize collapses separators and dot segments", func() {
    assert.equal(path.normalize("/a//b/../c/./d"), sep + "a" + sep + "c" + sep + "d");
    assert.equal(path.normalize("a/../.."), "..");
  });

  test("relative", func() {
    assert.equal(path.relative("/a/b/c", "/a/d"), ".." + sep + ".." + sep + "d");
    assert.equal(path.relative("/a", "/a"), "");
    assert.equal(path.relative("/a", "/a/b/c"), "b" + sep + "c");
  });

  test("format builds a path from parts", func() {
    assert.equal(
      path.format({ dir: "/home/user", base: "file.txt" }),
      "/home/user" + sep + "file.txt"
    );

    assert.equal(
      path.format({ root: "/", name: "file", ext: ".txt" }),
      "/file.txt"
    );
  });
});

describe("path: taking apart", func() {
  test("dirname", func() {
    assert.equal(path.dirname("/a/b/c.txt"), "/a/b");
    assert.equal(path.dirname("c.txt"), ".");
    assert.equal(path.dirname("/"), "/");
  });

  test("basename", func() {
    assert.equal(path.basename("/a/b/c.txt"), "c.txt");
    assert.equal(path.basename("/a/b/c.txt", ".txt"), "c");
    assert.equal(path.basename("/a/b/"), "b");
  });

  test("extname", func() {
    assert.equal(path.extname("a/b.txt"), ".txt");
    assert.equal(path.extname("a/b"), "");
    assert.equal(path.extname("a.b.c"), ".c");
    assert.equal(path.extname(".hidden"), "");
  });

  test("parse returns every part", func() {
    var p = path.parse("/home/user/file.txt");

    assert.equal(p.root, "/");
    assert.equal(p.dir, "/home/user");
    assert.equal(p.base, "file.txt");
    assert.equal(p.ext, ".txt");
    assert.equal(p.name, "file");
  });

  test("parse and format are inverse", func() {
    var input = path.join("a", "b", "c.txt");
    assert.equal(path.format(path.parse(input)), input);
  });

  test("isAbsolute", func() {
    assert.isTrue(path.isAbsolute("/a"));
    assert.isFalse(path.isAbsolute("a/b"));
    assert.isFalse(path.isAbsolute(""));
  });
});

describe("path: platform variants", func() {
  test("separator and delimiter constants", func() {
    assert.equal(path.sep, sep);
    assert.equal(path.delimiter, delimiter);
    assert.typeOf(path.sep, "string");
  });

  test("posix uses forward slashes", func() {
    assert.equal(path.posix.join("a", "b"), "a/b");
    assert.equal(path.posix.sep, "/");
    assert.equal(path.posix.basename("/a/b.txt"), "b.txt");
  });

  test("win32 uses backslashes", func() {
    assert.equal(path.win32.join("a", "b"), "a\\b");
    assert.equal(path.win32.sep, "\\");
    assert.equal(path.win32.delimiter, ";");
    assert.equal(path.win32.basename("C:\\a\\b.txt"), "b.txt");
    assert.equal(path.win32.dirname("C:\\a\\b.txt"), "C:\\a");
    assert.equal(path.win32.extname("C:\\a\\b.txt"), ".txt");
  });

  test("toNamespacedPath handles platform paths", func() {
    if (isWindows) {
      assert.equal(
        path.toNamespacedPath("/a/b"),
        path.win32.toNamespacedPath("/a/b")
      );
    } else {
      assert.equal(path.toNamespacedPath("/a/b"), "/a/b");
    }
  });
});

describe("path: validation", func() {
  test("arguments must be strings", func() {
    assert.throws(func() { path.join(5); }, "must be of type string");
    assert.throws(func() { path.dirname(nil); }, "must be of type string");
    assert.throws(func() { path.basename(5); }, "must be of type string");
  });
});

finish("path");
