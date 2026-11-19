# `validation`

Checking that a value has the shape a program expects.

Input that comes from outside — a parsed JSON body, a config file, a form, a message off a
socket — is `nil` or the wrong type far more often than the code written against it
assumes. A schema says what the shape must be, once, and every check reports *which* field
was wrong instead of failing somewhere deep in the program.

```ml
import "core:validation" as v;
```

## Suspension

Every method returns immediately, with one exception: a schema built with
`validation.custom(fn)` calls your function, and `check` / `parse` / `isValid` suspend if
that function does (because it waits, sleeps, or reads a file). You still never write
`wait` in front of the call — use `spawn` only when you want it to overlap other work.

## Building a schema

| Method | Suspends | Description |
| --- | --- | --- |
| `v.string(options)` | — | text, with `min` / `max` length and a `pattern` |
| `v.number(options)` | — | any number, with `min` / `max` |
| `v.integer(options)` | — | a whole number, with `min` / `max` |
| `v.boolean(options)` | — | `true` or `false` |
| `v.enumOf([…], options)` | — | one of a fixed list of values |
| `v.array(items, options)` | — | an array; `items` is the schema for each element |
| `v.object(fields, options)` | — | an object; `fields` maps names to schemas |
| `v.any(options)` | — | anything, including `nil` when optional |
| `v.custom(fn, options)` | — | your own rule |

### Options every schema accepts

| Option | Meaning |
| --- | --- |
| `optional` | the value may be missing |
| `nullable` | the value may be `nil` |
| `fallback` | what a missing optional value becomes |
| `message` | replaces the generated failure text |
| `min` / `max` | length for strings and arrays, value for numbers |
| `pattern` | a regular expression, for strings |
| `strict` | for objects: refuse members the schema does not describe |

## Checking a value

| Method | Suspends | Description |
| --- | --- | --- |
| `v.check(schema, value)` | only with `custom` | `{ valid, value, errors }`; never throws |
| `v.parse(schema, value)` | only with `custom` | the validated value, or throws |
| `v.isValid(schema, value)` | only with `custom` | just the verdict |
| `v.isSchema(value)` | — | was this produced by this library? |

`check` returns every failure, not only the first. Each error carries:

| Field | Meaning |
| --- | --- |
| `path` | where it is, e.g. `"items[2].name"` |
| `message` | what is wrong, e.g. `"must be a string, received int"` |
| `text` | the two joined into one sentence |

## Examples

### An HTTP request body

```ml
import "core:validation" as v;
import "core:net/http";
import "core:json";

var createUser = v.object({
  name:  v.string({ min: 1, max: 64 }),
  email: v.string({ pattern: "^[^@]+@[^@]+$" }),
  age:   v.integer({ min: 0, max: 130, optional: true }),
  role:  v.enumOf(["admin", "user"], { optional: true, fallback: "user" })
});

var server = http.Server();

server.post("/users", func(req, res) {
  var result = v.check(createUser, req.body);

  if (!result.valid) {
    return res.status(400).json({ errors: result.errors });
  }

  var user = result.value;      // `role` is filled in, every field is the right type
  res.json({ created: user.name, role: user.role });
});

server.listen(8080);
```

### Validating a config file

```ml
import "core:validation" as v;
import "core:fs";
import "core:json";

var config = v.object({
  port:    v.integer({ min: 1, max: 65535 }),
  host:    v.string({ fallback: "127.0.0.1", optional: true }),
  workers: v.integer({ min: 1, max: 64, optional: true, fallback: 4 })
}, { strict: true });

var settings = v.parse(config, json.parse(fs.readFile("config.json").toString()));
```

### Your own rule

```ml
var evenPort = v.custom(func(n) {
  if (n % 2 == 0) { return true; }
  return "must be an even port number";
});

coreio.print(v.check(evenPort, 8081).errors[0].message);   // must be an even port number
```

### Nested shapes

```ml
var order = v.object({
  id: v.string(),
  lines: v.array(
    v.object({ sku: v.string(), quantity: v.integer({ min: 1 }) }),
    { min: 1, max: 100 }
  )
});
```

## Notes

- A schema is an ordinary value: store it in a variable, export it from a module, nest it
  inside another schema.
- `strict: true` is worth setting for anything that comes from outside — it catches a typo
  in a field name instead of silently ignoring it.
- `v.parse` is the right call when a failure should stop the work; `v.check` when you want
  to report every problem back to whoever sent the data.
