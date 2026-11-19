# `tls`

Encrypted TCP: clients and servers over TLS.

```ml
import "core:tls";
```

## Suspension

Connecting, listening, reading and writing all suspend the calling task and let every
other task run. You write the calls normally — `wait` is not a prefix.

## Permissions

`connect` and `listen` need `--allow-net`, exactly like `tcp`. Certificate and key files
given as `{file: "path"}` are read from disk, so they need `--allow-read` for those paths.

```
mylang run app.ml --allow-net=api.example.com:443 --allow-read=./certs
```

## Connecting

`tls.connect(host, port, options)`

| Option | Default | Description |
| --- | --- | --- |
| `timeout` | `30000` | ms to wait for the handshake |
| `rejectUnauthorized` | `true` | refuse a certificate that does not verify |
| `servername` | the host | the name sent for SNI |
| `alpn` | — | protocols to offer, e.g. `["h2", "http/1.1"]` |
| `ca` | system roots | extra roots: binary, or `{file: "path"}` |
| `cert` / `key` | — | a client certificate, same forms |

Verification is on by default and the result is checked again after the handshake, so a
connection that completes has been verified. Turning it off is a deliberate act:

```ml
// only for a server whose certificate you cannot verify, such as a self-signed one in
// a test environment - never for anything that carries real traffic
var socket = defer tls.connect("localhost", 8443, { rejectUnauthorized: false });
```

## The socket

A `tls` socket is the same socket `tcp` returns — `read`, `readExactly`, `readAll`,
`write`, `end`, `close`, `buffered`, `ended`, `setTimeout`, `setNoDelay`, `setKeepAlive`,
`address` — with the connection's own details added:

| Method | Suspends | Description |
| --- | --- | --- |
| `socket.protocol()` | — | the version agreed, e.g. `TLSv1.3` |
| `socket.cipher()` | — | `{name, version}` of the cipher in use |
| `socket.alpn()` | — | the protocol agreed, or `nil` if none was offered |
| `socket.peerCertificate()` | — | `{subject, issuer, valid_from, valid_to, fingerprint}` |
| `socket.authorized()` | — | did the peer's certificate verify? |

## Listening

`tls.listen(port, host, options)` needs both `cert` and `key`:

| Option | Description |
| --- | --- |
| `cert` | the certificate: binary, or `{file: "path"}` |
| `key` | the private key, same forms |
| `ca` | roots used when asking clients for a certificate |
| `requestCert` | ask the client for a certificate |
| `rejectUnauthorized` | refuse a client whose certificate does not verify |
| `alpn` | protocols this server accepts |
| `backlog` | queued connections, default 511 |

The server is the same server `tcp.listen` returns: `accept()`, `accept(handler)`,
`pending()`, `close()`, `port`, `host`, `closed`.

`tls.rootCertificates()` returns the system's trusted roots, which is occasionally useful
for building a restricted `ca` list.

## Resources

A socket and a server both carry `symbol.dispose`, so `defer` releases them whichever way
the block ends, and both `close()` calls are idempotent. Each holds a slot counted against
`--max-connections`.

## Examples

### An HTTPS request by hand

```ml
import "core:tls";

var socket = defer tls.connect("example.com", 443, { alpn: ["http/1.1"] });

socket.write("GET / HTTP/1.0\r\nHost: example.com\r\n\r\n");

coreio.print(socket.protocol(), socket.cipher().name);
coreio.print(socket.readAll().toString());
```

### Checking who you are talking to

```ml
var socket = defer tls.connect("api.example.com", 443);
var peer = socket.peerCertificate();

coreio.print("issued to", peer.subject.CN, "by", peer.issuer.CN);
coreio.print("valid until", peer.valid_to);
coreio.print("verified:", socket.authorized());
```

### A TLS server

```ml
import "core:tls";

var server = defer tls.listen(8443, "0.0.0.0", {
  cert: { file: "./certs/server.pem" },
  key: { file: "./certs/server.key" }
});

server.accept(func(client) {
  client.write("hello over TLS\n");
  client.close();
});
```

### Asking clients for a certificate

```ml
var server = defer tls.listen(8443, "0.0.0.0", {
  cert: { file: "./certs/server.pem" },
  key: { file: "./certs/server.key" },
  ca: { file: "./certs/clients.pem" },
  requestCert: true,
  rejectUnauthorized: true
});

server.accept(func(client) {
  coreio.print("client verified:", client.authorized());
  client.close();
});
```

## Notes

- `wss://` in `ws` goes through this library, so a secure websocket gets the same
  verification by default.
- A certificate given inline (as `bytes`) and one given as `{file: "path"}` behave the
  same; the file form is checked against `--allow-read`.
- `listen` without both `cert` and `key` is an error rather than a server that cannot
  complete a handshake.
