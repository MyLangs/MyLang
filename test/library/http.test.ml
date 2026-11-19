import "core:test" as { describe, test, assert, finish };
import "net/http";
import "tcp";
import "crypto";
import "path";
import "time";

// Every group talks to a real server on the loopback interface. The ports are
// picked at random so that parallel runs and leftovers do not collide.
var BASE_PORT = crypto.randomInt(30000, 60000);
var nextPort = BASE_PORT;
func takePort() { nextPort++; return nextPort; }

var STATIC_ROOT = path.resolve(import.base, "../fixtures/static");

// ---------------------------------------------------------------- main server
var mainPort = takePort();
var mainBase = "http://127.0.0.1:" + mainPort;
var server = http.Server({ static: { root: STATIC_ROOT } });
var order = [];

server.use(func(ctx, next) { order[length(order)] = "mw1:" + ctx.path; next(); });
server.use(func(ctx, next) { ctx.state.user = "alice"; next(); });

server.get("/hello", func(ctx) { ctx.send("hello"); });
server.get("/json", func(ctx) { ctx.json({ ok: true, n: 5 }); });
server.get("/users/:id", func(ctx) { ctx.json({ id: ctx.params.id, query: ctx.query }); });
server.get("/posts/:year/:slug", func(ctx) { ctx.json(ctx.params); });
server.get("/state", func(ctx) { ctx.json({ user: ctx.state.user }); });
server.get("/q", func(ctx) { ctx.json(ctx.query); });
server.get("/reqinfo", func(ctx) {
  var test = ("x-test" in ctx.headers) ? ctx.headers["x-test"] : nil;
  ctx.json({
    test: test,
    protocol: ctx.protocol,
    secure: ctx.secure,
    method: ctx.method,
    path: ctx.path
  });
});
server.get("/header", func(ctx) { ctx.res.setHeader("X-Custom", "yes"); ctx.send("ok"); });
server.get("/chain", func(ctx) { ctx.status(201).json({ made: true }); });
server.get("/status404", func(ctx) { ctx.status(404); ctx.send("nope"); });
server.get("/obj", func(ctx) { ctx.send({ a: 1 }); });
server.get("/num", func(ctx) { ctx.send(42); });
server.get("/redir", func(ctx) { ctx.redirect("/hello"); });
server.get(
  "/cookie",
  func(ctx) { ctx.cookie("sid", "abc123", { httpOnly: true, maxAge: 60000 }); ctx.send("set"); }
);
server.get("/readcookie", func(ctx) { ctx.json(ctx.cookies); });
server.get("/boom", func(ctx) { throw "kaboom"; });
server.post("/echo", func(ctx) { ctx.json({ body: ctx.body, method: ctx.method }); });
server.post("/form", func(ctx) { ctx.json(ctx.body); });
server.put("/put", func(ctx) { ctx.json({ method: ctx.method, body: ctx.body }); });
server.patch("/patch", func(ctx) { ctx.json({ method: ctx.method }); });
server.delete("/del", func(ctx) { ctx.json({ method: ctx.method }); });
server.head("/head", func(ctx) { ctx.res.setHeader("X-Head", "1"); ctx.send(""); });
server.all("/any", func(ctx) { ctx.json({ method: ctx.method }); });

server.listen(mainPort);

// ------------------------------------------------- servers for static options
var ignorePort = takePort();
var allowPort = takePort();
var denyPort = takePort();
var staticIgnore = http.Server({ static: { root: STATIC_ROOT } });
var staticAllow = http.Server({ static: { root: STATIC_ROOT, dotfiles: "allow" } });
var staticDeny = http.Server({ static: { root: STATIC_ROOT, dotfiles: "deny" } });
staticIgnore.listen(ignorePort);
staticAllow.listen(allowPort);
staticDeny.listen(denyPort);

// ------------------------------------------------------ cors and rate limiting
var corsPort = takePort();
var corsServer = http.Server();
corsServer.cors({
  origin: "https://app.example",
  credentials: true,
  methods: ["GET", "POST"],
  exposedHeaders: ["X-Total"],
  maxAge: 600
});
corsServer.get("/data", func(ctx) { ctx.json({ ok: true }); });
corsServer.listen(corsPort);

