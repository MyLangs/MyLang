# `net/socket`

The socket every network library hands back.

This is not a library you import. It is the shared implementation behind the sockets
returned by `tcp.connect`, `tcp.connectUnix`, `tcp.listen().accept()`, `tls.connect` and
`ws` — written once here so that all of them read and write the same way.

## Why it exists

`tcp` and `tls` differ in how a connection is *established*: one opens a plain socket, the
other performs a handshake and verifies a certificate. Once established they are the same
thing — a stream of bytes with a queue in front of it — so the reading, the writing, the
buffering, the release and the counted slot live in this one place.

The result is that any code taking a socket works with all of them:

```ml
func readHeader(socket) {
  return socket.readExactly(4);
}

readHeader(tcp.connect("example.com", 80));              // plain
readHeader(tls.connect("example.com", 443));             // encrypted
readHeader(tcp.connectUnix("/tmp/app.sock"));            // a file
```

## What every socket has

| Method | Suspends | Description |
| --- | --- | --- |
| `read(n)` | yes | the next chunk, at most `n` bytes; empty once the peer closes |
| `readExactly(n)` | yes | exactly `n` bytes, or an error if the peer closes first |
| `readAll()` | yes | everything until the peer closes its side |
| `write(data)` | yes | send bytes or text; returns how many bytes |
| `end()` | yes | stop sending, keep reading |
| `close()` | yes | release the socket (idempotent) |
| `buffered()` | — | bytes that arrived and are not read yet |
| `ended()` | — | has the peer closed its side? |
| `closed` | — | field: has this socket been closed? |
| `setTimeout(ms)` | — | idle timeout |
| `setNoDelay(on)` | — | disable Nagle's algorithm |
| `setKeepAlive(on, delay)` | — | probe an idle peer after `delay` ms |
| `address()` | — | `{host, port}`, or `{path}` for a unix socket |

A `tls` socket adds `protocol()`, `cipher()`, `alpn()`, `peerCertificate()` and
`authorized()` on top of these.

## Reading, in detail

Data arrives in whatever pieces the network delivers, so `read()` returns what is there
rather than what the peer sent in one `write`. The socket keeps a queue: bytes that arrive
before anything asks for them are held, and `buffered()` says how many are waiting.

- `read()` — everything queued, or parks until something arrives
- `read(n)` — at most `n` bytes from the front of the queue
- `readExactly(n)` — parks until exactly `n` bytes have arrived; errors if the peer closes
  first, so a truncated message is reported rather than silently short
- `readAll()` — parks until the peer closes, then everything

`readExactly` is what framed protocols are built on: read a fixed-size header, decode a
length from it with `binary`, then read exactly that many bytes.

## Resources and counting

Every socket carries `symbol.dispose`, so `defer` releases it however the block ends, and
`close()` is idempotent. Each one also holds a slot counted against `--max-connections`,
returned when it closes — which is why releasing them matters under a limit and why
`defer` is the habit worth keeping.

## Suspension

Every method marked "suspends" parks the calling task and lets every other task run. You
write the calls normally; `wait` is not a prefix. Use `spawn` when you want the waiting to
overlap with other work:

```ml
var reading = spawn socket.readAll();

doSomethingElse();

var done = wait reading;
var body = done.result;
```
