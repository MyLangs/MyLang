# Changelog

## 2.3.0

A tooling and finishing release. The language gains two small pieces of syntax; the
command line gains a formatter and a switch for colour; `iter` gets the half of its API it
had only ever documented; and the integration tests that weave the libraries together found
four bugs, all fixed here.

### Highlights

| | |
| --- | --- |
| **`mylang prettier`** | A formatter for the language. Settings in `mylang.json`, `--check` for CI, `--write` to fix, `--stdin` for editors. Streams every file. Changes only whitespace, and `--verify` proves it. |
| **`--no-colors`** | One switch, every command, every source of colour — the program's own output included. |
| **`func [symbol.dispose]()`** | A struct declares its disposer (and its iterator) in its own body. |
| **`obj.x++`** | `++` and `--` on members, indexes and statics. |
| **`iter`, finished** | `map`, `filter`, `take`, `skip`, `toArray`, `forEach`, and custom iterables everywhere. |
| **Quiet servers** | `onError` and `logErrors`; a client that hangs up is no longer a stack trace. |

### The formatter: `mylang prettier`

- **`mylang prettier [paths...]`** (alias `mylang fmt`) formats `.ml` files. Without a mode it
  prints the result; `--write` rewrites files in place; `--check` and `--list-different`
  change nothing and exit 1 if a file is not formatted; `--stdin` formats standard input to
  standard output. Exit code 2 means something could not be formatted at all.
- **Settings** live in the `"prettier"` section of `mylang.json`: `indent`, `useTabs`,
  `printWidth`, `quote`, `bracketSpacing`, `maxBlankLines`, `endOfLine`, `finalNewline`,
  `include` and `ignore`. Every one has a flag, and a flag beats the file. `--config <file>`
  reads another file, `--no-config` uses the defaults. An unknown option or a bad value is an
  error, never silently ignored.
- **What it does**: indentation from the brackets (one level per line that leaves brackets
  open, however many), continuation lines one level deeper, the space between every two
  tokens, blank lines (none at the edges of a block, at most `maxBlankLines` in a row),
  quotes (the configured one, unless the other needs fewer escapes), and lines over
  `printWidth` broken at the commas of a bracket that opens and closes on them.
- **It only moves whitespace.** No token is ever added, removed or reordered, so a formatted
  program does exactly what it did before. `--verify` re-lexes every result with the
  interpreter's own lexer and refuses any file whose tokens would differ.
- **It streams.** A file is read, tokenized, formatted and written in pieces; what is held
  at once is one line of tokens. A 58 MB file formats with the heap limited to 48 MB.
  `--write` goes through a temporary file renamed over the original only when something
  changed, so an interrupted run or a file with a syntax error never leaves a half-written
  original behind.
- **It lives in `prettier/`** at the root, with its own [README](prettier/README.md):
  `tokenizer.ts` (a chunked tokenizer that takes its operator list from the lexer itself),
  `formatter.ts`, `index.ts` (a Node `Transform` stream and the file functions),
  `options.ts` and `cli.ts`.
- **`mylang init`** asks whether to add formatter settings (`-y` adds them, `--no-prettier`
  does not), writes every option out in `mylang.json`, and adds `format` and
  `format:check` scripts.

### Colour: `--no-colors`

- **`--no-colors`** (or `--no-color`), accepted by every command, before or after it, turns
  colour off for the whole run: the CLI, the test runner, warnings, errors, every library,
  and what the program itself prints — colour codes are removed from standard output and
  standard error on the way out, even ones a program built by hand. Workers and child
  processes inherit the switch.
- **Colour functions return plain text.** `utils/colors` and `coreio.colorize` return the
  text unchanged and `colors.enabled()` is `false`. The first time one is asked for colour, a
  single `ColorsDisabled` warning (`WARN004`) says why — once per run, so a loop that colours
  every line does not repeat it.
- `NO_COLOR` keeps its meaning: the CLI and test runner stop colouring their own output.
  Setting it no longer also sets `FORCE_COLOR`, which made Node warn in every child process.

### Language

