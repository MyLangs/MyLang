import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:fs";
import "core:path";
import "core:os";
import "./cli.ml" as cli;

var dir = path.join(os.tmpdir(), "mylang-prettier-ignore-test");

func freshDir() {
  fs.FSUtils().removeDir(dir);
  fs.FSUtils().ensureDir(dir);
}

func put(name, source) {
  var file = path.join(dir, name);
  fs.FSUtils().ensureDir(path.dirname(file));
  fs.writeFile(file, source);
  return file;
}

func read(name) {
  return fs.readFile(path.join(dir, name)).toString();
}

describe("prettier: ignore directives", func() {
  beforeEach(freshDir);

  test("whole-file ignore preserves whitespace and CRLF in --write", func() {
    var source = "\r\n    // @mylang/prettier-ignore\r\nvar    x= [1,2 ,3];\r\n";
    put("ignore.ml", source);

    var result = cli.mylang(["prettier", "--write", ".", "--no-config"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(read("ignore.ml"), source);
    assert.includes(result.err, "ignore.ml: file ignored");
    assert.includes(result.out, "0 of 1 file formatted");
  });

  test("ignored file passes --check", func() {
    put("ignore.ml", "  // @mylang/prettier-ignore\nvar    x= 1;\n");
    var result = cli.mylang(["prettier", "--check", ".", "--no-config"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.includes(result.err, "ignore.ml: file ignored");
    assert.includes(result.out, "All matched files use MyLang style!");
  });

  test("single-line ignore preserves exactly the next physical line", func() {
    put(
      "lines.ml",
      "var   a=1;\n// @mylang/prettier-ignore-next-line\n  var   b =  2 ;\nvar c= 3;\n"
    );
    var result = cli.mylang(["prettier", "--write", ".", "--no-config"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(
      read("lines.ml"),
      "var a = 1;\n// @mylang/prettier-ignore-next-line\n  var   b =  2 ;\nvar c = 3;\n"
    );
    assert.includes(result.err, "lines.ml:3: line ignored");
  });

  test("block ignore leaves all lines between markers intact", func() {
    put(
      "block.ml",
      "// @mylang/prettier-ignore-start\n var   a=1;\n  var b= 2;\n// @mylang/prettier-ignore-end\nvar c=3;\n"
    );
    var result = cli.mylang(["prettier", "--write", ".", "--no-config"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(
      read("block.ml"),
      "// @mylang/prettier-ignore-start\n var   a=1;\n  var b= 2;\n// @mylang/prettier-ignore-end\nvar c = 3;\n"
    );
    assert.includes(result.err, "block.ml:1-4: block ignored");
  });

  test("--list-different keeps ignored messages out of stdout", func() {
    put("ignored.ml", "// @mylang/prettier-ignore\nvar  a=1;\n");
    put("different.ml", "var  b=2;\n");
    var result = cli.mylang(["prettier", "-l", ".", "--no-config"], { cwd: dir });
    assert.equal(result.code, 1);
    assert.equal(result.out, "different.ml\n");
    assert.includes(result.err, "ignored.ml: file ignored");
  });

  test("an ignore-next-line marker never ignores the entire file", func() {
    put("partial.ml", "// @mylang/prettier-ignore-next-line\nvar  a=1;\nvar  b= 2;\n");
    var result = cli.mylang(["prettier", "--write", ".", "--no-config"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(
      read("partial.ml"),
      "// @mylang/prettier-ignore-next-line\nvar  a=1;\nvar b = 2;\n"
    );
    assert.includes(result.err, "partial.ml:2: line ignored");
  });
});

finish("tools: prettier ignore");
