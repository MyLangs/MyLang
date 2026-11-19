# `tools`

Checks that keep the documentation honest. Both read the compiled interpreter, so run
`npm run build:test` first.

```bash
node tools/check-examples.js        # every documented example parses
node tools/check-suspends.js        # every "Suspends" column matches the code
node tools/check-members.js         # every documented method exists
node tools/check-examples-run.js    # every example that can run, does
```

The first three are quick and run as `npm run check:docs`. The fourth actually executes
the examples, so it takes a few minutes; it is `npm run check:docs:run`, and
`npm run check` does all of it after the tests.

Both exit non-zero when something is wrong, so they can go in front of a release.

## `check-examples.js`

Extracts every fenced ` ```ml ` block from every markdown file in the repository, lexes and
parses each one, and reports the ones that fail. It does not run them — an example that
needs a network or a file would fail for the wrong reason — so it catches syntax that has
drifted from the language, not behaviour.

It is worth having because a wrong example is actively misleading: `(wait task).result` was
in a README until this check found that the language has never accepted it.

## `check-suspends.js`

Every library README marks each method **yes** or **—** in a *Suspends* column, which tells
the reader whether a call can park their task. That claim is checkable: a method parks if
its compiled `call` reaches one of the coroutine helpers (`hostAwait`, `park`, `sleep`), one
of the kernel's host bridges (`fromCallback`, `fromEvent`, …), or hands back a promise.

Three things it deliberately does not count:

- **Helpers that run a user callback** (`executeCallback`, `lift`, `runHooks`). Whether
  those park is the callback's business, so `arrays.map` is documented as not suspending and
  that is correct.
- **Anything in a nested member class.** `workers.pool` returns a value whose `run` parks;
  building the pool does not.
- **A resource's `close` callback.** That runs when the resource is released, not when it
  is built.

It checks two kinds of row: `lib.method(...)` against the library's exports, and
`value.method(...)` against the members of whatever that library returns. A method written
as several rows — `accept()` parks, `accept(handler)` does not — is right if any of its rows
matches.

It found three wrong columns on its first run, all on methods that only *look* like they
wait: `workers.start`, `process.spawn` and `compress.stream` create something and hand it
back; the waiting is in what you then do with it.

## `check-members.js`

A README documents two kinds of method: the library's own (`tcp.connect`) and those of the
values it hands back (`socket.read`, `ctx.send`, `response.json`). The first kind is checked
against the library's exports by `check-suspends.js`; this checks the second, which is where
documentation drifts furthest, because nothing fails when a README invents a method that was
never written.

It knows names, not which object owns them: a name defined anywhere under `dist/library`
counts, because a value documented by one library is often built by another — `tcp`'s socket
comes from `net/socket`. So it catches an invented name, and not a real name put on the wrong
object.

That limit is worth stating, because both kinds were found here. It caught
`chan.tryReceive`, which never existed. It did not catch `res.send`, because `send` is real —
it just lives on the context rather than on `res`, and the whole of the `net/http` README had
been written against a framework this library is not. The guard for that second kind is the
tests: they exercise the real API, which is how the difference came to light.

## `check-examples-run.js`

Parsing an example proves it is the right language. Running it proves it is the right API —
and that difference is not academic. Every signature mistake found in these documents
parsed perfectly and then failed on the first call:

- `colors.hex("#ff8800", text)` with its arguments the wrong way round
- `objects.pick(o, ["id", "name"])` given a list where the keys are separate arguments
- `chan.receive()` and `chan.length()` for what are really `recv` and `len`
- `counter.add(x)` for what is really `update`
- `uuid.namespaceURL` used as a value when it is a call
- `iter.enumerate` yielding `{index, value}`, not a two-element array
- a `spawn { ... }` block expected to hand back its last expression, when only `return` does
- `objects.groupBy` given a list when it takes an object

Not one of those would have been caught by reading, and none of them was caught by the
other three checks.

A document also names files and hosts to illustrate — `config.json`, `example.com` — which
this machine does not have. That says nothing about whether the call is right, so the
runner skips a block whose failure is `ENOENT`, `ENOTFOUND` or an undefined name the prose
established, and reports only the mistakes that are really in the documentation. It also
skips, by what the prose says beside them: worker bodies, examples that need the outside
world, ones interrupted on purpose by a timeout, ones that wait for console input, and ones
that demonstrate a failure deliberately.
