# `net/url`

Parsing, building and resolving URLs.

```ml
import "core:net/url";
```

## Suspension

Everything here is pure string work: **every method returns immediately**. There is nothing
to wait for.

| Method | Suspends | Description |
| --- | --- | --- |
| `url.URL(href, base)` | — | parse a URL into its parts |
| `url.URLSearchParams(init)` | — | a query string as a collection |
| `url.URLPattern(pattern)` | — | match URLs against a pattern |
| `url.parse` via `URL` | — | see below |
| `url.format(parts)` | — | build a URL from parts |
| `url.resolve(base, relative)` | — | resolve a relative reference |
| `url.join(base, …parts)` | — | join path segments onto a URL |
| `url.isAbsolute(text)` | — | does it have a scheme? |
| `url.encodeURI` / `decodeURI` | — | encode a whole URL |
| `url.encodeURIComponent` / `decodeURIComponent` | — | encode one component |
| `url.fileURLToPath(href)` | — | `file://` to a filesystem path |

A parsed URL answers through **calls**, not fields: `protocol()`, `host()`, `hostname()`,
`port()`, `pathname()`, `search()`, `searchParams()`, `hash()`, `username()`,
`password()`, `origin()` and `href()`. Reading one without the parentheses gives you the
method rather than the value, which prints as `[Function: …]`.

## Examples

### Taking a URL apart

```ml
import "core:net/url";

var parsed = url.URL("https://user@example.com:8443/a/b?q=1#top");

coreio.print(parsed.protocol());   // https:
coreio.print(parsed.hostname());   // example.com
coreio.print(parsed.port());       // 8443
coreio.print(parsed.pathname());   // /a/b
coreio.print(parsed.searchParams().get("q"));   // 1
```

### Building one

```ml
var params = url.URLSearchParams({ page: 2, sort: "name" });

var href = url.format({
  protocol: "https",
  hostname: "api.example.com",
  pathname: "/users",
  search: params.toString()
});
```

### Resolving against a base

```ml
coreio.print(url.resolve("https://example.com/a/b", "../c"));   // https://example.com/c
coreio.print(url.join("https://example.com", "api", "v1"));     // https://example.com/api/v1
```

### Checking a URL before connecting

```ml
import "core:net/url";
import "core:tcp";

var target = url.URL(input);

if (target.protocol != "https:") { throw "only https is allowed"; }

var socket = defer tcp.connect(target.hostname, target.port ? target.port : 443);
```

## Notes

- `url.URL` throws on a malformed URL, which is usually what you want for input that came
  from outside.
- `encodeURIComponent` escapes `/`, `?` and `&`; `encodeURI` does not. Use the component
  form for anything going into a query value.
