# `net/http`

HTTP clients and servers.

```ml
import "core:net/http";
```

## Suspension

| Method | Suspends | Description |
| --- | --- | --- |
| `http.Client(options)` | — | build a client |
| `client.get(url, config)` | yes | send a request |
| `client.post(url, data, config)` | yes | the same, with a body |
| `client.put` / `patch` / `delete` / `head` / `options` | yes | the rest of the verbs |
| `client.request(config)` | yes | any request |
| `client.setBaseURL` / `setHeader` / `setTimeout` | — | change the defaults |
| `client.addRequestInterceptor(fn)` | — | run `fn` before every request |
| `client.addResponseInterceptor(fn)` | — | run `fn` after every response |
| `http.Request(url, options)` | — | build one request |
| `request.send(data)` | yes | send it |
| `http.Server(options)` | — | build a server |
| `server.get(path, handler)` … | — | register a route |
| `server.use(middleware)` | — | register middleware |
| `server.static(root, config)` | — | serve a directory |
| `server.listen(port, host, callback)` | yes | bind the port and start accepting |
| `server.close(callback)` | yes | stop |
| `server.info()` | — | current state |

A request parks the calling task, so other tasks keep running while it is in flight; route
handlers run as their own tasks, so one slow handler does not hold up the others.

`listen` parks until the port is actually bound and returns where it ended up —
`{port, host, protocol}` — which is the only way to learn the port when binding to port 0:

```ml
var where = server.listen(0, "127.0.0.1");

coreio.print($"listening on {where.protocol}://{where.host}:{where.port}");
```

A port that cannot be bound is an error the program can catch, so a server that failed to
start never looks like one that succeeded:

```ml
try {
  server.listen(8080);
} catch (e) {
  coreio.print("could not start:", e);
}
```

## Permissions

Both making a request and binding a port need `--allow-net`:

```
mylang run app.ml --allow-net=api.example.com:443,127.0.0.1:8080
```

A static file route also reads from disk, so it needs `--allow-read` for that directory.

## Writing a handler

A handler takes **one** argument, the context, which carries both the request and the ways
to answer it:

```ml
server.get("/users/:id", func(ctx) {
  ctx.json({ id: ctx.params.id, sort: ctx.query.sort });
});
```

What is in the request:

| Field | Description |
| --- | --- |
| `ctx.method` / `ctx.url` / `ctx.path` | the request line |
| `ctx.params` | path parameters, so `/users/:id` gives `ctx.params.id` |
| `ctx.query` | the query string, parsed |
| `ctx.body` | the parsed body: an object for JSON, text for text |
| `ctx.headers` | the request headers |
| `ctx.cookies` | the cookies sent |
| `ctx.ip` / `ctx.hostname` / `ctx.protocol` / `ctx.secure` | where it came from |
| `ctx.state` | yours: middleware puts things here for later handlers |

How to answer:

| Method | Suspends | Description |
| --- | --- | --- |
| `ctx.send(body, status, headers)` | — | send text, html or binary |
| `ctx.json(value, status)` | — | send JSON |
| `ctx.status(code)` | — | set the status; returns the context, so it chains |
| `ctx.sendFile(path, options)` | yes | send a file from disk |
| `ctx.redirect(url, status)` | — | send a redirect |
| `ctx.error(message, status)` | — | send an error response |
| `ctx.cookie(name, value, options)` | — | set a cookie |
| `ctx.clearCookie(name, options)` | — | remove one |

`ctx.status` chains, which is the usual way to answer a bad request:

```ml
server.post("/users", func(ctx) {
  if (ctx.body == nil) { return ctx.status(400).json({ error: "a body is required" }); }

  ctx.status(201).json({ created: true });
});
```

For a header or something else the host exposes, `ctx.res` and `ctx.req` are underneath:

```ml
server.get("/download", func(ctx) {
  ctx.res.setHeader("Content-Disposition", "attachment; filename=\"report.csv\"");
  ctx.send(csv);
});
```

## Reading a response

A client response answers through methods rather than fields, because the body is only
decoded if you ask for it:

| Method | Suspends | Description |
| --- | --- | --- |
| `response.status()` | — | the status code |
| `response.text()` | — | the body as text |
| `response.json()` | — | the body parsed as JSON |
| `response.buffer()` | — | the body as `bytes` |
| `response.getHeader(name)` | — | one response header |
| `response.ok` | — | field: was the status 2xx? |
| `response.statusText` / `response.url` / `response.redirected` | — | fields |

