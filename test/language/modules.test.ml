import "core:test" as { describe, test, assert, finish };
import "coreio";
import "../fixtures/math.ml";
import "../fixtures/counter.ml" as counterA;
import "../fixtures/counter.ml" as counterB;
import "../fixtures/structs.ml" as { Vec2, Mode, settings };
import "../fixtures/data.json";
import (
  "strings",
  "arrays"
);
import (
  inner: "../fixtures/nested/inner.ml"
);
import "coreio" as { print };

describe("Importing library modules", func() {
  test("single import binds the module name", func() {
    assert.typeOf(coreio, "object");
    assert.typeOf(coreio.print, "function");
  });

  test("multiple imports in one statement", func() {
    assert.equal(strings.toUpperCase("a"), "A");
    assert.equal(arrays.join([1, 2], "-"), "1-2");
  });

  test("destructuring imports bind individual functions", func() {
    assert.typeOf(print, "function");
  });
});

describe("Importing file modules", func() {
  test("the module is bound under its file name", func() {
    assert.typeOf(math, "object");
    assert.equal(math.add(2, 3), 5);
    assert.equal(math.subtract(5, 1), 4);
    assert.equal(math.PI, 3.14159);
  });

  test("an alias renames the binding", func() {
    assert.equal(counterA.increment(), 1);
    assert.equal(counterA.increment(), 2);
  });

  test("a module is evaluated once and shared", func() {
    assert.equal(counterB.current(), 2);
    counterB.increment();
    assert.equal(counterA.current(), 3);
  });

  test("only exported names are visible", func() {
    assert.throws(func() { math.hidden(); }, "unknown function");
    assert.throws(func() { var v = math.hidden; }, "does not exist");
  });

  test("destructured imports expose structs, enums and values", func() {
    assert.equal(Vec2(3, 4).length(), 5);
    assert.equal(Mode.On, 1);
    assert.equal(settings, { name: "fixture", version: 2 });
  });

  test("named alias imports use plain exported values", func() {
    assert.equal(inner.addTen(5), 15);
  });

  test("a module can import another relative module", func() {
    assert.equal(inner.addTen(0), 10);
  });
});

describe("Importing data files", func() {
  test("JSON files are parsed", func() {
    assert.equal(data.name, "fixture");
    assert.equal(data.version, 3);
    assert.equal(data.tags, ["a", "b"]);
    assert.isTrue(data.nested.ok);
  });

  test("import.as reads JSON on demand", func() {
    var json = import.as("../fixtures/data.json", "json");
    assert.equal(json.version, 3);
  });

  test("import.as reads a file as a buffer", func() {
    var buf = import.as("../fixtures/note.txt", "buffer");
    assert.equal(buf.length, 22);
    assert.equal(buf.toString(), "hello from a text file");
  });

  test("import.as rejects an unknown type", func() {
    assert.throws(func() { import.as("../fixtures/note.txt", "nonsense"); });
  });
});

describe("Dynamic import", func() {
  test("import(...) returns the module", func() {
    var m = import("../fixtures/math.ml");
    assert.equal(m.add(1, 2), 3);
    assert.equal(m.PI, 3.14159);
  });

  test("import(...) of JSON", func() {
    var j = import("../fixtures/data.json");
    assert.equal(j.name, "fixture");
  });

  test("a missing module is an error", func() {
    assert.throws(func() { var m = import("../fixtures/does-not-exist.ml"); }, "No such file");
  });

  test("an error while loading a module is reported", func() {
    assert.throws(func() { var m = import("../fixtures/throws.ml"); }, "module failed to load");
  });
});

describe("Import metadata", func() {
  test("import.base, import.main and import.paths", func() {
    assert.typeOf(import.base, "string");
    assert.typeOf(import.main, "string");
    assert.typeOf(import.paths, "array");
    assert.includes(import.main, "modules.test.ml");
  });

  test("import.resolve returns an absolute path to an existing file", func() {
    var path = import.resolve("../fixtures/math.ml");
    assert.typeOf(path, "string");
    assert.includes(path, "fixtures");
    assert.includes(path, "math.ml");
  });

  test("import.resolve fails for a missing file", func() {
    assert.throws(func() { import.resolve("../fixtures/missing.ml"); });
  });
});

finish("modules");
