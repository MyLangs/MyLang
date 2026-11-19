# `ws`

WebSocket clients and servers (RFC 6455).

```ml
import "core:ws";
```

WebSocket is a message protocol: what one side sends as one `send` arrives on the other as
one `receive`, unlike `tcp`, where you have to frame messages yourself.

## Suspension

| Method | Suspends | Description |
| --- | --- | --- |
| `ws.connect(url, options)` | yes | open a client connection (`ws://host:port/path`) |
| `ws.listen(port, host)` | yes | accept connections |
| `socket.send(data)` | yes | text goes out as a text frame, bytes as a binary frame |
| `socket.receive()` | yes | the next message; `nil` once the peer closes |
| `socket.close()` | yes | send a close frame and release the socket (idempotent) |
| `socket.ping(data)` | — | the peer answers with a pong, which the library absorbs |
| `socket.pending()` | — | messages that arrived and are not taken yet |
| `socket.ended()` | — | has the peer closed? |
| `socket.closeCode()` / `closeReason()` | — | why the peer closed |
| `socket.closed` | — | field |
| `server.accept()` | yes | the next connection |
| `server.accept(handler)` | — | run `handler(peer)` for every connection, each on its own task |
| `server.close()` | yes | stop listening (idempotent) |
| `server.pending()` | — | connections waiting |
| `server.port` / `server.host` | — | fields |

A received message is `{ kind, data, text }`:

| Field | Meaning |
| --- | --- |
| `kind` | `"text"` or `"binary"` |
| `data` | the payload as `bytes`, always |
| `text` | the payload as a string for a text message, `nil` for a binary one |

## `wss://`

A `wss://` url connects over TLS, through the `tls` library. Certificates are verified by
default, and the result is checked after the handshake, so a connection that completes has
been verified:

```ml
var socket = defer ws.connect("wss://chat.example.com/room");
```

The TLS options `tls.connect` takes are accepted here too — `ca`, `cert`, `key`,
`servername`, `rejectUnauthorized` — and a certificate may be given inline or as
`{file: "path"}`:

```ml
var socket = defer ws.connect("wss://internal.example.com/feed", {
  ca: { file: "./certs/internal-root.pem" }
});
```

A server serves `wss://` when it is given a certificate and a key; `server.secure` says
which it is:

```ml
var server = defer ws.listen(8443, "0.0.0.0", {
  cert: { file: "./certs/server.pem" },
  key: { file: "./certs/server.key" }
});

coreio.print(server.secure);     // true
```

## Permissions

`connect` and `listen` both need `--allow-net`. A certificate or key given as
`{file: "path"}` is read from disk, so it also needs `--allow-read` for that path:

```
mylang run chat.ml --allow-net=chat.example.com:443
mylang run server.ml --allow-net --allow-read=./certs
```

## Resources

A connection and a server both carry `symbol.dispose`. `defer` sends the close frame and
releases the socket however the block ends:

```ml
func ask(url, question) {
  var socket = defer ws.connect(url);

  socket.send(question);

  return socket.receive().text;
}
```

## Examples

### A chat server

```ml
import "core:ws";

var server = defer ws.listen(8080, "127.0.0.1");

coreio.print($"listening on {server.port}");

server.accept(func(peer) {
  peer.send("welcome");

  while (true) {
    var message = peer.receive();

    if (message == nil) { break; }       // the client went away

    peer.send("you said: " + message.text);
  }
});
```

### A client

```ml
import "core:ws";

var socket = defer ws.connect("ws://127.0.0.1:8080/chat");

socket.send("hello");

while (true) {
  var message = socket.receive();

  if (message == nil) { break; }

  coreio.print(message.kind, message.text);
}
```

### Binary messages

```ml
import "core:ws";
import "core:binary";

var frame = binary.writer();
frame.u8(2);
frame.u32(position);

socket.send(frame.build());               // arrives as kind "binary"

var reply = socket.receive();
var r = binary.reader(reply.data);
```

### Reading and sending at the same time

```ml
var socket = defer ws.connect(url);

var reader = spawn {
  while (true) {
    var message = socket.receive();
    if (message == nil) { break; }
    handle(message);
  }
};

for (var update in updates) {
  socket.send(update);
}

wait reader;
```

## Notes

- Ping and pong are answered automatically, as the protocol requires; `receive()` never
  returns them.
- A close frame from the peer makes `receive()` return `nil` rather than hanging.
- `wss://` goes through the `tls` library, so it gets the same verification by default.
  A self-signed certificate in a test environment needs `rejectUnauthorized: false`,
  which is a deliberate act and not something to leave in production code.
- Large messages are reassembled from continuation frames before `receive()` returns them.
