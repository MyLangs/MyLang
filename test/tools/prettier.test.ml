import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:fs";
import "core:path";
import "core:os";
import "core:strings";
import "core:json";
import "core:process";
import "./cli.ml" as cli;

// `mylang prettier`, run as a user runs it.

var fixtures = path.resolve("test", "fixtures", "prettier");
var dir = path.join(os.tmpdir(), "mylang-tools-prettier");

func freshDir() {
  var utils = fs.FSUtils();

  utils.removeDir(dir);
  utils.ensureDir(dir);
}

func put(name, text) {
  var file = path.join(dir, name);

  fs.FSUtils().ensureDir(path.dirname(file));
  fs.writeFile(file, text);

  return file;
}

func read(name) { return fs.readFile(path.join(dir, name)).toString(); }

func project(settings) {
  put("mylang.json", json.stringify({ name: "fmt-test", prettier: settings }));
}

var messy = fs.readFile(path.join(fixtures, "messy.ml")).toString();
var expected = fs.readFile(path.join(fixtures, "messy.expected.ml")).toString();

describe("prettier: what it writes", func() {
  beforeEach(freshDir);

  test("a messy file comes out in the expected layout", func() {
    put("messy.ml", messy);

    var result = cli.mylang(["prettier", "messy.ml", "--no-config"], { cwd: dir });

    assert.equal(result.code, 0);
    assert.equal(result.out, expected);
  });

  test("formatting what is formatted changes nothing", func() {
    put("done.ml", expected);

    var result = cli.mylang(["prettier", "done.ml", "--no-config"], { cwd: dir });

    assert.equal(result.out, expected);
  });

  test("the formatted program does exactly what the original did", func() {
    put("before.ml", messy);
    put("after.ml", expected);

    var before = cli.mylang(["run", "before.ml"], { cwd: dir });
    var after = cli.mylang(["run", "after.ml"], { cwd: dir });

    assert.equal(before.code, 0);
    assert.equal(after.out, before.out);
  });

  test("--verify proves the tokens are unchanged", func() {
    put("messy.ml", messy);

    var result = cli.mylang(["prettier", "messy.ml", "--verify", "--no-config"], { cwd: dir });

    assert.equal(result.code, 0);
    assert.equal(result.err, "");
  });

  test("standard input to standard output", func() {
    var result = cli.mylang(["prettier", "--stdin", "--no-config"], { input: "var   x=[1,2 ,3];" });

    assert.equal(result.code, 0);
    assert.equal(result.out, "var x = [1, 2, 3];\n");
  });

  test("strings: the cheaper quote wins, the value never changes", func() {
    var result = cli.mylang(
      ["prettier", "--stdin", "--no-config"],
      { input: "var a = 'plain';\nvar b = 'say \"hi\"';\nvar c = \"it's\";\n" }
    );

    assert.equal(result.out, 'var a = "plain";\nvar b = \'say "hi"\';\nvar c = "it\'s";\n');
  });

  test("triple-quoted and interpolated strings are left exactly as written", func() {
    var source = 'var t = """\n   keep   this\n""";\nvar i = $"a {1 +2} b";\n';
    var result = cli.mylang(["prettier", "--stdin", "--no-config"], { input: source });

    assert.equal(result.out, source);
  });

  test("a long call is broken at its commas", func() {
    var source = 'assert.equal(crypto.sha256("hello"), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");\n';
    var result = cli.mylang(["prettier", "--stdin", "--no-config"], { input: source });

    assert.equal(
      result.out,
      'assert.equal(\n  crypto.sha256("hello"),\n  "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"\n);\n'
    );
  });

  test("blank lines: none at the top or inside a block's edges, at most one in a row", func() {
    var result = cli.mylang(
      ["prettier", "--stdin", "--no-config"],
      { input: "\n\nfunc f() {\n\n  return 1;\n\n}\n\n\n\nvar x = 1;\n\n" }
    );

    assert.equal(result.out, "func f() {\n  return 1;\n}\n\nvar x = 1;\n");
  });
});

