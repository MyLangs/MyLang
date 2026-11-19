import "core:test" as { describe, test, assert, finish };
import "utils";
import "utils/colors";

struct Sample { var a; }
enum Level { Low }
func plain() {}

describe("utils: typeOf", func() {
  test("primitive types", func() {
    assert.equal(utils.typeOf(1), "int");
    assert.equal(utils.typeOf(1.5), "float");
    assert.equal(utils.typeOf("s"), "string");
    assert.equal(utils.typeOf(true), "boolean");
    assert.equal(utils.typeOf(nil), "nil");
    assert.equal(utils.typeOf(5n), "bigint");
  });

  test("special numbers", func() {
    assert.equal(utils.typeOf(1 / 0), "infinity");
    assert.equal(utils.typeOf(0 / 0), "nan");
  });

  test("containers", func() {
    assert.equal(utils.typeOf([]), "array");
    assert.equal(utils.typeOf({}), "object");
  });

  test("functions", func() {
    assert.equal(utils.typeOf(plain), "function");
    assert.equal(utils.typeOf(func() {}), "function");
    assert.equal(utils.typeOf(utils.typeOf), "function");
  });

  test("structs, enums and symbols", func() {
    assert.equal(utils.typeOf(Sample), "struct");
    assert.equal(utils.typeOf(Sample(1)), "struct");
    assert.equal(utils.typeOf(Level), "enum");
    assert.equal(utils.typeOf(symbol.iterator), "symbol");
  });

  test("errors", func() {
    var err = nil;
    try { throw "x"; } catch (e) { err = e; }
    assert.equal(utils.typeOf(err), "error");
  });

  test("agrees with the typeof operator", func() {
    var samples = [1, 1.5, "s", true, nil, [], {}, plain, Sample, Level, 5n];
    for (var v in samples) { assert.equal(utils.typeOf(v), typeof v); }
  });
});

describe("utils/colors: foreground and background colours", func() {
  var codes = {
    red: "31", green: "32", yellow: "33", blue: "34", magenta: "35",
    cyan: "36", white: "37", black: "30", gray: "90", grey: "90",
    brightRed: "91", brightGreen: "92", brightBlue: "94", brightYellow: "93",
    brightMagenta: "95", brightCyan: "96", brightWhite: "97",
    bgRed: "41", bgGreen: "42", bgBlue: "44", bgYellow: "43",
    bgMagenta: "45", bgCyan: "46", bgWhite: "47", bgBlack: "40"
  };

  test("every colour wraps the text in its ANSI code and a reset", func() {
    for (var name in codes) {
      assert.equal(colors[name]("x"), "\u001b[" + codes[name] + "mx\u001b[0m", name);
    }
  });

  test("empty text is still wrapped", func() {
    assert.equal(colors.red(""), "\u001b[31m\u001b[0m");
  });

  test("the text must be a string", func() {
    assert.throws(func() { colors.red(5); }, "must be of type string");
    assert.throws(func() { colors.bold(nil); }, "must be of type string");
  });
});

describe("utils/colors: text styles", func() {
  var styles = {
    bold: "1",
    dim: "2",
    italic: "3",
    underline: "4",
    reverse: "7",
    strikethrough: "9"
  };

  test("every style wraps the text in its ANSI code and a reset", func() {
    for (var name in styles) {
      assert.equal(colors[name]("x"), "\u001b[" + styles[name] + "mx\u001b[0m", name);
    }
  });
});

