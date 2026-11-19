# `kernel`

The shared internals of the built-in libraries. **Not importable from MyLang code.**

There is no `core:kernel` module: this directory holds the TypeScript pieces that every
built-in library uses, so that behaviour is defined once instead of being copied from
library to library.

It is documented here because it is the reason the libraries fit together — a `bytes`
value produced by one is understood by all the others, a resource from one releases the
same way as a resource from another, and a type error reads the same whichever library
raised it.

## What is in it

### `buffers.ts` — binary conversion

The one place binary data crosses between the language and the host.

| Function | Purpose |
| --- | --- |
| `toBuffer(value, encoding)` | `bytes`, a buffer, a byte array or a string → a host buffer |
| `toBytes(value, environment)` | host bytes → the language's `bytes` value |
| `unwrapBuffer(value)` | the raw view behind a `bytes` value, or `null` |
| `isBinaryLike(value)` | would `toBuffer` accept it? |
| `isEncoding(value)` / `ENCODINGS` | the supported text encodings |

This is why `fs.readFile(…)` goes straight into `crypto.sha256`, `compress.gzip`,
`archive.zip`, `tcp.write` and `ws.send` with no conversion in between.

### `resource.ts` — owned resources

`createResource(…)` builds the language value for anything that must be released: an open
file, a socket, a server, a watcher, a worker, a child process.

Every resource built this way behaves identically:

- `res.close()` releases it, and calling it twice is not an error;
- `res.closed` says whether it has been released;
- `symbol.dispose` is set, so `defer` releases it whichever way the block ends;
- closing may suspend, so `wait spawn res.close()` works.

A resource may also declare what it counts against, with `counts`:

```ts
const built = createResource({
  name: "Socket",
  counts: "connection",     // "file" | "connection" | "task" | "worker"
  ...
});
```

The slot is taken **before** the value is built and given back when it closes, so
`--max-open-files` and `--max-connections` count what a program is actually holding. If the
slot cannot be taken, the resource's own `close` is called before the refusal is raised, so
a refused socket is not left bound and unreachable.

`library/net/socket` is built on top of this: one socket implementation shared by `tcp`,
`tls` and `ws`, so a value from any of them reads and writes the same way. See its own
README.

### `async.ts` — non-blocking host bridges

The only way a library should wait for the host.

| Function | Purpose |
| --- | --- |
| `fromCallback(register)` | park until a Node-style `(error, value)` callback fires |
| `fromEvent(emitter, event, errorEvent)` | park until an event arrives |
| `collectStream(stream)` | read a stream to the end without blocking |
| `writeStream(stream, chunk)` | write and park until it is flushed |

A library that calls a `*Sync` host function blocks the whole program however it is
spawned. These helpers exist so that never has to happen.

### `validate.ts` — argument checking

`assertString`, `assertNumber`, `assertInteger`, `assertBoolean`, `assertArray`,
`assertObject`, `assertFunction`, `assertBinary`, `assertEncoding`, `assertPort`,
`splitOptional`.

Every library funnels through these, so the wording of a type error is identical whichever
library produced it.

### `index.ts`

Re-exports all of the above, plus the `security` context that carries the permission
policy.

## How a library uses it

`FunctionBuilder` — the base class every built-in library extends — exposes the kernel as
protected methods, so a library gets them for free:

```ts
class ReadFile extends FSMethodBuilder {
  override *call(): Gen<any> {
    const [filePath] = this.args;

    this.assertString(filePath, "path");      // validate.ts
    this.checkPermission("read", filePath);   // security

    const data = yield hostAwait(fsp.readFile(filePath));   // async.ts

    return this.toBytes(data);                // buffers.ts
  }
}
```

## Notes

- Adding a built-in library means extending `FunctionBuilder` and reaching for these
  helpers rather than writing new conversion, validation or resource code.
- `library/FunctionBuilder.ts` is where the protected wrappers live.
