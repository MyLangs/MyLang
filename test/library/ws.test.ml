import "core:test" as { describe, test, assert, finish };
import "core:ws";
import "core:binary";
import "core:time";

describe("ws: messages", func() {
  test("text travels both ways", func() {
    var server = ws.listen(0, "127.0.0.1");

    var serving = spawn {
      var peer = server.accept();
      var message = peer.receive();
      peer.send("echo:" + message.text);
      peer.close();
    };

    var client = ws.connect($"ws://127.0.0.1:{server.port}/");
    client.send("hello");

    var reply = client.receive();

    assert.equal(reply.kind, "text");
    assert.equal(reply.text, "echo:hello");

    client.close();
    wait serving;
    server.close();
  });

  test("binary travels as binary", func() {
    var server = ws.listen(0, "127.0.0.1");

    var serving = spawn {
      var peer = server.accept();
      peer.send(peer.receive().data);
      peer.close();
    };

    var client = ws.connect($"ws://127.0.0.1:{server.port}/");
    client.send(binary.writer().u16(513).build());

    var reply = client.receive();

    assert.equal(reply.kind, "binary");
    assert.isNil(reply.text);
    assert.equal(binary.reader(reply.data).u16(), 513);

    client.close();
    wait serving;
    server.close();
  });

  test("several messages keep their order", func() {
    var server = ws.listen(0, "127.0.0.1");

    var serving = spawn {
      var peer = server.accept();
      peer.send("one");
      peer.send("two");
      peer.send("three");
      wait spawn time.Sleep(30);
      peer.close();
    };

    var client = ws.connect($"ws://127.0.0.1:{server.port}/");

    assert.equal(client.receive().text, "one");
    assert.equal(client.receive().text, "two");
    assert.equal(client.receive().text, "three");

    client.close();
    wait serving;
    server.close();
  });

  test("a large message survives the frame split", func() {
    var server = ws.listen(0, "127.0.0.1");

    var big = "";
    for (var i = 0; i < 5000; i++) { big += "0123456789"; }

    var serving = spawn {
      var peer = server.accept();
      peer.send(peer.receive().text);
      peer.close();
    };

    var client = ws.connect($"ws://127.0.0.1:{server.port}/");
    client.send(big);

    assert.equal(length(client.receive().text), length(big));

    client.close();
    wait serving;
    server.close();
  });

  test("receive returns nil once the peer is gone", func() {
    var server = ws.listen(0, "127.0.0.1");

    var serving = spawn {
      var peer = server.accept();
      peer.send("bye");
      peer.close();
    };

    var client = ws.connect($"ws://127.0.0.1:{server.port}/");

    assert.equal(client.receive().text, "bye");
    assert.isNil(client.receive());

    client.close();
    wait serving;
    server.close();
  });
});

describe("ws: the handshake", func() {
  test("a URL must name the ws scheme", func() {
    assert.throws(func() { ws.connect("http://127.0.0.1:80/"); }, "not a WebSocket URL");
    assert.throws(func() { ws.connect("127.0.0.1"); }, "not a WebSocket URL");
  });

  // wss:// is the same protocol over TLS; see test/library/tls.test.ml for the
  // encrypted round trip. Here we only check that the scheme is understood.
  test("wss is accepted as a scheme", func() {
    var err = assert.throws(func() { ws.connect("wss://127.0.0.1:1/"); });

    assert.notIncludes(err.message, "not a WebSocket URL");
    assert.includes(err.message, "cannot connect");
  });

  test("connecting where nothing listens fails", func() {
    var server = ws.listen(0, "127.0.0.1");
    var port = server.port;
    server.close();

    assert.throws(func() { ws.connect($"ws://127.0.0.1:{port}/"); }, "cannot connect");
  });

  test("the path reaches the server", func() {
    var server = ws.listen(0, "127.0.0.1");

    var serving = spawn {
      var peer = server.accept();
      peer.send("connected");
      peer.close();
    };

    var client = ws.connect($"ws://127.0.0.1:{server.port}/rooms/42");

    assert.equal(client.receive().text, "connected");

    client.close();
    wait serving;
    server.close();
  });
});

describe("ws: resources", func() {
  test("close is idempotent", func() {
    var server = ws.listen(0, "127.0.0.1");

    server.close();
    server.close();

    assert.isTrue(server.closed);
  });

  test("defer releases a server", func() {
    func scoped() {
      var server = defer ws.listen(0, "127.0.0.1");
      return server;
    }

    assert.isTrue(scoped().closed);
  });

  test("defer releases a connection", func() {
    var server = ws.listen(0, "127.0.0.1");

    server.accept(func(peer) { peer.send("hi"); });

    func scoped() {
      var client = defer ws.connect($"ws://127.0.0.1:{server.port}/");
      assert.equal(client.receive().text, "hi");
      return client;
    }

    assert.isTrue(scoped().closed);
    server.close();
  });

  test("using a closed connection is an error", func() {
    var server = ws.listen(0, "127.0.0.1");
    server.accept(func(peer) { peer.close(); });

    var client = ws.connect($"ws://127.0.0.1:{server.port}/");
    client.close();

    assert.throws(func() { client.send("x"); }, "already closed");

    server.close();
  });
});

describe("ws: several clients", func() {
  test("accept(handler) serves each connection on its own task", func() {
    var server = ws.listen(0, "127.0.0.1");
    var served = 0;

    server.accept(func(peer) {
      served += 1;
      peer.send($"client {served}");
    });

    var first = ws.connect($"ws://127.0.0.1:{server.port}/");
    assert.equal(first.receive().text, "client 1");

    var second = ws.connect($"ws://127.0.0.1:{server.port}/");
    assert.equal(second.receive().text, "client 2");

    first.close();
    second.close();
    server.close();
  });
});

finish("ws");
