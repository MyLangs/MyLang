import "core:test" as { describe, test, assert, finish };
import "strings";

describe("strings: access", func() {
  test("at supports negative indexes and returns nil when out of range", func() {
    assert.equal(strings.at("hello", 0), "h");
    assert.equal(strings.at("hello", -1), "o");
    assert.isNil(strings.at("hello", 9));
  });

  test("charAt returns an empty string when out of range", func() {
    assert.equal(strings.charAt("hello", 1), "e");
    assert.equal(strings.charAt("hello", 9), "");
  });

  test("charCodeAt and codePointAt", func() {
    assert.equal(strings.charCodeAt("A", 0), 65);
    assert.equal(strings.charCodeAt("abc", 2), 99);
    assert.equal(strings.codePointAt("A", 0), 65);
  });

  test("length counts characters", func() {
    assert.equal(strings.length("héllo"), 5);
    assert.equal(strings.length(""), 0);
  });

  test("valueOf and toString", func() {
    assert.equal(strings.valueOf("x"), "x");
    assert.equal(strings.toString(123), "123");
    assert.equal(strings.toString(true), "true");
    assert.equal(strings.toString([1, 2]), "1,2");
  });
});

describe("strings: building", func() {
  test("concat joins all arguments", func() {
    assert.equal(strings.concat("a", "b", "c"), "abc");
    assert.equal(strings.concat("a"), "a");
  });

  test("repeat", func() {
    assert.equal(strings.repeat("ab", 3), "ababab");
    assert.equal(strings.repeat("x", 0), "");
  });

  test("repeat rejects a negative count", func() {
    assert.throws(func() { strings.repeat("x", -1); });
  });

  test("join is the inverse of split", func() {
    assert.equal(strings.join(["a", "b", "c"], "-"), "a-b-c");
    assert.equal(strings.join(["a", "b"]), "a b");
    assert.equal(strings.join([], ","), "");
    assert.equal(strings.join(strings.split("x y z"), " "), "x y z");
  });

  test("join requires an array", func() {
    assert.throws(func() { strings.join("abc", ","); }, "must be of type array");
  });

  test("fromCharCode and fromCodePoint", func() {
    assert.equal(strings.fromCharCode(72, 105), "Hi");
    assert.equal(strings.fromCharCode(65), "A");
    assert.equal(strings.fromCodePoint(128512), "😀");
  });

  test("raw joins the raw strings with substitutions", func() {
    assert.equal(strings.raw({ raw: ["x", "y", "z"] }, "-", "+"), "x-y+z");
  });
});

describe("strings: searching", func() {
  test("includes", func() {
    assert.isTrue(strings.includes("hello", "ell"));
    assert.isFalse(strings.includes("hello", "z"));
    assert.isTrue(strings.includes("hello", ""));
    assert.isFalse(strings.includes("hello", "h", 1));
  });

  test("indexOf", func() {
    assert.equal(strings.indexOf("hello", "l"), 2);
    assert.equal(strings.indexOf("hello", "z"), -1);
    assert.equal(strings.indexOf("hello", "l", 3), 3);
  });

  test("lastIndexOf", func() {
    assert.equal(strings.lastIndexOf("hello", "l"), 3);
    assert.equal(strings.lastIndexOf("hello", "z"), -1);
  });

  test("startsWith", func() {
    assert.isTrue(strings.startsWith("hello", "he"));
    assert.isFalse(strings.startsWith("hello", "lo"));
    assert.isTrue(strings.startsWith("hello", "ll", 2));
  });

  test("endsWith", func() {
    assert.isTrue(strings.endsWith("hello", "lo"));
    assert.isFalse(strings.endsWith("hello", "he"));
  });

  test("count counts non-overlapping occurrences", func() {
    assert.equal(strings.count("banana", "a"), 3);
    assert.equal(strings.count("banana", "na"), 2);
    assert.equal(strings.count("banana", "z"), 0);
  });
});

describe("strings: replacing and cutting", func() {
  test("replace changes only the first match", func() {
    assert.equal(strings.replace("aaa", "a", "b"), "baa");
    assert.equal(strings.replace("hello", "z", "y"), "hello");
  });

  test("replaceAll changes every match", func() {
    assert.equal(strings.replaceAll("aaa", "a", "b"), "bbb");
    assert.equal(strings.replaceAll("a-b-c", "-", "+"), "a+b+c");
  });

  test("slice supports negative positions", func() {
    assert.equal(strings.slice("hello", 1, 3), "el");
    assert.equal(strings.slice("hello", -3), "llo");
    assert.equal(strings.slice("hello", 2), "llo");
  });

  test("substring swaps reversed bounds", func() {
    assert.equal(strings.substring("hello", 1, 3), "el");
    assert.equal(strings.substring("hello", 3, 1), "el");
    assert.equal(strings.substring("hello", 2), "llo");
  });

  test("substr takes a start and a length", func() {
    assert.equal(strings.substr("hello", 1, 3), "ell");
    assert.equal(strings.substr("hello", -3, 2), "ll");
  });

  test("insert", func() {
    assert.equal(strings.insert("hello", 2, "XX"), "heXXllo");
    assert.equal(strings.insert("hello", 0, ">"), ">hello");
    assert.equal(strings.insert("hello", 5, "!"), "hello!");
  });

  test("remove cuts a range given by start and length", func() {
    assert.equal(strings.remove("hello", 1, 3), "ho");
    assert.equal(strings.remove("hello", 0, 1), "ello");
  });

  test("truncate keeps the total length including the suffix", func() {
    assert.equal(strings.truncate("Hello World", 5), "He...");
    assert.equal(strings.truncate("Hi", 5), "Hi");
    assert.equal(strings.truncate("Hello World", 8, "~"), "Hello W~");
  });
});

