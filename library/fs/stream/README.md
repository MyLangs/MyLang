# `fs/stream`

Reading and writing files in pieces, for data too large to hold in memory.

```ml
import "core:fs/stream";
```

Where `fs.readFile` gives you the whole file at once, a stream hands it to you chunk by
chunk, so a multi-gigabyte file costs a buffer rather than a copy of the file.

## Suspension

Streams are event-driven: you attach handlers and the host calls them as data arrives.
Those calls are immediate; the work happens in your handlers.

| Method | Suspends | Description |
| --- | --- | --- |
| `stream.ReadableStream(path, options)` | — | open for reading |
| `stream.WritableStream(path, options)` | — | open for writing |
| `stream.TransformStream(options)` | — | a stream you feed and read |
| `s.on(event, handler)` | — | add a listener |
| `s.once(event, handler)` | — | add a one-shot listener |
| `s.read(size)` | — | take what is buffered, or `nil` |
| `s.write(data)` | — | queue a chunk; `false` means the buffer is full |
| `s.end(data)` | — | finish writing |
| `s.pipe(destination)` | — | send everything to another stream |
| `s.pause()` / `s.resume()` | — | control the flow |
| `s.destroy()` | — | drop it immediately |
| `s.close()` | — | close it |
| `s.readable()` / `s.writable()` | — | current state |
| `s.path()` | — | the file it is attached to |

Events: `"data"`, `"end"`, `"error"`, `"close"` for readable streams; `"drain"`,
`"finish"`, `"error"`, `"close"` for writable ones.

## Permissions

`ReadableStream` needs `--allow-read`; `WritableStream` needs `--allow-write`.

## Resources

Both stream kinds carry `symbol.dispose`. Disposing a **writable** stream waits for the
data to be flushed, so the file is complete by the time the block returns:

```ml
func writeReport(path, rows) {
  var out = defer stream.WritableStream(path);

  for (var row in rows) { out.write(row + "\n"); }
  // flushed and closed here, even if something above threw
}
```

## Examples

### Reading a large file piece by piece

```ml
import "core:fs/stream";

var lines = 0;
var input = defer stream.ReadableStream("huge.log");

input.on("data", func(chunk) {
  lines += strings.count(chunk.toString(), "\n");
});

input.on("end", func() {
  coreio.print("lines:", lines);
});
```

### Copying without loading the file

```ml
var input = stream.ReadableStream("big.bin");
var output = stream.WritableStream("copy.bin");

input.pipe(output);

output.on("finish", func() { coreio.print("copied"); });
```

### Writing as results come in

```ml
var out = defer stream.WritableStream("results.csv");

out.write("name,score\n");

for (var row in rows) {
  out.write($"{row.name},{row.score}\n");
}
```

## Notes

- A chunk arrives as `bytes`, so `.toString()` gives you text and the chunk itself goes
  straight into `compress`, `crypto` or a socket.
- `write` returning `false` means the buffer is full; wait for `"drain"` before writing
  more if you are producing data faster than the disk takes it.
- For a file that fits in memory, `fs.readFile` is simpler and already non-blocking.
