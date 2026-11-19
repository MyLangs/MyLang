import "core:test" as { describe, test, assert, finish };
import "net/url";

var FULL = "https://user:pw@example.com:8080/a/b?x=1&y=2#frag";

describe("net/url: URL", func() {
  var u = url.URL(FULL);

  test("every part is read by calling the method of the same name", func() {
    assert.equal(u.protocol(), "https:");
    assert.equal(u.host(), "example.com:8080");
    assert.equal(u.hostname(), "example.com");
    assert.equal(u.port(), "8080");
    assert.equal(u.pathname(), "/a/b");
    assert.equal(u.search(), "?x=1&y=2");
    assert.equal(u.hash(), "#frag");
    assert.equal(u.origin(), "https://example.com:8080");
    assert.equal(u.href(), FULL);
  });

  test("toString and toJSON give the full URL", func() {
    assert.equal(u.toString(), FULL);
    assert.equal(u.toJSON(), FULL);
  });

  test("missing parts have sensible defaults", func() {
    var d = url.URL("http://example.com");
    assert.equal(d.port(), "");
    assert.equal(d.pathname(), "/");
    assert.equal(d.search(), "");
    assert.equal(d.hash(), "");
    assert.equal(d.origin(), "http://example.com");
    assert.equal(d.href(), "http://example.com/");
  });

  test("a relative URL is resolved against a base", func() {
    assert.equal(
      url.URL("/path?q=1", "https://example.com/base/").href(),
      "https://example.com/path?q=1"
    );
    assert.equal(url.URL("../up", "https://example.com/a/b/c").href(), "https://example.com/a/up");
  });

  test("an invalid URL is rejected", func() {
    assert.throws(func() { url.URL("not a url"); }, "Invalid URL");
  });

  test("the base must be a string", func() {
    assert.throws(func() { url.URL("/x", 5); }, "must be of type string");
  });

  test("calling a part with a value changes it", func() {
    var c = url.URL("http://e.com/a");
    c.pathname("/b/c");
    c.search("?k=v");
    c.hash("#h");
    c.port(81);
    c.hostname("x.org");
    c.protocol("https:");
    assert.equal(c.href(), "https://x.org:81/b/c?k=v#h");
  });

  test("href and host can be replaced", func() {
    var c = url.URL("http://e.com/");
    c.host("h.org:99");
    assert.equal(c.href(), "http://h.org:99/");
    assert.equal(c.port(), "99");
    c.href("https://other.org/x");
    assert.equal(c.href(), "https://other.org/x");
  });

  test("a setter returns the updated URL, so calls can be chained", func() {
    var chained = url.URL("http://e.com/").pathname("/p").search("?q=1").hash("#x");
    assert.equal(chained.href(), "http://e.com/p?q=1#x");
  });

  test("setters validate their argument", func() {
    assert.throws(func() { url.URL("http://e.com/").pathname(5); }, "must be of type string");
  });

  test("clone is independent", func() {
    var c = url.URL("http://e.com/a");
    var d = c.clone();
    d.pathname("/b");
    assert.equal(c.pathname(), "/a");
    assert.equal(d.pathname(), "/b");
  });

  test("resolve builds a new URL relative to this one", func() {
    var c = url.URL("http://e.com/a/b");
    assert.equal(c.resolve("../c").href(), "http://e.com/c");
    assert.equal(c.resolve("/root").href(), "http://e.com/root");
    assert.equal(c.resolve("http://o.org/").href(), "http://o.org/");
  });

  test("isAbsolute and isRelative", func() {
    var c = url.URL("http://e.com/");
    assert.isTrue(c.isAbsolute());
    assert.isFalse(c.isRelative());
  });

  test("searchParams is linked to the URL", func() {
    var c = url.URL("http://e.com/?a=1");
    var params = c.searchParams();
    assert.equal(params.get("a"), "1");
    params.append("b", "2");
    assert.equal(c.href(), "http://e.com/?a=1&b=2");
    params.set("a", "9");
    assert.equal(c.search(), "?a=9&b=2");
  });
});