var limitPort = takePort();
var limitServer = http.Server();
limitServer.rateLimit({ windowMs: 60000, max: 3 });
limitServer.get("/limited", func(ctx) { ctx.send("ok"); });
limitServer.listen(limitPort);

time.Sleep(200);

var client = http.Client({ baseURL: mainBase });

describe("http: routing", func() {
  test("a GET route returns text", func() {
    var r = client.get("/hello");
    assert.equal(r.status(), 200);
    assert.equal(r.text(), "hello");
  });

  test("json responses carry the content type", func() {
    var r = client.get("/json");
    assert.equal(r.json(), { ok: true, n: 5 });
    assert.includes(r.getHeader("content-type"), "application/json");
  });

  test("route parameters and the query string", func() {
    var r = client.get("/users/42?x=1&y=2");
    assert.equal(r.json(), { id: "42", query: { x: "1", y: "2" } });
  });

  test("several route parameters", func() {
    assert.equal(
      client.get("/posts/2024/hello-world").json(),
      { year: "2024", slug: "hello-world" }
    );
  });

  test("repeated query keys become lists", func() {
    assert.equal(client.get("/q?a=1&b=2").json(), { a: "1", b: "2" });
    assert.equal(client.get("/q?a=1&a=2").json(), { a: ["1", "2"] });
  });

  test("every HTTP verb has a route method", func() {
    assert.equal(client.put("/put", { x: 1 }).json(), { method: "PUT", body: { x: 1 } });
    assert.equal(client.patch("/patch", {}).json(), { method: "PATCH" });
    assert.equal(client.delete("/del").json(), { method: "DELETE" });
    assert.equal(client.post("/echo", { a: 1 }).json(), { body: { a: 1 }, method: "POST" });
  });

  test("head returns headers without a body", func() {
    var r = client.head("/head");
    assert.equal(r.status(), 200);
    assert.equal(r.getHeader("x-head"), "1");
    assert.equal(r.text(), "");
  });

  test("all matches every method", func() {
    assert.equal(client.get("/any").json().method, "GET");
    assert.equal(client.post("/any", {}).json().method, "POST");
    assert.equal(client.put("/any", {}).json().method, "PUT");
  });

  test("unknown paths answer 404", func() {
    var r = client.get("/definitely-missing");
    assert.equal(r.status(), 404);
    assert.includes(r.text(), "Cannot GET /definitely-missing");
  });

  test("a route does not answer other methods", func() {
    assert.equal(client.post("/hello", {}).status(), 404);
  });
});

describe("http: request data", func() {
  test("json bodies are parsed", func() {
    assert.equal(
      client.post("/echo", { name: "x", list: [1, 2] }).json().body,
      { name: "x", list: [1, 2] }
    );
  });

  test("form bodies are parsed", func() {
    var r = client.post(
      "/form",
      "k=v&n=1",
      { headers: { "content-type": "application/x-www-form-urlencoded" } }
    );
    assert.equal(r.json(), { k: "v", n: "1" });
  });

  test("request headers, protocol and method are available", func() {
    var r = client.get("/reqinfo", { headers: { "X-Test": "val" } });
    assert.equal(
      r.json(),
      { test: "val", protocol: "http", secure: false, method: "GET", path: "/reqinfo" }
    );
  });

  test("cookies are parsed", func() {
    var r = client.get("/readcookie", { headers: { Cookie: "a=1; b=2" } });
    assert.equal(r.json(), { a: "1", b: "2" });
  });

  test("middleware runs in order and can pass data through ctx.state", func() {
    assert.equal(client.get("/state").json(), { user: "alice" });
    assert.includes(order, "mw1:/state");
  });
});

