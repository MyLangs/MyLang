# `bytes`

Binary data.

```ml
import "core:bytes";
```

`bytes` is the value every library in the ecosystem uses for binary data. What
`fs.readFile` returns goes straight into `crypto`, `compress`, `archive`, `tcp`, `udp`,
`ws` and `binary` without conversion, in both directions.

## Suspension

Everything here is in-memory work: **every method returns immediately.**

## Creating

| Method | Suspends | Description |
| --- | --- | --- |
| `bytes.Bytes(source, encoding)` | — | from a string, a number (size), an array or another `bytes` |
| `bytes.ByteArray(…)` | — | a mutable byte array |
| `bytes.alloc(size, fill, encoding)` | — | zeroed (or filled) bytes |
| `bytes.allocUnsafe(size)` | — | uninitialised, for buffers you fill immediately |
| `bytes.allocUnsafeSlow(size)` | — | the same, outside the shared pool |
| `bytes.concat([…], totalLength)` | — | join several values |

## Inspecting and transforming

A `bytes` value answers:

| Method | Suspends | Description |
| --- | --- | --- |
| `b.length` | — | size in bytes (a field) |
| `b.get(index)` / `b.set(index, value)` | — | one byte |
| `b.slice(start, end)` | — | a copy of a range |
| `b.subarray(start, end)` | — | a view of a range |
| `b.toString(encoding)` | — | decode as text (`"utf8"` by default) |
| `b.decode(encoding)` | — | the same |
| `b.indexOf(value, from)` | — | find a byte, a string or another `bytes` |
| `b.includes(value)` | — | is it there? |
| `b.fill(value, start, end)` | — | a copy with a range filled |
| `b.toArray()` | — | an array of numbers |
| `b.toArrayBuffer()` | — | the raw buffer |

## Module functions

| Method | Suspends | Description |
| --- | --- | --- |
| `bytes.is(value)` | — | is this binary data? |
| `bytes.byteLength(value, encoding)` | — | how many bytes a value takes |
| `bytes.compare(a, b)` | — | ordering, like a sort comparator |
| `bytes.equal(a, b)` | — | same contents? |
| `bytes.join([…], separator)` | — | join with a separator |
| `bytes.trim` / `trimLeft` / `trimRight` | — | drop padding bytes |
| `bytes.isEncoding(name)` | — | is this encoding supported? |

Encodings: `utf8`, `ascii`, `latin1`, `binary`, `hex`, `base64`, `base64url`, `ucs2`,
`utf16le`.

## Examples

### Text in and out

```ml
import "core:bytes";

var data = bytes.Bytes("hello");

coreio.print(data.length);              // 5
coreio.print(data.toString("hex"));     // 68656c6c6f
coreio.print(bytes.Bytes("68656c6c6f", "hex").toString());   // hello
```

### Moving between libraries

```ml
import "core:fs";
import "core:crypto";
import "core:compress";

var file = fs.readFile("data.bin");        // bytes

coreio.print(crypto.sha256(file));          // takes bytes
fs.writeFile("data.bin.gz", compress.gzip(file));   // returns bytes
```

### Building a buffer

```ml
var header = bytes.alloc(4);

header.set(0, 0xCA);
header.set(1, 0xFE);

var message = bytes.concat([header, bytes.Bytes("payload")]);
```

### Searching

```ml
var haystack = bytes.Bytes("GET /index.html HTTP/1.1");

coreio.print(haystack.indexOf(" "));       // 3
coreio.print(haystack.includes("HTTP"));   // true
```

## Notes

- `bytes.Bytes(10)` makes ten zero bytes; `bytes.Bytes("10")` makes two bytes of text.
- `slice` copies, `subarray` does not: writing through a subarray is visible in the
  original.
- For typed reads and writes (integers, floats, varints), use `binary`, which puts a
  cursor and typed accessors on top of a `bytes` value.
