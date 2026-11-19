import "core:test" as { describe, test, assert, finish };
import "core:path";
import "core:strings";
import "core:net/http";
import "./cli.ml" as cli;

// Errors a running http server meets: who hears about them, and how.
// The fixture makes one request answered 413, one answered 500, and one that is not HTTP.

var serve = path.resolve("test", "fixtures", "server-errors", "serve.ml");

func run(mode) {
  return cli.mylang(["run", serve, "--no-colors"], { env: { SERVE_MODE: mode } });
}

describe("http server errors", func() {
  test("by default only the server's own failure is printed, as one line", func() {
    var result = run("default");

    assert.equal(result.code, 0);
    assert.includes(result.err, "http request error: the handler failed (GET /boom)");
    assert.notIncludes(result.err, "entity too large");
    assert.notIncludes(result.err, "client error");
    assert.notIncludes(result.err, "    at ");
  });

  test("logErrors: true prints every error, each on one line", func() {
    var result = run("log");

    assert.includes(result.err, "request entity too large");
    assert.includes(result.err, "the handler failed");
    assert.includes(result.err, "http client error");
    assert.notIncludes(result.err, "    at ");
  });

  test("logErrors: false prints nothing", func() {
    var result = run("quiet");

    assert.equal(result.code, 0);
    assert.notIncludes(result.err, "http");
  });

  test("onError receives every error as a value, and nothing is printed", func() {
    var result = run("handler");

    assert.equal(result.code, 0);
    assert.includes(result.out, '"request:413"');
    assert.includes(result.out, '"request:500"');
    assert.includes(result.out, '"client:');
    assert.notIncludes(result.err, "http");
  });

  test("the options are checked when the server is built", func() {
    assert.throws(func() { http.Server({ onError: 5 }); }, "onError must be a function");
    assert.throws(func() { http.Server({ logErrors: "yes" }); }, "logErrors must be true or false");
  });
});

finish("tools: server errors");
