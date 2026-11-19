# `dns`

Name resolution.

```ml
import "core:dns";
```

## Suspension

| Method | Suspends | Description |
| --- | --- | --- |
| `dns.lookup(hostname, family)` | yes | the address the operating system would use |
| `dns.lookupAll(hostname)` | yes | every address the system resolver knows |
| `dns.resolve(hostname, type)` | yes | query a DNS server directly |
| `dns.reverse(address)` | yes | the names that point at an address |
| `dns.servers()` | — | the resolvers in use |
| `dns.setServers([…])` | — | replace the resolver list |
| `dns.isIP(text)` | — | `4`, `6`, or `0` when it is not an address |
| `dns.types` | — | the record types `resolve` understands (a field) |

A lookup parks the calling task, so a slow or unreachable DNS server delays only the task
that asked. Use `spawn` to resolve several names at once:

```ml
var jobs = [];
for (var host in hosts) { jobs[length(jobs)] = spawn dns.lookup(host); }
var results = wait.all(jobs);
```

## `lookup` versus `resolve`

- `dns.lookup` asks the operating system, so it honours `/etc/hosts` and the system
  resolver. This is what a connection actually does, so it is what you want before
  connecting.
- `dns.resolve` queries a DNS server, so it sees only what DNS says. Use it when you want
  the records themselves (MX, TXT, SRV).

`dns.lookup` returns `{ address, family }`; `dns.lookupAll` returns an array of those.

## Permissions

Resolving a name is a network operation and needs `--allow-net`. A grant naming hosts
allows resolving exactly those names:

```
mylang run app.ml --allow-net=api.example.com
```

`dns.servers()` and `dns.setServers()` read and change machine settings, so they need
`--allow-sys`.

## Examples

### Before connecting

```ml
import "core:dns";
import "core:tcp";

var resolved = dns.lookup("example.com", 4);

coreio.print("connecting to", resolved.address);

var socket = defer tcp.connect(resolved.address, 80);
```

### Mail servers for a domain

```ml
var records = dns.resolve("example.com", "MX");

for (var record in records) {
  coreio.print(record.priority, record.exchange);
}
```

### Telling an address from a name

```ml
func connectTo(target, port) {
  if (dns.isIP(target) != 0) {
    return tcp.connect(target, port);
  }

  return tcp.connect(dns.lookup(target).address, port);
}
```

### Resolving many names at once

```ml
var jobs = [];

for (var host in ["a.example.com", "b.example.com", "c.example.com"]) {
  jobs[length(jobs)] = spawn dns.lookup(host);
}

for (var job in jobs) {
  var done = wait job;

  if (done.status == "fulfilled") {
    coreio.print(done.result.address);
  }
}
```

## Notes

- A name that does not resolve raises an error naming the host and the resolver's code
  (`ENOTFOUND`, `ESERVFAIL`), which is usually what tells you what went wrong.
- `dns.types` lists what `resolve` accepts: A, AAAA, CNAME, MX, NS, PTR, SOA, SRV, TXT,
  CAA, NAPTR, ANY. An unknown type is refused before any query is sent.