- **A struct declares its symbol members.** `func [symbol.dispose]() { ... }` and
  `func [symbol.iterator]() { ... }` may now be written in a struct body, where previously
  the member had to be assigned in `init` because a struct body took identifier names only.
  The disposer is an ordinary method: `this` is the instance, it reaches the struct's
  `private` members, it may call the struct's other methods and it may suspend.

  The brackets hold an expression, evaluated once per instance, and it has to come out as
  one of the two protocol symbols. The parser refuses `private` and `static` on such a
  member — a symbol is not a name `private` could hide, and a protocol belongs to the
  instance rather than to the type — and refuses a bracketed *field*. Instantiation refuses
  a bracketed name that is not a protocol symbol, and the same symbol declared twice.

  Assigning the member in `init` keeps working and means the same thing, which is still the
  way to choose a disposer at run time.
- **`++` and `--` on a member.** `o.n++`, `items[i]--`, `this.count++`, `Counter.created++`.
  Postfix, like the bare-name form: the value is the one before the step. The step goes
  through the same path as `+= 1`, so `readonly`, `const`, enum members and `private` and
  `static` struct members are enforced exactly as for an assignment. The object and the
  index are evaluated once: `next().count++` calls `next` once.

### Libraries

- **`iter` has the functions it documented.** The README promised `map`, `filter`, `take`,
  `skip`, `toArray` and `forEach` and none of them existed. They do now — as functions that
  take the sequence first, like everything else in the language (`iter.take(iter.count(), 3)`),
  not as methods chained on an iterator. `map`, `filter`, `take` and `skip` are lazy: `take`
  stops asking an endless source once it has enough.
- **`iter` accepts custom iterables.** Every `iter` function now takes a value that
  implements `symbol.iterator` in the language — an object with `[symbol.iterator]`, or a
  struct that declares it — calling its `next` as the language function it is. Before, a
  struct was refused, and a plain object with the symbol was walked as key/value pairs,
  disagreeing with `for … in`.
- **`iter` steps may suspend.** A callback given to `map`, `filter`, `takeWhile` and the rest
  may wait, sleep or use a channel; other tasks keep running.
- **`iter` iterators keep one state.** `next()`, `for … in` and every function now read
  from the same source. Before, an iterator's `for … in` restarted from the beginning
  whatever `next()` had already taken, and `count`, `cycle` and others kept two unrelated
  positions.
- **`net/http` servers report errors in one place.** A server used to `console.error` every
  error with its full stack — a client that hung up, a port scanner, a body over the limit —
  and the program could neither see nor silence it. Now `onError: func(event) { ... }`
  receives each one as a value (`kind`, `status`, `method`, `path`, `code`, `message`) on its
  own task and nothing is printed; without it only the server's own failures (the server
  itself, a 5xx) are printed, one line each; `logErrors: true` / `false` prints all or none.

### Fixed

- **`typeof` on a member took the whole expression.** `typeof o.n + " tail"` answered
  `"string"` — the type of the concatenation — because the member chain finished by handing
  the rest of the expression to the expression parser, which put `o.n + " tail"` under the
  `typeof`. A bare name (`typeof n + " tail"`) was already right, so the two disagreed.
  `typeof` now takes the member chain and nothing more. `in` keeps the precedence it had.
- **A struct's `this` changed identity while the instance was built.** Every field and
  method was added by replacing `this` with a fresh copy, so anything that captured `this`
  in `init` — `var self = this`, `this.me = this`, a closure stored on the instance — held
  a discarded copy: unequal to the instance the caller got, missing the methods added after
  it, and writes through it went nowhere. The instance is now one object, filled in place.
  As a side effect a struct's fields are listed in the order they are declared, not reversed.
- **A value that cannot convert itself reported a host crash.** `"size: " + data` and
  `$"{data}"` on a `bytes` value, a `time.Duration`, a `time.Stopwatch` or a parsed url
  failed with `Class constructor toString cannot be invoked without 'new'`, which names
  nothing in the program. The binary operators and string interpolation now say which
  operand it was and that its form has to be asked for. `==` and `!=` still compare such
  values structurally.
