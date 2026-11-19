# `test`

The built-in test framework.

```ml
import "core:test" as { describe, test, assert, finish };
```

Run tests with the CLI:

```
mylang test                      every *.test.ml under ./test
mylang test path/to/file.test.ml a single file
mylang test ./suite              a directory
mylang test --filter auth        only tests whose full name contains "auth"
mylang test --bail               stop at the first failure
mylang test --verbose            print every test, not only the failures
```

The process exits with code 1 when anything failed, so it drops straight into CI.

## Suspension

| Method | Suspends | Description |
| --- | --- | --- |
| `describe(name, body)` | yes | group related tests; `body` may suspend |
| `test(name, body)` | yes | one test; `body` may suspend |
| `it(name, body)` | yes | the same thing, under the other common name |
| `skip(name, reason)` | — | record a test as skipped |
| `beforeEach(fn)` / `afterEach(fn)` | — | register a hook; the hook itself may suspend |
| `beforeAll(fn)` / `afterAll(fn)` | — | once per `describe` block |
| `assert.throws(fn, text)` | yes | `fn` may suspend |
| `assert.doesNotThrow(fn)` | yes | the same |
| every other `assert.*` | — | immediate |
| `finish(title)` | — | report this file's result |
| `summary()` | — | report the whole run |
| `stats()` | — | `{ passed, failed, skipped, total }` |
| `configure(options)` | — | `verbose`, `color`, `bail`, `filter`, `runner` |
| `reset()` | — | clear the counters |
| `show(value)` / `deepEq(a, b)` | — | the formatter and comparison the assertions use |

A test body is an ordinary function, so it may `wait`, `spawn` or sleep — which is what
makes it possible to test the network and file libraries honestly:

```ml
test("the server answers", func() {
  var server = defer tcp.listen(0, "127.0.0.1");

  server.accept(func(client) { client.write("ok"); client.close(); });

  var socket = defer tcp.connect("127.0.0.1", server.port);

  assert.equal(socket.readAll().toString(), "ok");
});
```

## Assertions

| Assertion | Checks |
| --- | --- |
| `assert.ok(v)` / `assert.notOk(v)` | truthiness |
| `assert.isTrue(v)` / `assert.isFalse(v)` | exactly `true` / `false` |
| `assert.isNil(v)` / `assert.notNil(v)` | `nil` |
| `assert.equal(a, b)` / `assert.notEqual(a, b)` | strict deep equality |
| `assert.typeOf(v, "string")` | the language's own type name |
| `assert.closeTo(a, b, epsilon)` | floating point, within a tolerance |
| `assert.greater` / `greaterOrEqual` / `less` / `lessOrEqual` | ordering |
| `assert.lengthOf(v, n)` | length of a string, array or object |
| `assert.includes(c, x)` / `assert.notIncludes(c, x)` | substring, element or key |
| `assert.throws(fn, text)` | `fn` throws, optionally containing `text`; returns the error |
| `assert.doesNotThrow(fn)` | `fn` does not throw |
| `assert.fail(message)` | fail on the spot |

Every assertion takes a trailing message that is prefixed to the generated one.

Equality is **strict**: the language's `==` is loose (`1 == "1"` is true), so `assert.equal`
compares types first and only treats `int` and `float` as the same family. `bytes` values
compare by content.

## Writing a test file

A test file ends with `finish(name)`, which reports that file's totals when the file is
run on its own, and aggregates when it is part of a larger run.

```ml
import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:strings";

describe("strings: padding", func() {
  var text = "";

  beforeEach(func() { text = "ab"; });

  test("padStart fills on the left", func() {
    assert.equal(strings.padStart(text, 4, "-"), "--ab");
  });

  test("a string already long enough is unchanged", func() {
    assert.equal(strings.padStart(text, 1, "-"), "ab");
  });
});

finish("strings");
```

## Hooks

```ml
describe("a database", func() {
  beforeAll(func() { openConnection(); });
  afterAll(func()  { closeConnection(); });

  beforeEach(func() { startTransaction(); });
  afterEach(func()  { rollback(); });

  test("inserts a row", func() {
    assert.equal(insert({ name: "Ann" }).rows, 1);
  });
});
```

`beforeEach` hooks run outermost-first; `afterEach` hooks run innermost-first. `afterEach`
runs even when the test failed, so cleanup is not skipped.

## Skipping

```ml
skip("needs a live API key", "set API_KEY to run this");
```

Skipped tests are listed in the summary with their reason, so they stay visible instead of
quietly disappearing.

## Running a suite from a file

A file can import several test files and report once, which is what `test/index.ml` in this
repository does:

```ml
import "core:test";

test.configure({ runner: true });

import "./language/defer.test.ml";
import "./library/fs.test.ml";

var failed = test.summary();

if (failed > 0) { os.exit(1); }
```

`runner: true` makes each file's `finish()` aggregate instead of reporting on its own.

## Notes

- Each test's failure message names the full path (`group › subgroup › test`), so a
  failure in a large suite points straight at the test.
- `assert.throws` returns the error it caught, so you can make further assertions on it.
- Colour is on unless `NO_COLOR` is set or `--no-color` is passed.
