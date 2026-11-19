// A server that meets a client error and a 4xx and a 5xx, under the option named by the
// environment variable SERVE_MODE: "default", "log", "quiet" or "handler". Prints what
// `onError` saw.
import "core:coreio";
import "core:net/http";
import "core:tcp";
import "core:json";
import "core:time";
import "core:os";

var mode = os.getenv("SERVE_MODE") || "default";
var seen = [];
var options = { bodyLimit: 16 };

if (mode == "log") { options.logErrors = true; }
if (mode == "quiet") { options.logErrors = false; }
if (mode == "handler") {
  options.onError = func(event) { seen[length(seen)] = event.kind + ":" + event.status; };
}

var server = http.Server(options);

server.post("/small", func(ctx) { ctx.json({ ok: true }); });
server.get("/boom", func(ctx) { throw "the handler failed"; });

var where = server.listen(0, "127.0.0.1");
var client = http.Client({ baseURL: "http://127.0.0.1:" + where.port, timeout: 5000 });

// a 413: the body is over the limit - the client's fault
client.post(
  "/small",
  "a body that is longer than sixteen bytes",
  { headers: { "content-type": "text/plain" } }
);

// a 500: the handler threw - the server's fault
client.get("/boom");

// a client error: garbage instead of HTTP
var raw = tcp.connect("127.0.0.1", where.port);
raw.write("this is not http\r\n\r\n");
raw.readAll();
raw.close();

time.Sleep(50);
server.close();

coreio.print("seen " + json.stringify(seen));