- **`url.URL(url.format(parts))` failed.** `format` returns a URL, and `URL` handed it to the
  host as it was, which failed with the same class-constructor message. `URL` now accepts a
  URL this library made, and anything else that is not text gets a clear error.

### Tests

2085 tests, up from 1919. In the language itself, as always:

- **Integration** — four suites weaving the libraries into each other: text and binary
  codecs across seams (`encoding-chain`), one value carried through a chain of libraries
  (`library-mesh`), struct-owned resources against native ones (`struct-resources`), and
  files sent over HTTP and HTTPS, including a self-signed certificate, a 3 MB upload,
  digests checked on arrival and every way a transfer can fail (`file-transfer`).
- **Language** — `update` covers `++` and `--` on members.
- **`iter`** — the new functions, custom iterables, and steps that suspend.
- **Tools** — a new `test/tools` section runs the real `mylang` command line as a child
  process: the formatter (output, modes, file selection, settings, errors, an 8 MB file
  under a 32 MB heap), `--no-colors` across every source of colour, server error reporting,
  and `mylang init`.
- `npm run check:prettier` proves the formatter's promises on every `.ml` file and every
  documented example; `npm run check:prettier:suite` formats the whole test suite and runs
  it.

## 2.2.0

A security, concurrency and library release. Nothing in the language itself changed: the
same syntax, the same `function*`/`yield*` execution, the same cooperative scheduler. What
changed is what a program is allowed to do, what it can do without blocking, and how much
of it can be done without holding everything in memory.

### Language

- **`core:` imports.** Built-in libraries are imported as `core:fs`, `core:tcp` and so on,
  which separates them from a file of your own that happens to share the name.
- **`private` and `static` struct members.** A `private` member is reachable only from
  inside the struct; a `static` one belongs to the struct rather than to an instance.
  Neither involves inheritance, which the language still does not have.
- **`defer` and `symbol.dispose` were rebuilt.** Deferred work now runs in reverse order of
  registration, survives `break`, `continue`, `return` and a thrown error, and runs while a
  task is being cancelled. Releasing a resource twice is not an error.

### Security

A program is unrestricted until the first `--allow-*` flag appears; from then on everything
is denied unless granted, and a `--deny-*` always wins.

- `--allow-read`, `--allow-write`, `--allow-net`, `--allow-env`, `--allow-sys`,
  `--allow-process` and `--allow-worker`, each able to name what it allows.
- `--max-memory` and `--timeout`, plus `--max-open-files`, `--max-connections`,
  `--max-tasks` and `--max-workers`.
- `mylang.lock` records the hash of every remote `import`, so a dependency cannot change
  underneath a program that already ran. `--frozen` refuses a url that is not recorded.

Five ways around the sandbox were found and closed, each verified with the program that
exploited it:

- **Symlinks.** `--allow-read=./data` with a link inside `./data` pointing at `/etc/passwd`
  read the file. Grants and targets are now resolved through their links before comparison.
- **`import`.** Importing a file or a `.json` read it without any read permission; a remote
  `import` reached the network without any net permission. Both are checked now.
- **Memory.** `--max-memory` counted only the heap, so a program holding 400 MB of binary
  buffers sat under a 256 MB limit. Buffers count, and a large allocation is refused before
  it is made rather than after.
- **`os` and `os/system`.** `--allow-env` and `--allow-sys` were documented but never
  enforced. Every variable read and every machine query is checked as it happens.
- **Worker policies.** A thread was given a policy collapsed to one boolean per kind, which
  either lost a path-scoped grant entirely or widened it to the whole disk. The grants cross
  intact.

Reaching a limit no longer drops a program on the spot: every live task is unwound, so
`defer` and `symbol.dispose` run — a buffered file is flushed, a socket closed, a child
killed. Cleanup that suspends gets a short grace period; cleanup that will not finish is cut
off rather than left to hold the program open.

### New libraries

`dns`, `tcp`, `tls`, `udp`, `ws`, `archive`, `compress`, `workers`, `binary`, `validation`,
`process` — and `test`, which moved out of `test/lib` into the language with a
`mylang test` command.

