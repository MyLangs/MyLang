# `tcp`

TCP clients and servers.

```ml
import "core:tcp";
```

## Suspension

Every operation that touches the network suspends the calling task and lets every other
task keep running. That is what makes one program able to hold many connections at once on
the interpreter's single thread.

You write these calls normally — `wait` is not a prefix. Use `spawn` when you want work to
overlap:

```ml
var reading = spawn socket.readAll();
doSomethingElse();

var done = wait reading;
var body = done.result;
```

## Permissions

Both `connect` and `listen` need `--allow-net`. A grant may name hosts and ports:

```
mylang run app.ml --allow-net=api.example.com:443,127.0.0.1:8080
```

## Connecting

`tcp.connect(host, port, options)` — `options.timeout` defaults to 30000 ms.

| Method | Suspends | Description |
| --- | --- | --- |
| `socket.read(n)` | yes | the next chunk, at most `n` bytes; empty once the peer closes |
| `socket.readExactly(n)` | yes | exactly `n` bytes, or an error if the peer closes first |
| `socket.readAll()` | yes | everything until the peer closes its side |
| `socket.write(data)` | yes | send bytes or text; returns how many bytes |
| `socket.end()` | yes | stop sending, keep reading |
| `socket.close()` | yes | release the socket (idempotent) |
| `socket.buffered()` | — | bytes that arrived and are not read yet |
| `socket.ended()` | — | has the peer closed its side? |
| `socket.closed` | — | has this socket been closed? (a field) |
| `socket.setTimeout(ms)` | — | idle timeout |
| `socket.setNoDelay(on)` | — | disable Nagle's algorithm |
| `socket.setKeepAlive(on, delay)` | — | probe an idle peer after `delay` ms |
| `socket.address()` | — | `{host, port}`, or `{path}` for a unix socket |
| `socket.remoteAddress` / `remotePort` / `localPort` | — | fields |

## Listening

`tcp.listen(port, host, options)` — port `0` picks a free one, which `server.port` reports.

| Method | Suspends | Description |
| --- | --- | --- |
| `server.accept()` | yes | the next connection |
| `server.accept(handler)` | — | run `handler(socket)` for every connection, each on its own task |
| `server.close()` | yes | stop listening and drop queued connections (idempotent) |
| `server.pending()` | — | connections waiting to be accepted |
| `server.port` / `server.host` | — | fields |
| `server.closed` | — | field |

`tcp.isPortFree(port, host)` **suspends** and answers whether something can bind there.

## Unix domain sockets

A unix socket is a file rather than a host and port: nothing is routed, and two processes
on the same machine talk through the filesystem. Most database servers and service
managers offer one locally, and it is faster than a loopback connection.

| Method | Suspends | Description |
| --- | --- | --- |
| `tcp.connectUnix(path, options)` | yes | connect; returns the same socket as `connect` |
| `tcp.listenUnix(path, options)` | yes | serve on `path`; `options.force` removes a stale path first |
| `server.path` | — | field: the path it is listening on |

Because the socket is a file, the permissions are file permissions and not `--allow-net`:
`connectUnix` needs `--allow-read` for the path, and `listenUnix` needs `--allow-write`,
since binding creates the file. Closing the server removes it.

Without `{ force: true }` an existing path is an error rather than something to take over,
which stops one server from quietly stealing another's socket. Pass it when you know the
path was left behind by a process that did not shut down cleanly.

```ml
var server = defer tcp.listenUnix("/tmp/app.sock", { force: true });

server.accept(func(client) {
  client.write("hello over a file\n");
  client.close();
});
```

```ml
var socket = defer tcp.connectUnix("/var/run/postgresql/.s.PGSQL.5432");
```

### Keeping an idle connection honest

A peer that disappears without closing — a cable pulled, a machine that lost power — leaves
a socket that looks open and never produces anything. `setKeepAlive` asks the system to
probe it, so the socket fails instead of waiting forever:

```ml
var socket = defer tcp.connect("db.internal", 5432);

socket.setKeepAlive(true, 30000);   // probe after 30s of silence
```

## Resources

A socket and a server both carry `symbol.dispose`, so `defer` releases them whichever way
the block ends — including an early `return` or a thrown error:

```ml
func fetch(host, port, request) {
  var socket = defer tcp.connect(host, port);

  socket.write(request);

  return socket.readAll().toString();
  // the socket is closed here, even though the function returned
}
```

`close()` is idempotent, so an explicit `close()` followed by the `defer` is harmless.

## Examples

### A line echo server

```ml
import "core:tcp";

var server = defer tcp.listen(8080, "127.0.0.1");

coreio.print($"listening on {server.port}");

server.accept(func(client) {
  var line = client.read();

  client.write("echo: " + line.toString());
  client.end();
  client.close();
});
```

### A length-prefixed protocol

```ml
import "core:tcp";
import "core:binary";

var socket = defer tcp.connect("127.0.0.1", 9000);

var header = binary.reader(socket.readExactly(4));
var size = header.u32();
var body = socket.readExactly(size);

coreio.print(body.toString());
```

### Handling clients concurrently

`accept(handler)` runs each connection on its own task, so a slow client never holds up
the others:

```ml
var server = defer tcp.listen(0, "127.0.0.1");

server.accept(func(client) {
  var request = client.read().toString();

  wait spawn time.Sleep(1000);      // slow work, other clients keep being served

  client.write("done: " + request);
  client.close();
});
```

### An HTTP request by hand

```ml
var socket = defer tcp.connect("example.com", 80);

socket.write("GET / HTTP/1.0\r\nHost: example.com\r\n\r\n");

coreio.print(socket.readAll().toString());
```

## Notes

- `read()` returns whatever has arrived, which may be less than the peer sent in one
  `write` — TCP is a stream, not a message queue. Use `readExactly` or a framing header
  (see `binary`) when you need message boundaries.
- Writing to a closed socket raises an error rather than failing silently.
- `server.accept()` and `server.accept(handler)` are two styles; pick one per server.
- A unix socket and a TCP socket return the same value, with the same methods, so code
  that takes a socket works with either. Only `address()` differs: a path rather than a
  host and port.