describe("net/url: URLSearchParams", func() {
  test("built from a query string, with or without a leading ?", func() {
    var sp = url.URLSearchParams("a=1&b=2&a=3");
    assert.equal(sp.get("a"), "1");
    assert.equal(sp.getAll("a"), ["1", "3"]);
    assert.isNil(sp.get("zz"));
    assert.equal(url.URLSearchParams("?a=1").toString(), "a=1");
  });

  test("built from an object or from pairs", func() {
    assert.equal(url.URLSearchParams({ a: 1, b: "x y" }).toString(), "a=1&b=x+y");
    assert.equal(url.URLSearchParams([["a", "1"], ["b", "2"]]).toString(), "a=1&b=2");
    assert.equal(url.URLSearchParams().toString(), "");
  });

  test("has", func() {
    var sp = url.URLSearchParams("a=1&b=2");
    assert.isTrue(sp.has("b"));
    assert.isFalse(sp.has("c"));
  });

  test("has and delete can target a name/value pair", func() {
    var sp = url.URLSearchParams("a=1&a=2");
    assert.isTrue(sp.has("a", "1"));
    assert.isFalse(sp.has("a", "3"));
    sp.delete("a", "1");
    assert.equal(sp.toString(), "a=2");
  });

  test("append, set and delete", func() {
    var sp = url.URLSearchParams("a=1");
    sp.append("a", "2");
    sp.append("b", "3");
    sp.set("c", "4");
    sp.delete("b");
    assert.equal(sp.toString(), "a=1&a=2&c=4");
    assert.equal(sp.getAll("a"), ["1", "2"]);
  });

  test("set replaces every value of the name", func() {
    var sp = url.URLSearchParams("a=1&a=2");
    sp.set("a", "9");
    assert.equal(sp.toString(), "a=9");
  });

  test("mutating methods are chainable", func() {
    var sp = url.URLSearchParams();
    sp.append("a", "1").append("b", "2").set("c", "3").delete("a");
    assert.equal(sp.toString(), "b=2&c=3");
  });

  test("sort orders by name", func() {
    var sp = url.URLSearchParams("b=2&a=1&c=3");
    sp.sort();
    assert.equal(sp.toString(), "a=1&b=2&c=3");
  });

  test("keys, values and entries", func() {
    var sp = url.URLSearchParams("a=1&b=2");
    assert.equal(sp.keys(), ["a", "b"]);
    assert.equal(sp.values(), ["1", "2"]);
    assert.equal(sp.entries(), [["a", "1"], ["b", "2"]]);
  });

  test("forEach receives value and name", func() {
    var seen = [];
    url.URLSearchParams("a=1&b=2").forEach(func(v, k) { seen[length(seen)] = k + v; });
    assert.equal(seen, ["a1", "b2"]);
  });

  test("for-in iterates [name, value] pairs", func() {
    var seen = [];
    for (var pair in url.URLSearchParams("a=1&b=2")) { seen[length(seen)] = pair; }
    assert.equal(seen, [["a", "1"], ["b", "2"]]);
  });

  test("size counts the entries", func() {
    assert.equal(url.URLSearchParams("a=1&b=2").size(), 2);
    assert.equal(url.URLSearchParams("").size(), 0);
  });

  test("toObject keeps repeated names as lists", func() {
    assert.equal(url.URLSearchParams("a=1&b=2").toObject(), { a: "1", b: "2" });
    assert.equal(url.URLSearchParams("a=1&a=2").toObject(), { a: ["1", "2"] });
  });

  test("values are percent-encoded", func() {
    var sp = url.URLSearchParams();
    sp.append("q", "a b&c");
    sp.append("é", "ü");
    assert.equal(sp.toString(), "q=a+b%26c&%C3%A9=%C3%BC");
  });

  test("clone is independent", func() {
    var sp = url.URLSearchParams("a=1");
    var c = sp.clone();
    c.append("b", "2");
    assert.equal(sp.toString(), "a=1");
    assert.equal(c.toString(), "a=1&b=2");
  });

  test("validation", func() {
    assert.throws(func() { url.URLSearchParams("a=1").get(5); }, "must be of type string");
    assert.throws(func() { url.URLSearchParams().append("a", 1); }, "must be of type string");
  });
});

