import "core:test" as { describe, test, assert, finish };
import "core:path";
import "core:strings";
import "./cli.ml" as cli;

// `--no-colors`: colour off everywhere, a warning once.

var paint = path.resolve("test", "fixtures", "colors", "paint.ml");
var failing = path.resolve("test", "fixtures", "throws.ml");
var esc = "\x1b[";

func count(text, part) { return length(strings.split(text, part)) - 1; }

describe("--no-colors: nothing coloured leaves the process", func() {
  test("without the flag the colour functions colour", func() {
    var result = cli.mylang(["run", paint]);

    assert.equal(result.code, 0);
    assert.includes(result.out, esc + "31mred");
    assert.notIncludes(result.err, "ColorsDisabled");
  });

  test("with it, the program's output has no colour at all", func() {
    var result = cli.mylang(["run", paint, "--no-colors"]);

    assert.equal(result.code, 0);
    assert.notIncludes(result.out, esc);
    assert.includes(result.out, "red\ngreen\nblue\nmagenta\n");
  });

  test("a colour code built by hand is removed too", func() {
    var result = cli.mylang(["run", paint, "--no-colors"]);

    assert.includes(result.out, "magenta");
    assert.notIncludes(result.out, "35m");
  });

  test("the colour functions return plain text, so lengths are the text's", func() {
    var result = cli.mylang(["run", paint, "--no-colors"]);

    assert.includes(result.out, "length 1");
    assert.includes(result.out, "enabled false");
  });

  test("the warning is given once, however many colour calls there were", func() {
    var result = cli.mylang(["run", paint, "--no-colors"]);

    assert.equal(count(result.err, "ColorsDisabled"), 1);
    assert.includes(result.err, "WARN004");
    assert.notIncludes(result.err, esc);
  });

  test("--no-color is the same switch", func() {
    var result = cli.mylang(["run", paint, "--no-color"]);

    assert.notIncludes(result.out, esc);
    assert.equal(count(result.err, "ColorsDisabled"), 1);
  });

  test("the flag works before the command as well as after it", func() {
    var result = cli.mylang(["--no-colors", "run", paint]);

    assert.equal(result.code, 0);
    assert.notIncludes(result.out, esc);
  });

  test("an error the program dies of is printed without colour", func() {
    var coloured = cli.mylang(["run", failing]);
    var plain = cli.mylang(["run", failing, "--no-colors"]);

    assert.notEqual(coloured.code, 0);
    assert.includes(coloured.err, esc);
    assert.notIncludes(plain.err, esc);
  });

  test("the test runner prints without colour", func() {
    var result = cli.mylang(["test", "test/language/update.test.ml", "--no-colors"]);

    assert.equal(result.code, 0);
    assert.notIncludes(result.out, esc);
    assert.includes(result.out, "Passed");
  });

  test("the formatter reports without colour", func() {
    var result = cli.mylang(["prettier", "--check", paint, "--no-config", "--no-colors"]);

    assert.notIncludes(result.out, esc);
    assert.notIncludes(result.err, esc);
  });
});

finish("tools: no-colors");
