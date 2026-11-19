# `compress`

gzip, deflate, raw deflate and brotli, over `bytes`.

```ml
import "core:compress";
```

## Suspension

**Every function in this library suspends.** Compression is CPU work that the host runs on
its thread pool, so the calling task parks and every other task keeps running. You write
the call normally; use `spawn` when you want it to overlap with other work:

```ml
var packing = spawn compress.gzip(bigBuffer);
doSomethingElse();

var done = wait packing;
var packed = done.result;
```

## Methods

| Method | Suspends | Description |
| --- | --- | --- |
| `compress.gzip(data, options)` | yes | pack with gzip (a zlib stream plus a gzip header) |
| `compress.gunzip(data)` | yes | unpack gzip |
| `compress.deflate(data, options)` | yes | pack with zlib deflate |
| `compress.inflate(data)` | yes | unpack zlib deflate |
| `compress.deflateRaw(data, options)` | yes | deflate with no header, as ZIP entries use |
| `compress.inflateRaw(data)` | yes | unpack raw deflate |
| `compress.brotli(data, options)` | yes | pack with brotli |
| `compress.unbrotli(data)` | yes | unpack brotli |
| `compress.decompress(data)` | yes | unpack gzip or zlib without being told which |
| `compress.detect(data)` | — | `"gzip"`, `"deflate"` or `"unknown"` |
| `compress.ratio(original, packed)` | — | how much was saved, as a fraction |

`options` accepts `level` (0–9, or 0–11 for brotli), `memLevel` and `windowBits`.

`compress.constants` holds `BEST_SPEED`, `BEST_COMPRESSION`, `DEFAULT_LEVEL` and
`NO_COMPRESSION`.

## Data too large to hold

The functions above take all of the input and return all of the output, so packing a file
needs room for the file and its packed form at once. That is fine for a configuration file
and impossible for a 10 GB log, which is what these two are for.

| Method | Suspends | Description |
| --- | --- | --- |
| `compress.file(kind, source, destination)` | yes | pack or unpack a file on disk; returns bytes written |
| `compress.stream(kind)` | — | a resource you write pieces into and read pieces out of |
| `compress.transforms` | — | the names `kind` accepts |

`kind` is one of `gzip`, `gunzip`, `deflate`, `inflate`, `deflateRaw`, `inflateRaw`,
`brotli`, `unbrotli` — the same transforms as above, named rather than called.

`compress.file` reads, transforms and writes in pieces, so the memory it uses does not
depend on the size of the file:

```ml
compress.file("gzip", "./huge.log", "./huge.log.gz");
compress.file("gunzip", "./huge.log.gz", "./back.log");
```

It needs `--allow-read` for the source and `--allow-write` for the destination.

A stream is for data that arrives in pieces from somewhere else — a socket, a series of
rows you build:

| Method | Suspends | Description |
| --- | --- | --- |
| `s.write(data)` | yes | feed in a piece |
| `s.read()` | — | whatever has come out so far |
| `s.finish()` | yes | flush and return the rest |
| `s.buffered()` | — | bytes ready to be read |
| `s.kind` / `s.closed` | — | fields |
| `s.close()` | yes | release it (idempotent) |

```ml
var packer = defer compress.stream("gzip");

for (var row in rows) { packer.write(row + "\n"); }

var packed = packer.finish();
```

A stream carries `symbol.dispose`, so `defer` releases it however the block ends.

## Examples

### Compressing a file

```ml
import "core:compress";
import "core:fs";

var original = fs.readFile("data.json");
var packed = compress.gzip(original, { level: 9 });

fs.writeFile("data.json.gz", packed);

coreio.print($"saved {compress.ratio(original, packed) * 100}%");
```

### Unpacking whatever arrives

```ml
var body = socket.readAll();

if (compress.detect(body) != "unknown") {
  body = compress.decompress(body);
}
```

### Packing a file larger than memory

```ml
import "core:compress";

// the limit applies to the program, not to the file: nothing holds the whole thing
compress.file("gzip", "./access.log", "./access.log.gz");
```

```
mylang run pack.ml --allow-read=./access.log --allow-write=. --max-memory=64MB
```

### Compressing as data arrives

```ml
import "core:compress";
import "core:tcp";

var packer = defer compress.stream("gzip");
var socket = defer tcp.connect("logs.internal", 9000);

for (;;) {
  var chunk = socket.read();

  if (length(chunk) == 0) { break; }

  packer.write(chunk);
}

fs.writeFile("./collected.gz", packer.finish());
```

### Packing several files at once

Because every call suspends rather than blocks, the packing overlaps:

```ml
import "core:compress";
import "core:fs";

var jobs = [];

for (var name in fs.readdir("./logs")) {
  jobs[length(jobs)] = spawn compress.gzip(fs.readFile("./logs/" + name));
}

var results = wait.all(jobs);
```

## Notes

- Input may be a `bytes` value, a string, a byte array or a buffer; output is always
  `bytes`, so it goes straight into `fs.writeFile`, `tcp.write`, `ws.send` or `archive`.
- Compressing already-compressed data (a JPEG, a ZIP) usually makes it slightly bigger;
  `compress.ratio` will tell you.
- `detect` recognises gzip and zlib headers. Raw deflate and brotli carry no header, so
  they cannot be detected — unpack those with the matching function.
- Use `compress.gzip` for data already in hand and `compress.file` for data on disk. The
  whole-buffer form under a memory limit fails on a file that does not fit, which is the
  limit doing its job — reach for `file` or `stream` rather than raising the limit.
- Writing to a stream after `close()` is an error rather than silence.