describe("net/url: URLPattern", func() {
  test("a string pattern with a named group", func() {
    var pattern = url.URLPattern("https://x.com/books/:id");
    assert.isTrue(pattern.test("https://x.com/books/7"));
    assert.isFalse(pattern.test("https://x.com/books"));
    assert.isFalse(pattern.test("https://y.com/books/7"));
  });
});

describe("net/url: encoding helpers", func() {
  test("encodeURIComponent and decodeURIComponent", func() {
    assert.equal(url.encodeURIComponent("a b&c/é"), "a%20b%26c%2F%C3%A9");
    assert.equal(url.decodeURIComponent("a%20b%26c"), "a b&c");
    assert.equal(url.decodeURIComponent(url.encodeURIComponent("ü ?")), "ü ?");
  });

  test("encodeURI keeps the structure of a URL", func() {
    assert.equal(url.encodeURI("http://x.com/a b?q=é"), "http://x.com/a%20b?q=%C3%A9");
    assert.equal(url.decodeURI("a%20b%2Fc"), "a b%2Fc");
  });

  test("malformed escapes are rejected", func() {
    assert.throws(func() { url.decodeURIComponent("%E0%A4%A"); }, "Cannot decode URI component");
  });
});

describe("net/url: module functions", func() {
  test("format builds a URL from parts", func() {
    assert.equal(
      url.format({
        protocol: "https",
        hostname: "example.com",
        pathname: "/p",
        query: { a: 1, b: "x y" }
      }).href(),
      "https://example.com/p?a=1&b=x+y"
    );
    assert.equal(
      url.format({
        protocol: "http",
        host: "x.com:81",
        pathname: "/a",
        search: "q=1",
        hash: "h"
      }).href(),
      "http://x.com:81/a?q=1#h"
    );
    assert.equal(
      url.format({ protocol: "ftp:", hostname: "h", port: 2121, pathname: "/f" }).href(),
      "ftp://h:2121/f"
    );
  });

  test("format defaults to http://localhost/", func() {
    assert.equal(url.format({}).href(), "http://localhost/");
  });

  test("format accepts an existing URL", func() {
    assert.equal(url.format(url.URL(FULL)).href(), FULL);
  });

  test("resolve", func() {
    assert.equal(url.resolve("http://example.com/a/b", "../c"), "http://example.com/c");
    assert.equal(url.resolve("http://example.com/a/", "d"), "http://example.com/a/d");
    assert.equal(url.resolve("http://example.com/a", "http://other.org/x"), "http://other.org/x");
  });

  test("isAbsolute", func() {
    assert.isTrue(url.isAbsolute("http://x.com"));
    assert.isTrue(url.isAbsolute("mailto:a@b.c"));
    assert.isFalse(url.isAbsolute("/path"));
    assert.isFalse(url.isAbsolute("x.com"));
  });

  test("join combines URL segments", func() {
    assert.equal(url.join("http://x.com/a", "b", "c"), "http://x.com/a/b/c");
    assert.equal(url.join("http://x.com/a/", "/b/"), "http://x.com/a/b/");
    assert.equal(url.join("http://x.com", "p"), "http://x.com/p");
    assert.equal(url.join("a", "b"), "a/b");
  });

  test("fileURLToPath", func() {
    assert.equal(url.fileURLToPath("file:///tmp/a%20b.txt"), "/tmp/a b.txt");
  });

  test("fileURLToPath rejects non-file URLs", func() {
    assert.throws(func() { url.fileURLToPath("http://x.com"); }, "must be a file: URL");
  });
});

finish("url");
