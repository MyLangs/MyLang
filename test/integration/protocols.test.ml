// ============================================================================
//  Protocols built out of several libraries.
//
//  A real protocol is never one library: a framed message is `binary` over `tcp`, a web
//  request is `json` and `validation` over `net/http`, a compressed upload is `compress`
//  on top of both. These tests build small but complete protocols and check that the
//  pieces fit — including the awkward parts, like a message split across reads.
// ============================================================================

import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:tcp";
import "core:udp";
import "core:ws";
import "core:net/http";
import "core:net/url";
import "core:binary";
import "core:bytes";
import "core:json";
import "core:compress";
import "core:crypto";
import "core:validation" as v;
import "core:arrays";
import "core:strings";
import "core:time";

describe("a framed protocol over tcp", func() {
  // readExactly is what framing rests on: a header of a known size, a length inside it,
  // then exactly that many bytes. The test sends the pieces separately on purpose, so a
  // message really does arrive split across reads.
  test("a length-prefixed message arrives whole although it was sent in pieces", func() {
    var server = defer tcp.listen(0, "127.0.0.1");

    var serving = spawn {
      var client = server.accept();

      // the header says how long the body is
      var header = client.readExactly(6);
      var r = binary.reader(header);

      var version = r.u16();
      var size = r.u32();
      var body = client.readExactly(size);

      client.write(json.stringify({ version: version, size: size, body: body.toString() }));
      client.end()
    }

    var socket = defer tcp.connect("127.0.0.1", server.port);
    var payload = "a body that arrives in two writes";

    var w = binary.writer();

    w.u16(3);
    w.u32(bytes.byteLength(payload));

    socket.write(w.build());

    // deliberately split, with a gap, so the reader must wait for the rest
    socket.write(strings.slice(payload, 0, 10));

    time.Sleep(60);

    socket.write(strings.slice(payload, 10));

    var answer = json.parse(socket.readAll().toString());

    assert.equal(answer.version, 3);
    assert.equal(answer.size, bytes.byteLength(payload));
    assert.equal(answer.body, payload);

    wait serving;
  });

  test("several messages on one connection keep their boundaries", func() {
    var server = defer tcp.listen(0, "127.0.0.1");
    var messages = ["first", "second message", "third"];

    var serving = spawn {
      var client = server.accept();
      var seen = [];

      for (var i = 0; i < 3; i++) {
        var size = binary.reader(client.readExactly(2)).u16();

        seen[length(seen)] = client.readExactly(size).toString();
      }

      client.write(arrays.join(seen, "|"));
      client.end()
    }

    var socket = defer tcp.connect("127.0.0.1", server.port);

    for (var message in messages) {
      var w = binary.writer();

      w.u16(bytes.byteLength(message));
      w.string(message);

      socket.write(w.build());
    }

    assert.equal(socket.readAll().toString(), arrays.join(messages, "|"));

    wait serving;
  });

  test("a compressed payload travels over a socket and comes back out", func() {
    var server = defer tcp.listen(0, "127.0.0.1");
    var body = "";

    for (var i = 0; i < 300; i++) { body += "a repeating line of text\n"; }

    var serving = spawn {
      var client = server.accept();
      var size = binary.reader(client.readExactly(4)).u32();
      var packed = client.readExactly(size);

      // unpack on the far side and report what it got
      client.write($"{length(compress.gunzip(packed).toString())}");
      client.end()
    }

    var socket = defer tcp.connect("127.0.0.1", server.port);
    var packed = compress.gzip(body);

    var w = binary.writer();

    w.u32(length(packed));

    socket.write(w.build());
    socket.write(packed);

    assert.equal(socket.readAll().toString(), $"{length(body)}");
    assert.less(length(packed), length(body));

    wait serving;
  });

  test("a truncated message is reported, not silently short", func() {
    var server = defer tcp.listen(0, "127.0.0.1");
    var failed = [];

    var serving = spawn {
      var client = server.accept();

      try {
        // the client will close before sending this many
        client.readExactly(100);

        failed[length(failed)] = "no error";
      } catch (e) {
        failed[length(failed)] = "reported";
      }
    }

    var socket = tcp.connect("127.0.0.1", server.port);

    socket.write("only a few bytes");
    socket.end();
    socket.close();

    wait serving;

    assert.includes(failed, "reported");
  });
});

