import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:fs";
import "core:path";
import "core:os";
import "core:json";
import "./cli.ml" as cli;

// `mylang init` and the formatter settings it writes.

var dir = path.join(os.tmpdir(), "mylang-tools-init");

func freshDir() {
  var utils = fs.FSUtils();

  utils.removeDir(dir);
  utils.ensureDir(dir);
}

func config() { return json.parse(fs.readFile(path.join(dir, "mylang.json")).toString()); }

describe("init: formatter settings", func() {
  beforeEach(freshDir);

  test("init -y writes every prettier setting and the format scripts", func() {
    var result = cli.mylang(["init", "-y"], { cwd: dir });

    assert.equal(result.code, 0);

    var written = config();

    assert.equal(written.prettier.indent, 2);
    assert.equal(written.prettier.quote, "double");
    assert.equal(written.prettier.printWidth, 100);
    assert.includes(written.prettier.include, "**/*.ml");
    assert.equal(written.scripts.format, "mylang prettier --write");
    assert.equal(written.scripts["format:check"], "mylang prettier --check");
  });

  test("--no-prettier leaves them out", func() {
    cli.mylang(["init", "-y", "--no-prettier"], { cwd: dir });

    var written = config();

    assert.isFalse("prettier" in written);
    assert.isFalse("format" in written.scripts);
  });

  test("what init wrote is what the formatter reads", func() {
    cli.mylang(["init", "-y"], { cwd: dir });

    var written = config();

    written.prettier.indent = 4;
    fs.writeFile(path.join(dir, "mylang.json"), json.stringify(written));
    fs.writeFile(path.join(dir, "index.ml"), "func f(){\nreturn 1;\n}\n");

    var result = cli.mylang(["prettier", "index.ml"], { cwd: dir });

    assert.equal(result.code, 0);
    assert.equal(result.out, "func f() {\n    return 1;\n}\n");
  });

  test("the scripts init wrote run the formatter", func() {
    cli.mylang(["init", "-y"], { cwd: dir });
    fs.writeFile(path.join(dir, "index.ml"), "var   x=1;\n");

    // `mylang run format` calls `mylang`, which is not on PATH in a test: run what it names
    var check = cli.mylang(["prettier", "--check"], { cwd: dir });
    var write = cli.mylang(["prettier", "--write"], { cwd: dir });

    assert.equal(check.code, 1);
    assert.equal(write.code, 0);
    assert.equal(fs.readFile(path.join(dir, "index.ml")).toString(), "var x = 1;\n");
  });
});

finish("tools: init");