describe("utils/colors: true colour", func() {
  test("rgb and bgRgb", func() {
    assert.equal(colors.rgb("x", 255, 0, 10), "\u001b[38;2;255;0;10mx\u001b[0m");
    assert.equal(colors.bgRgb("x", 1, 2, 3), "\u001b[48;2;1;2;3mx\u001b[0m");
  });

  test("rgb components must be integers from 0 to 255", func() {
    assert.throws(func() { colors.rgb("x", 256, 0, 0); }, "integers between 0-255");
    assert.throws(func() { colors.rgb("x", -1, 0, 0); }, "integers between 0-255");
    assert.throws(func() { colors.bgRgb("x", 0, 300, 0); }, "integers between 0-255");
    assert.throws(func() { colors.rgb("x", "a", 0, 0); }, "must be of type int");
  });

  test("hex accepts #RRGGBB and #RGB", func() {
    assert.equal(colors.hex("x", "#ff0000"), "\u001b[38;2;255;0;0mx\u001b[0m");
    assert.equal(colors.hex("x", "#f00"), "\u001b[38;2;255;0;0mx\u001b[0m");
    assert.equal(colors.bgHex("x", "#00ff00"), "\u001b[48;2;0;255;0mx\u001b[0m");
    assert.equal(colors.bgHex("x", "#0f0"), "\u001b[48;2;0;255;0mx\u001b[0m");
  });

  test("hex rejects malformed colours", func() {
    assert.throws(func() { colors.hex("x", "ff0000"); }, "valid hex color");
    assert.throws(func() { colors.hex("x", "#ggg"); }, "valid hex color");
    assert.throws(func() { colors.bgHex("x", "#12"); }, "valid hex color");
  });

  test("hsl and bgHsl convert to RGB", func() {
    assert.equal(colors.hsl("x", 0, 100, 50), "\u001b[38;2;255;0;0mx\u001b[0m");
    assert.equal(colors.hsl("x", 120, 100, 50), "\u001b[38;2;0;255;0mx\u001b[0m");
    assert.equal(colors.hsl("x", 240, 100, 50), "\u001b[38;2;0;0;255mx\u001b[0m");
    assert.equal(colors.hsl("x", 0, 0, 100), "\u001b[38;2;255;255;255mx\u001b[0m");
    assert.equal(colors.bgHsl("x", 0, 100, 50), "\u001b[48;2;255;0;0mx\u001b[0m");
  });

  test("hsl components must be in range", func() {
    assert.throws(func() { colors.hsl("x", 361, 0, 0); }, "h: 0-360");
    assert.throws(func() { colors.hsl("x", 0, 101, 0); }, "h: 0-360");
    assert.throws(func() { colors.bgHsl("x", 0, 0, -1); }, "h: 0-360");
  });
});

describe("utils/colors: helpers", func() {
  test("rainbow colours the characters in turn", func() {
    assert.equal(
      colors.rainbow("abcdefg"),
      "\u001b[31ma\u001b[33mb\u001b[32mc\u001b[36md\u001b[34me\u001b[35mf\u001b[31mg\u001b[0m"
    );
  });

  test("strip removes every escape sequence", func() {
    assert.equal(colors.strip(colors.red("hello")), "hello");
    assert.equal(colors.strip(colors.rgb(colors.bold("x"), 1, 2, 3)), "x");
    assert.equal(colors.strip(colors.rainbow("abc")), "abc");
    assert.equal(colors.strip("plain"), "plain");
  });

  test("random picks a basic colour and keeps the text", func() {
    for (var i = 0; i < 40; i++) {
      var r = colors.random("x");
      assert.equal(colors.strip(r), "x");
      assert.notEqual(r, "x");
    }
  });

  test("combine joins several colours and styles", func() {
    assert.equal(colors.combine("x", "red", "bold"), "\u001b[31m\u001b[1mx\u001b[0m");
    assert.equal(colors.combine("x", "underline", "bgYellow"), "\u001b[4m\u001b[43mx\u001b[0m");
  });

  test("combine ignores unknown names", func() {
    assert.equal(colors.combine("x"), "x\u001b[0m");
    assert.equal(colors.combine("x", "nope"), "x\u001b[0m");
  });

  test("combine does not read names inherited from JavaScript objects", func() {
    assert.equal(colors.combine("x", "constructor", "toString"), "x\u001b[0m");
  });

  test("combine validates its style arguments", func() {
    assert.throws(func() { colors.combine("x", 5); }, "must be of type string");
  });

  test("enabled reports whether the terminal supports colour", func() {
    assert.typeOf(colors.enabled(), "boolean");
  });

  test("the raw tables are exported", func() {
    assert.equal(colors.Colors.red, "\u001b[31m");
    assert.equal(colors.Styles.reset, "\u001b[0m");
    assert.equal(colors.Styles.bold, "\u001b[1m");
  });
});

finish("utils");