`tcp`, `tls` and `ws` hand back the same socket, implemented once in `net/socket`, so code
that takes a socket works with any of them.

### Data larger than memory

The whole-value functions hold their input and output at once, which a large file cannot
satisfy. These do not:

- `compress.file(kind, src, dest)` and `compress.stream(kind)`
- `archive.extractFile(archive, destination)` and `archive.createFile(dir, archive, format)`
- `crypto.hashFile(path, algorithm)` — which despite its name used to read the whole file
- `process.pipeline(stages)` — the shell's `a | b | c`, with each stage feeding the next

An 82 MB tree packed, compressed, hashed, served and unpacked finishes under
`--max-memory=96MB`; the whole-value equivalents need 256 MB.

Archives written this way are ordinary archives. `tar` long names travel in PAX extended
headers, and a zip carries a zip64 end record past 65,535 entries or 4 GB — in both cases
only when needed, so a small archive stays readable by anything. The system `tar` and
`unzip` read what comes out, byte for byte.

### Threads

- `workers.pool(file, size)` creates its threads once and hands each one job at a time.
  Hashing 16 files on a pool of four took 182 ms against 678 ms for a thread per file.
- `bytes` can cross a worker boundary at all, which it could not before. By default it is
  copied; `post(value, { transfer: true })` hands the memory over instead, which costs
  nothing however large it is and leaves the sending side without the bytes — and saying so
  plainly if it touches them again.
- `mylang test --jobs=N` runs test files on separate threads, under the same policy as the
  run that started them. The suite goes from 18.5 s to 12.3 s on four threads.

### Performance

20–30% off the interpreter's hot paths, by removing work that was repeating for no reason
rather than by changing the design. `docs/PERFORMANCE.md` has the profiles and the
measurements, and `perf/` has the programs.

- An integer or float literal was re-parsed from its text on every evaluation — underscores
  stripped, a regular expression tested — to reach the same answer. Now once, at parse time.
- Every assignment rebuilt its scope's whole variable table, so the cost grew with the
  number of variables in scope and each assignment allocated an object for the collector.
- Every block allocated a list for deferred work whether or not it deferred anything, and a
  loop body is a block.

Tight loops −21%, member reads −20%, calls −21%, constant expressions −30%, garbage
collection from 14% of a loop's time to 9.4%.

### Integration tests, and what they found

`test/integration/` is five files that exercise the seams rather than the libraries: data
moving between libraries, concurrency across them, resources and permissions, protocols
built from several at once, and language features meeting library values. 83 tests, run by
`node index.js` and `mylang test` with everything else.

They were written to find things, and they did:

- **`crypto.base64Decode`, `hexDecode` and `decrypt` destroyed binary data.** Each returned
  a UTF-8 string, so every byte that is not valid UTF-8 came back as U+FFFD — five bytes
  could return as eleven. Encrypting a key, a certificate or an image and decrypting it did
  not give it back. All three now return `bytes`; text round trips through `.toString()`.
- **A binary HTTP body could not be sent or received.** The client declared any body as
  JSON, and a `bytes` value stringified to `{"length":14}` because its data is not an
  enumerable property, so the payload vanished; once that was fixed the host refused the
  value, and once that was fixed the server handed the program a byte-indexed object. A
  binary body is now sent as `application/octet-stream` and arrives as `bytes`.
- **Two modules with the same file name collided** with "X has been initialized", which
  says nothing about the cause or the cure. The error now names the clash and suggests the
  alias that resolves it.

They also confirmed what should hold and might not have: a `bytes` value from any library
is accepted by every other; `length()`, `.length`, `fs.stat().size()` and
`binary.sizeOf()` agree; `crypto.hashFile` and `crypto.hash` agree on the same file;
streaming and whole-value forms of `compress` and `archive` produce interchangeable
results; work in three different libraries really overlaps on one thread; a channel carries
values from a file reader to a hasher; cancelling a task unwinds through a library call and
its `defer` still runs; a counted slot comes back after 60 opens and closes in a loop; a
message split across two writes is reassembled by `readExactly`; and a struct can own a
resource released by `defer`.