describe("a web api made of several libraries", func() {
  test("json in, validation, json out", func() {
    var server = defer http.Server();

    var schema = v.object({
      title: v.string({ min: 1, max: 40 }),
      count: v.integer({ min: 1 })
    });

    server.post("/items", func(ctx) {
      var result = v.check(schema, ctx.body);

      if (!result.valid) { return ctx.status(400).json({ errors: result.errors }); }

      ctx.status(201).json({ echo: result.value.title, doubled: result.value.count * 2 });
    });

    var where = server.listen(0, "127.0.0.1");
    var client = http.Client({ baseURL: $"http://127.0.0.1:{where.port}" });

    var good = client.post("/items", { title: "a thing", count: 21 });

    assert.equal(good.status(), 201);
    assert.equal(good.json().echo, "a thing");
    assert.equal(good.json().doubled, 42);

    var bad = client.post("/items", { title: "", count: 0 });

    assert.equal(bad.status(), 400);
    assert.greater(length(bad.json().errors), 0);
  });

  test("a binary body survives a request and a response", func() {
    var server = defer http.Server();

    server.post("/echo", func(ctx) {
      // whatever arrived, hand its digest back
      ctx.json({ digest: crypto.sha256(ctx.body) });
    });

    var where = server.listen(0, "127.0.0.1");
    var client = http.Client();
    var payload = crypto.randomBytes(2048);

    var answer = client.post($"http://127.0.0.1:{where.port}/echo", payload);

    assert.equal(answer.status(), 200);
    assert.equal(length(answer.json().digest), 64);
  });

  test("urls built by net/url are understood by the server", func() {
    var server = defer http.Server();

    server.get("/search", func(ctx) { ctx.json({ q: ctx.query.q, page: ctx.query.page }); });

    var where = server.listen(0, "127.0.0.1");

    var built = url.URL($"http://127.0.0.1:{where.port}/search");
    var params = built.searchParams();

    // searchParams() is a live view: setting on it changes the url it came from
    params.set("q", "a phrase with spaces");
    params.set("page", "3");

    assert.includes(built.search(), "page=3");

    var client = http.Client();
    var answer = client.get(built.toString()).json();

    assert.equal(answer.q, "a phrase with spaces");
    assert.equal(answer.page, "3");
  });

  test("a compressed response is unpacked by the client", func() {
    var server = defer http.Server();
    var body = "";

    for (var i = 0; i < 400; i++) { body += "compressible response body\n"; }

    server.get("/big", func(ctx) { ctx.send(body); });

    var where = server.listen(0, "127.0.0.1");
    var client = http.Client();

    var answer = client.get($"http://127.0.0.1:{where.port}/big");

    assert.equal(answer.status(), 200);
    assert.equal(answer.text(), body);
  });

  test("several clients talk to one server at once", func() {
    var server = defer http.Server();
    var served = 0;

    server.get("/n/:n", func(ctx) {
      served += 1;
      ctx.json({ n: ctx.params.n });
    });

    var where = server.listen(0, "127.0.0.1");
    var client = http.Client({ baseURL: $"http://127.0.0.1:{where.port}" });

    var jobs = [];

    for (var i = 1; i <= 8; i++) { jobs[length(jobs)] = spawn client.get($"/n/{i}") }

    var answers = wait.all(jobs);

    assert.lengthOf(answers, 8);
    assert.equal(served, 8);
    assert.equal(answers[0].json().n, "1");
    assert.equal(answers[7].json().n, "8");
  });
});

describe("websockets carrying structured data", func() {
  test("json over a websocket, both ways", func() {
    var server = defer ws.listen(0, "127.0.0.1");

    server.accept(func(peer) {
      for (;;) {
        var message = peer.receive();

        if (message == nil) { break; }

        var asked = json.parse(message.text);

        peer.send(json.stringify({ sum: asked.a + asked.b }));
      }
    });

    var socket = defer ws.connect($"ws://127.0.0.1:{server.port}");

    socket.send(json.stringify({ a: 2, b: 40 }));

    var answer = json.parse(socket.receive().text);

    assert.equal(answer.sum, 42);
  });

  test("a binary frame arrives as bytes", func() {
    var server = defer ws.listen(0, "127.0.0.1");

    server.accept(func(peer) {
      var message = peer.receive();

      if (message != nil) { peer.send($"{length(message.data)}"); }
    });

    var socket = defer ws.connect($"ws://127.0.0.1:{server.port}");

    socket.send(crypto.randomBytes(300));

    assert.equal(socket.receive().text, "300");
  });
});

describe("datagrams with structure", func() {
  test("a binary datagram is decoded by the receiver", func() {
    var receiver = defer udp.open(0, { host: "127.0.0.1" });

    var listening = spawn {
      var message = receiver.receive();
      var r = binary.reader(message.data);

      return { kind: r.u8(), value: r.u32() };
    }

    var sender = defer udp.open(0, { host: "127.0.0.1" });

    var w = binary.writer();

    w.u8(7);
    w.u32(123456);

    sender.send(w.build(), "127.0.0.1", receiver.port);

    var outcome = wait listening;

    assert.equal(outcome.result.kind, 7);
    assert.equal(outcome.result.value, 123456);
  });

  test("a datagram that nobody takes is counted as pending", func() {
    var receiver = defer udp.open(0, { host: "127.0.0.1" });
    var sender = defer udp.open(0, { host: "127.0.0.1" });

    sender.send("one", "127.0.0.1", receiver.port);
    sender.send("two", "127.0.0.1", receiver.port);

    time.Sleep(120);

    assert.greater(receiver.pending(), 0);

    // a datagram is {data, address, port}; the payload is always bytes
    assert.equal(receiver.receive().data.toString(), "one");
  });
});

finish("integration: protocols");
