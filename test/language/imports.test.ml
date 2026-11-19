import "core:test" as { describe, test, assert, finish };
import "core:coreio";
import "core:strings";
import "core:net/http" as httpCore;
import "core:numbers/bigint";
import ("core:arrays", "core:path");
import "core:json" as data;

// The `core:` namespace names a module that ships with the interpreter. It cannot be
// shadowed by a project dependency of the same name, which is why it is the recommended
// spelling; the bare form keeps working for every built-in.

describe("imports: the core namespace", func() {
  test("core:<name> binds the same module as the bare name", func() {
    assert.typeOf(coreio, "object");
    assert.typeOf(coreio.print, "function");
    assert.equal(strings.toUpperCase("a"), "A");
  });

  test("a nested module binds under its last segment", func() {
    assert.typeOf(bigint, "object");
    assert.typeOf(bigint.add, "function");
  });

  test("an alias overrides the default binding name", func() {
    assert.typeOf(httpCore, "object");
    assert.typeOf(httpCore.Server, "function");
  });

  test("core: works in a grouped import", func() {
    assert.equal(arrays.join([1, 2], "-"), "1-2");
    assert.typeOf(path.join, "function");
  });

  test("core: works with an alias on a single import", func() {
    assert.typeOf(data.stringify, "function");
    assert.equal(data.parse('{"a":1}').a, 1);
  });

  test("an unknown core module is reported as such", func() {
    var err = assert.throws(func() {
      return import("core:not-a-real-module");
    });

    assert.includes(err.message, "not-a-real-module");
  });

  test("core: and the bare name give the same module", func() {
    var a = import("core:strings");
    var b = import("strings");

    assert.equal(a.toUpperCase("x"), b.toUpperCase("x"));
  });
});

describe("imports: the new built-in modules are reachable", func() {
  test("every module added in 2.2 can be imported", func() {
    assert.typeOf(import("core:test"), "object");
    assert.typeOf(import("core:binary"), "object");
    assert.typeOf(import("core:validation"), "object");
    assert.typeOf(import("core:compress"), "object");
    assert.typeOf(import("core:archive"), "object");
    assert.typeOf(import("core:dns"), "object");
    assert.typeOf(import("core:tcp"), "object");
    assert.typeOf(import("core:udp"), "object");
    assert.typeOf(import("core:ws"), "object");
    assert.typeOf(import("core:workers"), "object");
    assert.typeOf(import("core:process"), "object");
  });
});

describe("imports: a module may take the name of a predefined global", func() {
  test("importing core:process binds the process library", func() {
    var proc = import("core:process");

    assert.typeOf(proc.run, "function");
    assert.typeOf(proc.permissions, "function");
  });
});

finish("imports");
