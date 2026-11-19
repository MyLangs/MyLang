# `udp`

Datagram sockets.

```ml
import "core:udp";
```

UDP sends independent packets with no connection and no delivery guarantee. That makes it
the right tool for discovery, metrics, game state and anything where the newest packet
matters more than every packet arriving.

## Suspension

| Method | Suspends | Description |
| --- | --- | --- |
| `udp.open(port, options)` | yes | bind a socket; port `0` picks a free one |
| `socket.send(data, host, port)` | yes | send one datagram; returns the byte count |
| `socket.receive()` | yes | the next datagram, parking until one arrives |
| `socket.receive(timeoutMs)` | yes | the same, but gives up and returns `nil` |
| `socket.close()` | yes | release the socket (idempotent) |
| `socket.pending()` | — | datagrams that arrived and are not taken yet |
| `socket.setBroadcast(on)` | — | allow sending to the broadcast address |
| `socket.joinGroup(address)` | — | join a multicast group |
| `socket.leaveGroup(address)` | — | leave one |
| `socket.port` / `address` / `family` | — | fields |
| `socket.closed` | — | field |

A received datagram is `{ data, address, port }`, where `data` is `bytes`.

Waiting for a datagram parks only the task that asked; everything else keeps running. Use
`spawn` when a receive loop should run alongside the rest of the program.

## Permissions

Opening a socket and sending both need `--allow-net`, which may name hosts and ports:

```
mylang run app.ml --allow-net=239.0.0.1,127.0.0.1:9000
```

## Options

`udp.open(port, options)` accepts:

| Option | Meaning |
| --- | --- |
| `type` | `"udp4"` (default) or `"udp6"` |
| `host` | the address to bind to |
| `reuseAddr` | let several sockets share the port |

## Resources

A socket carries `symbol.dispose`, so `defer` releases it:

```ml
func ping(host, port) {
  var socket = defer udp.open(0);

  socket.send("ping", host, port);

  return socket.receive(1000);     // nil when nothing answers in a second
}
```

## Examples

### A small request/response exchange

```ml
import "core:udp";

var server = defer udp.open(9000);

var serving = spawn {
  while (!server.closed) {
    var packet = server.receive();

    if (packet == nil) { break; }

    server.send("pong", packet.address, packet.port);
  }
};

var client = defer udp.open(0);
client.send("ping", "127.0.0.1", 9000);

coreio.print(client.receive(1000).data.toString());   // pong
```

### Binary telemetry

```ml
import "core:udp";
import "core:binary";

var socket = defer udp.open(0);

var packet = binary.writer();
packet.u8(1);                 // version
packet.u32(cpuPercent);
packet.u32(memoryMb);

socket.send(packet.build(), "metrics.local", 8125);
```

### Not waiting forever

```ml
var reply = socket.receive(250);

if (reply == nil) {
  coreio.print("no answer in 250ms");
} else {
  coreio.print("from", reply.address, reply.data.toString());
}
```

## Notes

- Datagrams can be lost, duplicated or reordered. If that matters, use `tcp`.
- A datagram larger than the path MTU (about 1400 bytes in practice) is likely to be
  dropped; keep packets small.
- `receive()` without a timeout parks until something arrives or the socket is closed.
