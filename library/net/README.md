# `net`

Not a library — a folder holding the three that the networking stack is built from.

| Directory | Imported as | What it is |
| --- | --- | --- |
| [`http`](./http/README.md) | `core:net/http` | HTTP requests and a server |
| [`url`](./url/README.md) | `core:net/url` | parsing and building urls |
| [`socket`](./socket/README.md) | — | the socket behind `tcp`, `tls` and `ws` |

`socket` is shared internals rather than something to import: it is the one place a socket
is implemented, so a value from `tcp.connect`, `tls.connect` or `tcp.connectUnix` reads and
writes identically. Its README is worth reading once, since it documents every method those
sockets have.

There is no `net` to import. Pick the piece you need:

```ml
import "core:net/http";
import "core:net/url";
import "core:tcp";                 // plain sockets
import "core:tls";                 // encrypted sockets
import "core:ws";                  // websockets, over either
```