describe("http: responses", func() {
  test("status() and chaining", func() {
    var r = client.get("/chain");
    assert.equal(r.status(), 201);
    assert.equal(r.json(), { made: true });
  });

  test("an explicit status with a text body", func() {
    var r = client.get("/status404");
    assert.equal(r.status(), 404);
    assert.equal(r.text(), "nope");
  });

  test("send() serialises objects as JSON and numbers as text", func() {
    var o = client.get("/obj");
    assert.includes(o.getHeader("content-type"), "application/json");
    assert.equal(o.text(), '{"a":1}');
    var n = client.get("/num");
    assert.equal(n.status(), 200);
    assert.equal(n.text(), "42");
  });

  test("custom headers", func() {
    var r = client.get("/header");
    assert.equal(r.getHeader("x-custom"), "yes");
    assert.equal(r.text(), "ok");
  });

  test("redirect", func() {
    var r = client.get("/redir");
    assert.equal(r.status(), 302);
    assert.equal(r.getHeader("location"), "/hello");
  });

  test("cookies can be set with options", func() {
    var r = client.get("/cookie");
    var header = r.getHeader("set-cookie")[0];
    assert.includes(header, "sid=abc123");
    assert.includes(header, "Max-Age=60");
    assert.includes(header, "HttpOnly");
    assert.includes(header, "Path=/");
  });

  test("an exception in a handler produces a 500 with the message", func() {
    var r = client.get("/boom");
    assert.equal(r.status(), 500);
    assert.equal(r.json(), { error: "kaboom" });
  });
});

describe("http: response object", func() {
  test("status fields", func() {
    var r = client.get("/hello");
    assert.isTrue(r.ok);
    assert.isFalse(r.redirected);
    assert.equal(r.statusText, "OK");
    assert.typeOf(r.url, "string");
    assert.typeOf(r.headers, "object");
  });

  test("ok is false for error statuses", func() {
    assert.isFalse(client.get("/status404").ok);
  });

  test("getHeader returns nil for a missing header", func() {
    assert.isNil(client.get("/hello").getHeader("x-nothing"));
  });

  test("buffer() returns Bytes", func() {
    var b = client.get("/hello").buffer();
    assert.equal(b.length, 5);
    assert.equal(b.toString(), "hello");
  });

  test("clone() keeps the body readable twice", func() {
    var r = client.get("/hello");
    var copy = r.clone();
    assert.equal(copy.text(), "hello");
    assert.equal(r.text(), "hello");
  });
});

describe("http: static files", func() {
  var assets = http.Client({ baseURL: "http://127.0.0.1:" + ignorePort });

  test("files are served with the matching content type", func() {
    var html = assets.get("/index.html");
    assert.equal(html.status(), 200);
    assert.equal(html.text(), "<h1>index</h1>\n");
    assert.includes(html.getHeader("content-type"), "text/html");
    assert.includes(assets.get("/style.css").getHeader("content-type"), "text/css");
    assert.includes(assets.get("/data.json").getHeader("content-type"), "application/json");
    assert.includes(assets.get("/note.txt").getHeader("content-type"), "text/plain");
  });

  test("the root serves the index file", func() {
    assert.equal(assets.get("/").text(), "<h1>index</h1>\n");
  });

  test("files in sub directories", func() {
    assert.equal(assets.get("/sub/page.html").text(), "<p>page</p>\n");
  });

  test("a missing file answers 404", func() {
    assert.equal(assets.get("/nofile.txt").status(), 404);
  });

  test("dot files are hidden by default", func() {
    assert.equal(assets.get("/.hidden").status(), 404);
  });

  test("dotfiles: allow serves them", func() {
    var open = http.Client({ baseURL: "http://127.0.0.1:" + allowPort });
    var r = open.get("/.hidden");
    assert.equal(r.status(), 200);
    assert.equal(r.text(), "secret\n");
  });

  test("dotfiles: deny answers 403", func() {
    var strict = http.Client({ baseURL: "http://127.0.0.1:" + denyPort });
    assert.equal(strict.get("/.hidden").status(), 403);
    assert.equal(strict.get("/index.html").status(), 200);
  });

  test("dot segments inside the root are resolved", func() {
    assert.equal(assets.get("/sub/../index.html").status(), 200);
    assert.equal(assets.get("/sub/./page.html").status(), 200);
  });

  test("routes take precedence over static files", func() {
    assert.equal(client.get("/hello").text(), "hello");
    assert.equal(client.get("/index.html").text(), "<h1>index</h1>\n");
  });
});