describe("prettier: modes", func() {
  beforeEach(freshDir);

  test("--check fails on an unformatted file and names it", func() {
    put("messy.ml", messy);
    put("clean.ml", expected);

    var result = cli.mylang(["prettier", "--check", "."], { cwd: dir });

    assert.equal(result.code, 1);
    assert.includes(result.out, "messy.ml");
    assert.notIncludes(result.out, "clean.ml");
  });

  test("--check passes once everything is formatted", func() {
    put("clean.ml", expected);

    var result = cli.mylang(["prettier", "--check", "."], { cwd: dir });

    assert.equal(result.code, 0);
    assert.includes(result.out, "All matched files use MyLang style!");
  });

  test("--list-different prints only the names", func() {
    put("a.ml", messy);
    put("b.ml", expected);

    var result = cli.mylang(["prettier", "-l", "."], { cwd: dir });

    assert.equal(result.code, 1);
    assert.equal(strings.trim(result.out), "a.ml");
  });

  test("--write rewrites in place and leaves formatted files alone", func() {
    put("a.ml", messy);
    put("b.ml", expected);

    var result = cli.mylang(["prettier", "--write", "."], { cwd: dir });

    assert.equal(result.code, 0);
    assert.equal(read("a.ml"), expected);
    assert.equal(read("b.ml"), expected);
    assert.includes(result.out, "1 of 2 files formatted");
    assert.equal(cli.mylang(["prettier", "--check", "."], { cwd: dir }).code, 0);
  });

  test("--write leaves no temporary files behind", func() {
    put("a.ml", messy);

    cli.mylang(["prettier", "--write", "."], { cwd: dir });

    assert.equal(fs.readdir(dir), ["a.ml"]);
  });

  test("the modes cannot be combined", func() {
    put("a.ml", expected);

    var result = cli.mylang(["prettier", "--write", "--check", "a.ml"], { cwd: dir });

    assert.equal(result.code, 2);
  });

  test("the fmt alias is the same command", func() {
    put("a.ml", messy);

    assert.equal(cli.mylang(["fmt", "a.ml", "--no-config"], { cwd: dir }).out, expected);
  });
});

describe("prettier: which files", func() {
  beforeEach(freshDir);

  test("a directory contributes its .ml files, recursively", func() {
    put("top.ml", messy);
    put("sub/deep/inner.ml", messy);
    put("notes.txt", "var   x=1;");

    var result = cli.mylang(["prettier", "-l", "."], { cwd: dir });

    assert.includes(result.out, "top.ml");
    assert.includes(result.out, "sub/deep/inner.ml");
    assert.notIncludes(result.out, "notes.txt");
  });

  test("the default ignore list skips installed modules", func() {
    put("app.ml", messy);
    put("node_modules/dep/x.ml", messy);
    put(".mylang/cache/y.ml", messy);

    var result = cli.mylang(["prettier", "-l", "."], { cwd: dir });

    assert.equal(strings.trim(result.out), "app.ml");
  });

  test("ignore and include come from mylang.json", func() {
    project({ ignore: ["generated/**"], include: ["**/*.ml", "**/*.mylang"] });
    put("a.ml", messy);
    put("b.mylang", messy);
    put("generated/c.ml", messy);

    var result = cli.mylang(["prettier", "-l", "."], { cwd: dir });

    assert.includes(result.out, "a.ml");
    assert.includes(result.out, "b.mylang");
    assert.notIncludes(result.out, "generated");
  });

  test("a glob selects files", func() {
    put("keep/a.ml", messy);
    put("other/b.ml", messy);

    var result = cli.mylang(["prettier", "-l", "keep/*.ml"], { cwd: dir });

    assert.equal(strings.trim(result.out), "keep/a.ml");
  });

  test("a missing path is an error", func() {
    var result = cli.mylang(["prettier", "nope.ml"], { cwd: dir });

    assert.equal(result.code, 2);
    assert.includes(result.err, "no such file");
  });
});

