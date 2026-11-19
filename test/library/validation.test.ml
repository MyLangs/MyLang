import "core:test" as { describe, test, assert, finish };
import "core:validation" as v;

describe("validation: scalars", func() {
  test("strings with length and pattern bounds", func() {
    var name = v.string({ min: 2, max: 5 });

    assert.isTrue(v.isValid(name, "abc"));
    assert.isFalse(v.isValid(name, "a"));
    assert.isFalse(v.isValid(name, "abcdef"));
    assert.isFalse(v.isValid(name, 5));

    var email = v.string({ pattern: "^[^@]+@[^@]+$" });

    assert.isTrue(v.isValid(email, "a@b"));
    assert.isFalse(v.isValid(email, "nope"));
  });

  test("numbers and integers are different", func() {
    assert.isTrue(v.isValid(v.number(), 1.5));
    assert.isTrue(v.isValid(v.number(), 2));
    assert.isFalse(v.isValid(v.integer(), 1.5));
    assert.isTrue(v.isValid(v.integer(), 2));
  });

  test("numeric bounds", func() {
    var age = v.integer({ min: 0, max: 130 });

    assert.isTrue(v.isValid(age, 0));
    assert.isTrue(v.isValid(age, 130));
    assert.isFalse(v.isValid(age, -1));
    assert.isFalse(v.isValid(age, 131));
  });

  test("booleans and any", func() {
    assert.isTrue(v.isValid(v.boolean(), false));
    assert.isFalse(v.isValid(v.boolean(), "true"));
    assert.isTrue(v.isValid(v.any(), "anything"));
    assert.isTrue(v.isValid(v.any(), 1));
  });

  test("enums list the values that are allowed", func() {
    var role = v.enumOf(["admin", "user"]);

    assert.isTrue(v.isValid(role, "admin"));
    assert.isFalse(v.isValid(role, "root"));

    var caught = assert.throws(func() { v.parse(role, "root"); });
    assert.includes(caught.message, "admin, user");
  });
});

describe("validation: missing values", func() {
  test("a value is required unless it says otherwise", func() {
    assert.isFalse(v.isValid(v.string(), nil));
    assert.isTrue(v.isValid(v.string({ optional: true }), nil));
    assert.isTrue(v.isValid(v.string({ nullable: true }), nil));
  });

  test("a fallback fills in a missing optional value", func() {
    var schema = v.object({
      role: v.enumOf(["admin", "user"], { optional: true, fallback: "user" })
    });

    assert.equal(v.parse(schema, {}).role, "user");
    assert.equal(v.parse(schema, { role: "admin" }).role, "admin");
  });
});

describe("validation: collections", func() {
  test("arrays check their items and their size", func() {
    var tags = v.array(v.string(), { max: 2 });

    assert.isTrue(v.isValid(tags, ["a"]));
    assert.isTrue(v.isValid(tags, ["a", "b"]));
    assert.isFalse(v.isValid(tags, ["a", "b", "c"]));
    assert.isFalse(v.isValid(tags, [1]));
    assert.isFalse(v.isValid(tags, "not an array"));
  });

  test("objects check each field", func() {
    var user = v.object({
      name: v.string({ min: 1 }),
      age: v.integer({ optional: true })
    });

    assert.isTrue(v.isValid(user, { name: "Ann" }));
    assert.isTrue(v.isValid(user, { name: "Ann", age: 30 }));
    assert.isFalse(v.isValid(user, { name: "" }));
    assert.isFalse(v.isValid(user, {}));
  });

  test("a strict object refuses members it does not describe", func() {
    var strict = v.object({ a: v.integer() }, { strict: true });
    var loose = v.object({ a: v.integer() });

    assert.isTrue(v.isValid(loose, { a: 1, extra: 2 }));
    assert.isFalse(v.isValid(strict, { a: 1, extra: 2 }));
  });

  test("schemas nest", func() {
    var schema = v.object({
      items: v.array(v.object({ id: v.integer(), name: v.string() }))
    });

    assert.isTrue(v.isValid(schema, { items: [{ id: 1, name: "a" }] }));
    assert.isFalse(v.isValid(schema, { items: [{ id: "x", name: "a" }] }));
  });
});

describe("validation: reporting", func() {
  var user = v.object({
    name: v.string({ min: 1 }),
    tags: v.array(v.string(), { max: 1, optional: true })
  });

  test("check collects every failure with its path", func() {
    var result = v.check(user, { name: "", tags: [1, 2] });

    assert.isFalse(result.valid);
    assert.greaterOrEqual(length(result.errors), 2);

    var paths = [];
    for (var e in result.errors) { paths[length(paths)] = e.path; }

    assert.includes(paths, "name");
  });

  test("an error carries a ready-made sentence", func() {
    var result = v.check(user, { name: 5 });

    assert.includes(result.errors[0].text, "name must be a string");
  });

  test("check returns the validated value when it passes", func() {
    var result = v.check(user, { name: "Ann" });

    assert.isTrue(result.valid);
    assert.equal(result.value.name, "Ann");
  });

  test("parse throws with every problem named", func() {
    var caught = assert.throws(func() { v.parse(user, { name: "" }); });

    assert.includes(caught.message, "validation failed");
    assert.includes(caught.message, "name");
  });

  test("a custom message replaces the generated one", func() {
    var schema = v.string({ min: 8, message: "password is too short" });
    var result = v.check(schema, "abc");

    assert.equal(result.errors[0].message, "password is too short");
  });
});

describe("validation: custom rules", func() {
  test("a predicate decides", func() {
    var even = v.custom(func(n) { return n % 2 == 0; }, { message: "must be even" });

    assert.isTrue(v.isValid(even, 4));
    assert.isFalse(v.isValid(even, 5));
    assert.includes(v.check(even, 5).errors[0].message, "must be even");
  });

  test("a predicate may return its own message", func() {
    var schema = v.custom(func(n) {
      if (n > 10) { return true; }
      return "needs to be above 10";
    });

    assert.includes(v.check(schema, 1).errors[0].message, "above 10");
  });
});

describe("validation: schemas are values", func() {
  test("isSchema tells a schema from anything else", func() {
    assert.isTrue(v.isSchema(v.string()));
    assert.isFalse(v.isSchema({ kind: "string" }));
    assert.isFalse(v.isSchema(5));
  });

  test("a non-schema argument is refused clearly", func() {
    assert.throws(func() { v.check(5, "x"); }, "must be a validation schema");
    assert.throws(func() { v.array(5); }, "must be a validation schema");
  });
});

finish("validation");