### Fixes

- `length(data)` on a `bytes` value counted its methods rather than its bytes.
- `workers.start(...)` followed by `result()` hung for ever when a message was waiting: the
  wait returned immediately, spinning without ever letting the host deliver the reply.
- A remote `import` never worked — the response body was read as `[object Object]`.
- `tcp.isPortFree` parked for ever when the port was free, which is the case it exists for:
  it waited for its probe's `close` event before anything asked the probe to close. Its test
  was called "answers both ways" and only ever checked one.
- An `http` server that could not bind printed the problem and carried on, so the program
  believed it had a server and the only sign was the exit code. `listen` now parks until the
  port is bound, raises a catchable error if it cannot be, and returns `{port, host,
  protocol}` — the only way to learn the port when binding to port 0.
- An `http` server kept its `SIGTERM` and `SIGINT` handlers after being closed, and the
  handler, finding no server left to close, swallowed the signal: the process could then
  only be killed by force.
- Releasing an `http` server returned while the host was still closing, so a program that
  gave up a port and bound it again could be refused for a port it no longer held.
- `http.Server()` warned about a missing `public/` directory that nobody had asked for. A
  directory the program names and does not have is now an error; the default's absence is
  not worth a word.
- A broken pipe — `grep -q`, `head -n 1`, anything that stops reading its input — ended the
  whole program instead of being absorbed the way a shell absorbs it.
- A counted resource that failed to get its slot could be left open and unreachable; the
  slot is now released, and the resource closed, before the refusal is raised.
- `iter.enumerate` was documented as yielding a pair and yields `{index, value}`; a parsed
  URL's members are calls, not fields, and the `net/url` README printed the methods
  themselves; `objects.groupBy` takes an object, not a list. All three are corrected.
- `os.chdir` on a worker thread reported a host error code. The working directory belongs to
  the process, and it says so.
- A count limit (`--max-open-files`, `--max-connections`, `--max-workers`) was reported and
  then left the process alive, held up by the sockets or files it had already opened: the
  check for which errors must end the run covered the time and memory limits only, and did
  not look through a wrapped error.

### Documentation

Every library has a README marking which of its methods suspend. Three checks in `tools/`
keep them honest, run together by `npm run check:docs`:

- `check-examples.js` — all 293 documented examples parse. It found `(wait task).result`,
  which the language has never accepted.
- `check-suspends.js` — all 335 documented methods against their compiled form. It found
  three wrong columns, all on methods that only look like they wait.
- `check-members.js` — every documented method exists. It found `chan.tryReceive`, which
  never did.

A fourth check **runs** every example that can run — `npm run check:docs:run`, 182 of them —
because parsing proves an example is the right language and only running it proves it is
the right API. It found eight signature mistakes that reading had not: `colors.hex` and
`colors.rgb` with their arguments the wrong way round, `objects.pick` and `omit` given a
list where the keys are separate arguments, `objects.groupBy` given a list when it takes an
object, `counter.add` for what is really `update`, `uuid.namespaceURL` used as a value when
it is a call, `iter.enumerate` documented as yielding a pair when it yields
`{index, value}`, and a `spawn { ... }` block expected to hand back its last expression when
only `return` does that.

The main README is now a reference rather than an overview: every library has a section with
worked examples and the exact command line it needs, there is a section on permissions in
practice — the same program unrestricted, scoped and fenced, with the real refusal messages
— and a cookbook of thirteen whole tasks. Every example in it runs.

Two READMEs documented an API the library does not have, found while testing rather than by
any of the above, and both are rewritten to what the code actually does:

- **`net/http`** described Express: `func(req, res)` and `res.send(...)`. A handler here
  takes one argument, the context: `func(ctx) { ctx.send(...) }`. A client response answers
  through `status()`, `text()` and `json()` rather than `.status` and `.data`.
- **`syncbox`** described `recv`, `tryRecv`, `len` and `isClosed` as `receive`,
  `tryReceive`, `length` and `closed`.

The tests had been using the real API throughout, which is how the difference came to light.