```ml
var response = client.get("/users/1");

if (!response.ok) { throw $"request failed: {response.status()}"; }

coreio.print(response.json());
```

## Errors

A running server meets errors that are not the program's: a client that hangs up, a port
scanner speaking garbage, a browser that does not trust the certificate, a body over the
limit. Each is answered correctly (the client gets its 400 or 413), and none of them is
worth a screen of host internals. What is printed, and who hears about it:

| Setting | What happens |
| --- | --- |
| *(default)* | only the **server's** failures are printed — the server itself failing, or a request that ended in a 5xx — one line each |
| `logErrors: true` | every error is printed, one line each |
| `logErrors: false` | nothing is printed |
| `onError: func(event) { ... }` | every error goes to the function, on its own task, and nothing is printed |

```ml
var server = http.Server({
  onError: func(event) {
    // event.kind    "client" (not HTTP, hung up, bad TLS), "request" (a request failed),
    //               or "server" (the server itself)
    // event.status  the status the request was answered with, or nil
    // event.method / event.path   for a request, or nil
    // event.code / event.message  what went wrong
    if (event.kind != "client") { log.write(json.stringify(event) + "\n"); }
  }
});
```

The line printed by default looks like this:

```
http request error: the handler failed (GET /boom)
```

## Resources

A server carries `symbol.dispose`, so `defer` releases the port whichever way the block
ends — and it parks until the port is actually free, so the next thing that wants it gets
it:

```ml
func serveOnce() {
  var server = defer http.Server();

  server.get("/", func(ctx) { ctx.send("hello"); });
  server.listen(8080);

  wait spawn time.Sleep(60000);
  // the port is released here
}
```

## Examples

### A client

```ml
import "core:net/http";

var client = http.Client({ baseURL: "https://api.example.com", timeout: 10000 });

client.setHeader("Authorization", "Bearer " + token);

var response = client.get("/users/1");

coreio.print(response.status(), response.json());
```

### Requests in parallel

```ml
var jobs = [];

for (var id in ids) {
  jobs[length(jobs)] = spawn client.get($"/users/{id}");
}

var responses = wait.all(jobs);
```

### A server

```ml
import "core:net/http";
import "core:validation" as v;

var server = defer http.Server({ cors: true });

var createUser = v.object({ name: v.string({ min: 1 }) });

server.get("/health", func(ctx) {
  ctx.json({ ok: true });
});

server.post("/users", func(ctx) {
  var result = v.check(createUser, ctx.body);

  if (!result.valid) { return ctx.status(400).json({ errors: result.errors }); }

  ctx.status(201).json({ name: result.value.name });
});

var where = server.listen(8080, "127.0.0.1");

coreio.print($"listening on {where.protocol}://{where.host}:{where.port}");
```

### Static files

```ml
server.static("./public", { index: "index.html", maxAge: 3600 });
```

A server also serves `./public` by default if that directory happens to exist. If it does
not, nothing is said about it — an API with no static files is the ordinary case. A
directory you name yourself and do not have is an error, since that is a mistake.

### Middleware

Middleware takes the context and a `next` to pass control along:

```ml
server.use(func(ctx, next) {
  coreio.print(ctx.method, ctx.path);
  next();
});
```

Anything a middleware puts in `ctx.state` is there for the handlers after it:

```ml
server.use(func(ctx, next) {
  ctx.state.requestId = crypto.randomUUID();
  next();
});

server.get("/whoami", func(ctx) {
  ctx.json({ request: ctx.state.requestId });
});
```

## Notes

- A handler takes one argument. `func(req, res)` is the shape of a different language's
  framework; here the request and the reply are the same context.
- Response compression runs on the host's thread pool, so packing a large response does
  not stop other tasks.
- A server that cannot bind raises an error from `listen` rather than printing one and
  continuing, so `try`/`catch` works and a failed start cannot be mistaken for a
  successful one.
- A server that has been released stops intercepting `SIGTERM` and `SIGINT`. It used to
  keep its signal handlers after closing, and because there was no longer a server to
  close, the handler swallowed the signal and the process could not be stopped except by
  force.
- For a protocol rather than request/response, see `ws`; for raw sockets, `tcp`.
