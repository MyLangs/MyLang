# `binary`

Reading and writing structured binary data.

`bytes` holds binary data; `binary` gives it a cursor and typed accessors. That is what
parsing a file header, decoding a record, or framing a network message actually needs.

```ml
import "core:binary";
```

## Suspension

Nothing in this library touches the outside world, so **every method returns immediately**.
There is nothing to `wait` for, and `spawn` buys you nothing here.

> **How `wait` works in MyLang2.** A call that suspends (`fs.readFile`, `tcp.connect`,
> `compress.gzip`) is written like any other call — you never write `wait` in front of it.
> `wait` goes with `spawn`, which is how you overlap work:
> `var task = spawn fs.readFile(p); ...; var r = wait task;`

## Reading

`binary.reader(source, endian)` — `source` is anything binary (a `bytes` value, a string, a
byte array, a buffer). `endian` is `"be"` (default) or `"le"`.

| Method | Suspends | Description |
| --- | --- | --- |
| `r.u8()` / `r.i8()` | — | one unsigned / signed byte |
| `r.u16()` / `r.i16()` | — | two bytes |
| `r.u32()` / `r.i32()` | — | four bytes |
| `r.u64()` / `r.i64()` | — | eight bytes, as a `bigint` |
| `r.f32()` / `r.f64()` | — | IEEE-754 float / double |
| `r.bytes(n)` | — | `n` bytes as `bytes`; the rest when `n` is omitted |
| `r.string(n, encoding)` | — | `n` bytes decoded as text (`"utf8"` by default) |
| `r.varint()` | — | LEB128 unsigned varint |
| `r.seek(pos)` | — | move the cursor to an absolute position |
| `r.skip(n)` | — | move the cursor forward |
| `r.position()` | — | where the cursor is |
| `r.remaining()` | — | bytes left |
| `r.eof()` | — | is the cursor at the end? |
| `r.length` | — | total size (a field, not a call) |

Reading past the end raises an error naming the offset and the size that was wanted, so a
truncated message is reported where it happens instead of silently decoding as zeros.

## Writing

`binary.writer(endian)` — every write returns the writer, so calls chain.

| Method | Suspends | Description |
| --- | --- | --- |
| `w.u8(v)` … `w.f64(v)` | — | the same set as the reader |
| `w.bytes(v)` | — | append any binary value |
| `w.string(s, encoding)` | — | append text |
| `w.varint(n)` | — | append a LEB128 varint |
| `w.build()` | — | everything written so far, as `bytes` |
| `w.reset()` | — | drop everything written so far |
| `w.length()` | — | bytes written so far |

## Helpers

| Method | Suspends | Description |
| --- | --- | --- |
| `binary.sizeOf(value)` | — | how many bytes a value occupies |
| `binary.concat([a, b, …])` | — | join binary chunks into one `bytes` |
| `binary.hex(value)` | — | lowercase hexadecimal text |
| `binary.fromHex(text)` | — | parse hexadecimal text back to `bytes` |

## Examples

### A length-prefixed message over TCP

```ml
import "core:binary";
import "core:tcp";

func sendMessage(socket, kind, payload) {
  var frame = binary.writer();
  frame.string("ML");           // magic
  frame.u8(kind);
  frame.u32(length(payload));
  frame.string(payload);
  socket.write(frame.build());
}

func readMessage(socket) {
  var head = binary.reader(socket.readExactly(7));

  if (head.string(2) != "ML") { throw "bad magic"; }

  var kind = head.u8();
  var size = head.u32();

  return { kind: kind, body: socket.readExactly(size).toString() };
}
```

### Parsing a file header

```ml
import "core:binary";
import "core:fs";

var r = binary.reader(fs.readFile("image.png"));

var signature = r.bytes(8);
var chunkSize = r.u32();
var chunkType = r.string(4);

coreio.print(chunkType, chunkSize, "remaining:", r.remaining());
```

### Little-endian records

```ml
var w = binary.writer("le");
w.u16(1).u16(2).u16(3);

var r = binary.reader(w.build(), "le");
while (!r.eof()) { coreio.print(r.u16()); }
```

## Notes

- A reader and a writer must agree on endianness; the default is big-endian ("network
  byte order") because that is what most wire formats use.
- 64-bit integers are `bigint` values in and out — the language's `int` cannot hold them.
- `varint` only encodes non-negative numbers, and refuses values too large for a safe
  integer rather than losing precision.