describe("http: cors", func() {
  var cors = http.Client({ baseURL: "http://127.0.0.1:" + corsPort });

  test("responses carry the configured CORS headers", func() {
    var r = cors.get("/data");
    assert.equal(r.getHeader("access-control-allow-origin"), "https://app.example");
    assert.equal(r.getHeader("access-control-allow-methods"), "GET, POST");
    assert.equal(r.getHeader("access-control-allow-credentials"), "true");
    assert.equal(r.getHeader("access-control-expose-headers"), "X-Total");
    assert.equal(r.getHeader("access-control-max-age"), "600");
    assert.equal(r.json(), { ok: true });
  });

  test("a preflight OPTIONS request is answered with 204", func() {
    assert.equal(cors.options("/data").status(), 204);
  });

  test("cors() without options allows any origin", func() {
    var open = http.Server();
    var port = takePort();
    open.cors();
    open.get("/x", func(ctx) { ctx.send("x"); });
    open.listen(port);
    time.Sleep(100);
    var r = http.Client({ baseURL: "http://127.0.0.1:" + port }).get("/x");
    assert.equal(r.getHeader("access-control-allow-origin"), "*");
    open.close();
  });
});

describe("http: rate limiting", func() {
  test("requests above the limit get 429", func() {
    var limited = http.Client({ baseURL: "http://127.0.0.1:" + limitPort });
    var statuses = [];
    for (var i = 0; i < 5; i++) { statuses[length(statuses)] = limited.get("/limited").status(); }
    assert.equal(statuses, [200, 200, 200, 429, 429]);
  });

  test("rate limit headers are reported", func() {
    var fresh = http.Server();
    var port = takePort();
    fresh.rateLimit({ windowMs: 60000, max: 2 });
    fresh.get("/x", func(ctx) { ctx.send("x"); });
    fresh.listen(port);
    time.Sleep(100);
    var c = http.Client({ baseURL: "http://127.0.0.1:" + port });
    var first = c.get("/x");
    assert.equal(first.getHeader("x-ratelimit-limit"), "2");
    assert.equal(first.getHeader("x-ratelimit-remaining"), "1");
    c.get("/x");
    var blocked = c.get("/x");
    assert.equal(blocked.status(), 429);
    assert.equal(blocked.getHeader("x-ratelimit-remaining"), "0");
    assert.equal(blocked.json().error, "Too Many Requests");
    fresh.close();
  });
});

describe("http: client", func() {
  test("a base URL makes paths relative", func() {
    assert.equal(client.get("/hello").text(), "hello");
    assert.equal(http.Client().get(mainBase + "/hello").text(), "hello");
  });

  test("setBaseURL returns the same, updated client", func() {
    var c = http.Client();
    assert.equal(c.setBaseURL(mainBase).get("/hello").text(), "hello");
  });

  test("setHeader applies to later requests and is chainable", func() {
    var c = http.Client({ baseURL: mainBase });
    c.setHeader("X-Test", "default").setTimeout(5000);
    assert.equal(c.get("/reqinfo").json().test, "default");
  });

  test("per-request headers override the client's", func() {
    var c = http.Client({ baseURL: mainBase });
    c.setHeader("X-Test", "default");
    assert.equal(c.get("/reqinfo", { headers: { "X-Test": "special" } }).json().test, "special");
  });

  test("request interceptors can change the request", func() {
    var c = http.Client({ baseURL: mainBase });
    var id = c.addRequestInterceptor(func(cfg) { cfg.headers = { "x-test": "from-interceptor" }; return cfg; });
    assert.equal(c.get("/reqinfo").json().test, "from-interceptor");
    c.removeInterceptor("request", id);
    assert.isNil(c.get("/reqinfo").json().test);
  });

  test("response interceptors see every response", func() {
    var c = http.Client({ baseURL: mainBase });
    var seen = [];
    var id = c.addResponseInterceptor(func(res) { seen[length(seen)] = res.status(); return res; });
    c.get("/hello");
    c.get("/status404");
    c.removeInterceptor("response", id);
    c.get("/hello");
    assert.equal(seen, [200, 404]);
  });

  test("removed interceptors do not break later requests", func() {
    var c = http.Client({ baseURL: mainBase });
    var a = c.addRequestInterceptor(func(cfg) { return cfg; });
    var b = c.addRequestInterceptor(func(cfg) { return cfg; });
    c.removeInterceptor("request", a);
    assert.equal(c.get("/hello").text(), "hello");
    c.removeInterceptor("request", b);
    assert.equal(c.get("/hello").text(), "hello");
  });

  test("a refused connection raises an error", func() {
    assert.throws(func() { http.Client().get("http://127.0.0.1:1/x"); }, "ECONNREFUSED");
  });

  test("an invalid URL is rejected", func() {
    assert.throws(func() { http.Client().get("not-a-url"); }, "Invalid URL");
  });
});