describe("strings: splitting", func() {
  test("split by separator", func() {
    assert.equal(strings.split("a,b,c", ","), ["a", "b", "c"]);
  });

  test("split defaults to a space", func() {
    assert.equal(strings.split("a b c"), ["a", "b", "c"]);
  });

  test("split with a limit", func() {
    assert.equal(strings.split("a,b,c", ",", 2), ["a", "b"]);
  });

  test("split with an empty separator gives characters", func() {
    assert.equal(strings.split("abc", ""), ["a", "b", "c"]);
  });

  test("lines", func() {
    assert.equal(strings.lines("a\nb\nc"), ["a", "b", "c"]);
    assert.equal(strings.lines("one"), ["one"]);
  });

  test("words ignores repeated whitespace", func() {
    assert.equal(strings.words("  hello   big world "), ["hello", "big", "world"]);
    assert.equal(strings.words(""), []);
  });
});

describe("strings: padding and trimming", func() {
  test("padStart", func() {
    assert.equal(strings.padStart("5", 3, "0"), "005");
    assert.equal(strings.padStart("5", 3), "  5");
    assert.equal(strings.padStart("abc", 2, "0"), "abc");
  });

  test("padEnd", func() {
    assert.equal(strings.padEnd("5", 3, "0"), "500");
    assert.equal(strings.padEnd("5", 3), "5  ");
  });

  test("trim variants", func() {
    assert.equal(strings.trim("  hi  "), "hi");
    assert.equal(strings.trimStart("  hi  "), "hi  ");
    assert.equal(strings.trimEnd("  hi  "), "  hi");
    assert.equal(strings.trimLeft("  hi"), "hi");
    assert.equal(strings.trimRight("hi  "), "hi");
  });

  test("trim removes tabs and new lines", func() {
    assert.equal(strings.trim("\t\n x \n"), "x");
  });
});

describe("strings: case and formatting", func() {
  test("lower and upper case", func() {
    assert.equal(strings.toLowerCase("HeLLo"), "hello");
    assert.equal(strings.toUpperCase("HeLLo"), "HELLO");
    assert.equal(strings.toLocaleLowerCase("ABC"), "abc");
    assert.equal(strings.toLocaleUpperCase("abc"), "ABC");
  });

  test("toTitleCase capitalises every word", func() {
    assert.equal(strings.toTitleCase("hello world"), "Hello World");
    assert.equal(strings.toTitleCase("hELLO wORLD"), "Hello World");
  });

  test("capitalize changes the first letter", func() {
    assert.equal(strings.capitalize("hello world"), "Hello world");
    assert.equal(strings.capitalize(""), "");
  });

  test("wrapWith surrounds with the same text", func() {
    assert.equal(strings.wrapWith("x", "*"), "*x*");
  });

  test("wrapBetween uses a start and an end", func() {
    assert.equal(strings.wrapBetween("x", "(", ")"), "(x)");
    assert.equal(strings.wrapBetween("x", "<b>", "</b>"), "<b>x</b>");
  });

  test("reverse", func() {
    assert.equal(strings.reverse("abc"), "cba");
    assert.equal(strings.reverse(""), "");
  });

  test("normalize composes combining characters", func() {
    assert.isTrue(strings.normalize("e\u0301") == "\u00e9");
  });

  test("localeCompare returns the sign of the comparison", func() {
    assert.equal(strings.localeCompare("a", "b"), -1);
    assert.equal(strings.localeCompare("b", "a"), 1);
    assert.equal(strings.localeCompare("a", "a"), 0);
  });
});

describe("strings: argument validation", func() {
  test("the first argument must be a string", func() {
    assert.throws(func() { strings.toUpperCase(5); }, "must be of type string");
    assert.throws(func() { strings.slice(5, 1); }, "must be of type string");
    assert.throws(func() { strings.trim(nil); }, "must be of type string");
  });

  test("numeric arguments must be numbers", func() {
    assert.throws(func() { strings.remove("hello", "a", 2); }, "must be of type int");
    assert.throws(func() { strings.insert("hello", "x", "y"); }, "must be of type int");
  });

  test("string arguments must be strings", func() {
    assert.throws(func() { strings.wrapBetween("x", "(", nil); }, "must be of type string");
  });
});

finish("strings");