describe("prettier: settings", func() {
  beforeEach(freshDir);

  test("mylang.json settings are used", func() {
    project({ indent: 4, quote: "single", bracketSpacing: false });
    put("a.ml", 'func f(){\nreturn {a:"x"};\n}\n');

    var result = cli.mylang(["prettier", "a.ml"], { cwd: dir });

    assert.equal(result.out, "func f() {\n    return {a: 'x'};\n}\n");
  });

  test("a flag beats the config file", func() {
    project({ indent: 4 });
    put("a.ml", "func f(){\nreturn 1;\n}\n");

    var result = cli.mylang(["prettier", "a.ml", "--indent", "3"], { cwd: dir });

    assert.equal(result.out, "func f() {\n   return 1;\n}\n");
  });

  test("tabs, crlf and no final newline", func() {
    var result = cli.mylang(
      [
        "prettier",
        "--stdin",
        "--no-config",
        "--use-tabs",
        "--end-of-line",
        "crlf",
        "--no-final-newline"
      ],
      { input: "func f(){\nreturn 1;\n}\n" }
    );

    assert.equal(result.out, "func f() {\r\n\treturn 1;\r\n}");
  });

  test("--config reads settings from another file", func() {
    put("style.json", json.stringify({ indent: 8 }));
    put("a.ml", "func f(){\nreturn 1;\n}\n");

    var result = cli.mylang(["prettier", "a.ml", "--config", "style.json"], { cwd: dir });

    assert.equal(result.out, "func f() {\n        return 1;\n}\n");
  });

  test("--no-config ignores mylang.json", func() {
    project({ indent: 8 });
    put("a.ml", "func f(){\nreturn 1;\n}\n");

    var result = cli.mylang(["prettier", "a.ml", "--no-config"], { cwd: dir });

    assert.equal(result.out, "func f() {\n  return 1;\n}\n");
  });

  test("an unknown option in mylang.json is an error, not ignored", func() {
    project({ indnet: 4 });
    put("a.ml", expected);

    var result = cli.mylang(["prettier", "a.ml"], { cwd: dir });

    assert.equal(result.code, 2);
    assert.includes(result.err, "unknown prettier option 'indnet'");
  });

  test("a bad value is an error", func() {
    var result = cli.mylang(["prettier", "--stdin", "--quote", "curly"], { input: "x;" });

    assert.equal(result.code, 2);
    assert.includes(result.err, "must be one of double, single, preserve");
  });
});

describe("prettier: what it refuses", func() {
  beforeEach(freshDir);

  test("an unterminated string is reported with its position, and the file is untouched", func() {
    put("bad.ml", 'var ok = 1;\nvar s = "never closed\n');

    var result = cli.mylang(["prettier", "--write", "bad.ml"], { cwd: dir });

    assert.equal(result.code, 2);
    assert.includes(result.err, "unterminated string at 2:9");
    assert.equal(read("bad.ml"), 'var ok = 1;\nvar s = "never closed\n');
  });

  test("an unterminated comment is reported", func() {
    var result = cli.mylang(["prettier", "--stdin"], { input: "var x = 1; /* open" });

    assert.equal(result.code, 2);
    assert.includes(result.err, "unterminated comment");
  });
});

// `node --max-old-space-size=32 mylang prettier --write <file>`
func formatLimited(file) {
  var result = process.run(
    "node",
    ["--max-old-space-size=32", cli.entry, "prettier", "--write", "--no-config", file],
    { timeout: 120000 }
  );

  return { code: result.code };
}

describe("prettier: large files stream", func() {
  beforeEach(freshDir);

  test("a file far larger than the memory it is given is formatted", func() {
    // eight megabytes of messy code, formatted by a process limited to a 32 MB heap
    var line = 'func  f(a,b){ var x=a+b ; return [x,"s" , {k:1}] ; }\n';
    var block = strings.repeat(line, 2000);
    var file = path.join(dir, "big.ml");
    var handle = fs.file(file, "w");

    for (var i = 0; i < 75; i++) { handle.write(block); }

    handle.close();

    var result = formatLimited(file);

    assert.equal(result.code, 0);

    // read only the start back: the test does not hold the file whole either
    var reader = fs.file(file, "r");
    var head = strings.split(reader.read(200).toString(), "\n")[0];

    reader.close();

    assert.equal(head, 'func f(a, b) { var x = a + b; return [x, "s", { k: 1 }]; }');
  });
});

finish("tools: prettier");