describe("http: server", func() {
  test("info describes the listening server", func() {
    var info = server.info();
    assert.isTrue(info.listening);
    assert.equal(info.address.port, mainPort);
    assert.isFalse(info.shuttingDown);
    assert.typeOf(info.static, "object");
  });

  test("an unused server is not listening", func() {
    assert.isFalse(http.Server().info().listening);
  });

  test("the response cache can be inspected and cleared", func() {
    assert.doesNotThrow(func() { server.clearCache(); });
    assert.typeOf(server.cacheStats(), "object");
  });
});

server.close();
staticIgnore.close();
staticAllow.close();
staticDeny.close();
corsServer.close();
limitServer.close();

describe("http: binding a port", func() {
  // `listen` used to return at once and print a failed bind to the console: the program
  // carried on believing it had a server, and the only sign was the exit code at the end.
  test("listen says where it ended up listening", func() {
    var server = defer http.Server();
    var where = server.listen(0, "127.0.0.1");

    assert.typeOf(where.port, "int");
    assert.greater(where.port, 0);
    assert.equal(where.host, "127.0.0.1");
    assert.equal(where.protocol, "http");
  });

  test("the port is bound by the time listen returns", func() {
    var server = defer http.Server();
    var where = server.listen(0, "127.0.0.1");

    assert.isFalse(tcp.isPortFree(where.port, "127.0.0.1"));
  });

  test("a port already in use is an error the program can catch", func() {
    var first = defer http.Server();
    var where = first.listen(0, "127.0.0.1");

    var second = http.Server();

    assert.throws(func() { second.listen(where.port, "127.0.0.1"); }, "already in use");
  });

  test("the callback still runs, with the same details", func() {
    var server = defer http.Server();
    var seen = nil;

    var where = server.listen(0, "127.0.0.1", func(info) { seen = info; });

    assert.notNil(seen);
    assert.equal(seen.port, where.port);
  });

  test("listening twice on one server is refused", func() {
    var server = defer http.Server();

    server.listen(0, "127.0.0.1");

    assert.throws(func() { server.listen(0, "127.0.0.1"); }, "already listening");
  });

  // Releasing used to return while the host was still closing, so a program that gave up
  // a port and bound it again could be refused for a port it no longer held.
  test("the port is free once the server is released", func() {
    var port = 0;

    func scoped() {
      var server = defer http.Server();
      port = server.listen(0, "127.0.0.1").port;
    }

    scoped();

    assert.isTrue(tcp.isPortFree(port, "127.0.0.1"));
  });

  test("a default public directory that is absent is not a problem", func() {
    // an API server has no static files, and that is the ordinary case - not a warning
    var server = defer http.Server();

    assert.notNil(server.listen(0, "127.0.0.1"));
  });

  test("a static directory the program names and does not have is reported", func() {
    assert.throws(
      func() { http.Server({ static: { root: path.join(import.base, "no-such-directory") } }); },
      "does not exist"
    );
  });
});

finish("http");
