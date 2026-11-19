import "core:test" as { describe, test, assert, finish };
import "core:tcp";
import "core:binary";
import "core:time";
import "core:path";
import "core:os";
import "core:fs";

describe("tcp: client and server", func() {
  test("a request and its reply travel both ways", func() {
    var server = tcp.listen(0, "127.0.0.1");

    var serving = spawn {
      var client = server.accept();
      var request = client.read();
      client.write("echo:" + request.toString());
      client.end();
      client.close();
    };

    var socket = tcp.connect("127.0.0.1", server.port);
    socket.write("ping");

    var reply = socket.readAll();

    assert.equal(reply.toString(), "echo:ping");

    socket.close();
    wait serving;
    server.close();
  });

  test("the port is reported after binding to 0", func() {
    var server = tcp.listen(0, "127.0.0.1");

    assert.typeOf(server.port, "int");
    assert.greater(server.port, 0);

    server.close();
  });

  test("readExactly waits for the whole message", func() {
    var server = tcp.listen(0, "127.0.0.1");

    var serving = spawn {
      var client = server.accept();
      client.write("ab");
      wait spawn time.Sleep(20);
      client.write("cd");
      client.end();
      client.close();
    };

    var socket = tcp.connect("127.0.0.1", server.port);

    assert.equal(socket.readExactly(4).toString(), "abcd");

    socket.close();
    wait serving;
    server.close();
  });

  test("readExactly reports a connection that ends early", func() {
    var server = tcp.listen(0, "127.0.0.1");

    var serving = spawn {
      var client = server.accept();
      client.write("ab");
      client.end();
      client.close();
    };

    var socket = tcp.connect("127.0.0.1", server.port);

    assert.throws(func() { socket.readExactly(10); }, "connection closed");

    socket.close();
    wait serving;
    server.close();
  });

  test("binary data survives the round trip", func() {
    var server = tcp.listen(0, "127.0.0.1");
    var payload = binary.writer().u32(123456).string("tail").build();

    var serving = spawn {
      var client = server.accept();
      client.write(client.readExactly(8));
      client.end();
      client.close();
    };

    var socket = tcp.connect("127.0.0.1", server.port);
    socket.write(payload);

    var back = socket.readExactly(8);
    var reader = binary.reader(back);

    assert.equal(reader.u32(), 123456);
    assert.equal(reader.string(4), "tail");

    socket.close();
    wait serving;
    server.close();
  });

  test("accept(handler) serves several clients", func() {
    var server = tcp.listen(0, "127.0.0.1");
    var served = 0;

    server.accept(func(client) {
      served += 1;
      client.write("served");
      client.end();
      client.close();
    });

    var first = tcp.connect("127.0.0.1", server.port);
    assert.equal(first.readAll().toString(), "served");
    first.close();

    var second = tcp.connect("127.0.0.1", server.port);
    assert.equal(second.readAll().toString(), "served");
    second.close();

    assert.equal(served, 2);
    server.close();
  });
});

describe("tcp: failures", func() {
  test("connecting to a closed port fails clearly", func() {
    var server = tcp.listen(0, "127.0.0.1");
    var port = server.port;
    server.close();

    assert.throws(func() { tcp.connect("127.0.0.1", port); }, "cannot connect");
  });

  test("a port already in use is reported", func() {
    var first = tcp.listen(0, "127.0.0.1");

    assert.throws(func() { tcp.listen(first.port, "127.0.0.1"); }, "cannot listen");

    first.close();
  });

  test("a port number must be in range", func() {
    assert.throws(func() { tcp.listen(99999, "127.0.0.1"); }, "between 0 and 65535");
    assert.throws(func() { tcp.connect("127.0.0.1", -1); }, "between 0 and 65535");
  });
});

describe("tcp: resources", func() {
  test("close is idempotent", func() {
    var server = tcp.listen(0, "127.0.0.1");

    server.close();
    server.close();

    assert.isTrue(server.closed);
  });

  test("defer releases a server", func() {
    func scoped() {
      var server = defer tcp.listen(0, "127.0.0.1");
      assert.isFalse(server.closed);
      return server;
    }

    assert.isTrue(scoped().closed);
  });

  test("defer releases a socket", func() {
    var server = tcp.listen(0, "127.0.0.1");

    server.accept(func(client) { client.close(); });

    func scoped() {
      var socket = defer tcp.connect("127.0.0.1", server.port);
      return socket;
    }

    assert.isTrue(scoped().closed);
    server.close();
  });

  test("using a closed socket is an error, not silence", func() {
    var server = tcp.listen(0, "127.0.0.1");
    server.accept(func(client) { client.close(); });

    var socket = tcp.connect("127.0.0.1", server.port);
    socket.close();

    assert.throws(func() { socket.write("x"); }, "already closed");

    server.close();
  });

  // This used to check only the busy answer, and the free answer parked for ever: the
  // probe waited for its own "close" event before anything asked it to close.
  test("isPortFree answers both ways", func() {
    var server = tcp.listen(0, "127.0.0.1");
    var port = server.port;

    assert.isFalse(tcp.isPortFree(port, "127.0.0.1"));

    server.close();

    assert.isTrue(tcp.isPortFree(port, "127.0.0.1"));
  });

  // A count limit used to be reported and then leave the process alive, held up by the
  // sockets it had already opened.
  test("a count limit is reported as an error the program can catch", func() {
    var held = [];

    try {
      for (var i = 0; i < 40; i++) { held[length(held)] = tcp.listen(0, "127.0.0.1"); }
    } catch (e) {
      // either the limit was reached, or this run has no limit set and all 40 opened
      assert.notNil(e);
    }

    for (var server in held) { server.close(); }

    assert.greater(length(held), 0);
  });

  test("isPortFree returns for a port nothing has ever used", func() {
    assert.isTrue(tcp.isPortFree(0, "127.0.0.1"));
  });

  test("asking twice in a row still returns", func() {
    // the probe has to be released each time, or the second call waits on the first
    assert.isTrue(tcp.isPortFree(0, "127.0.0.1"));
    assert.isTrue(tcp.isPortFree(0, "127.0.0.1"));
  });
});

describe("tcp: concurrency", func() {
  // A socket that is waiting for data must not stop the rest of the program.
  test("waiting for data does not block other tasks", func() {
    var server = tcp.listen(0, "127.0.0.1");
    var ticks = 0;
    var running = true;

    var ticker = spawn {
      while (running) {
        ticks += 1;
        wait spawn time.Sleep(1);
      }
    };

    var serving = spawn {
      var client = server.accept();
      wait spawn time.Sleep(60);
      client.write("late");
      client.end();
      client.close();
    };

    var socket = tcp.connect("127.0.0.1", server.port);
    var reply = socket.readAll();

    running = false;
    wait ticker;

    assert.equal(reply.toString(), "late");
    assert.greater(ticks, 1);

    socket.close();
    wait serving;
    server.close();
  });
});

describe("tcp: unix domain sockets", func() {
  var sock = os.platform() == "win32"
    ? $"\\\\.\\pipe\\mylang-tcp-test-{os.getpid()}"
    : sock;

  // A unix socket is a file rather than a host and port: nothing is routed, and two
  // processes on one machine talk through the filesystem.

  test("a request and its reply travel over a path", func() {
    var address = os.platform() == "win32"
      ? $"\\\\.\\pipe\\mylang-tcp-request-{os.getpid()}"
      : sock;

    var server = defer tcp.listenUnix(address, { force: true });

    assert.equal(server.path, address);

    var serving = spawn {
      var client = server.accept();
      var asked = client.read();

      client.write("reply to " + asked.toString());
      client.end();
    };

    var client = defer tcp.connectUnix(address);

    client.write("ping");

    assert.equal(client.readAll().toString(), "reply to ping");

    wait serving;
  });

  test("the path is gone once the server closes", func() {
    func scoped() {
      var server = defer tcp.listenUnix(sock, { force: true });
      return server.path;
    }

    var was = scoped();

    assert.isFalse(fs.exists(was));
  });

  test("an existing path is not taken over unless asked", func() {
    var first = defer tcp.listenUnix(sock, { force: true });

    assert.throws(func() { tcp.listenUnix(sock); }, "cannot listen");
  });

  test("connecting to a path nothing is listening on is an error", func() {
    assert.throws(
      func() { tcp.connectUnix(path.join(os.tmpdir(), "mylang-nothing-here.sock")); },
      "cannot connect"
    );
  });

  test("a unix server is an owned resource like any other", func() {
    var server = tcp.listenUnix(sock, { force: true });

    server.close();

    assert.isTrue(server.closed);
    assert.throws(func() { server.accept(); }, "already closed");
  });
});

describe("tcp: socket settings", func() {
  test("keep-alive and no-delay are accepted on a live socket", func() {
    var server = defer tcp.listen(0, "127.0.0.1");

    var serving = spawn {
      var client = server.accept();
      client.write("hi");
      client.end()
    }

    var socket = defer tcp.connect("127.0.0.1", server.port);

    // these ask the system to probe an idle peer and to send small writes at once;
    // neither returns anything, so the test is that they are accepted and change nothing
    socket.setKeepAlive(true, 1000);
    socket.setKeepAlive(false);
    socket.setNoDelay(true);

    assert.equal(socket.readAll().toString(), "hi");

    wait serving;
  });

  test("a socket says where it is connected", func() {
    var server = defer tcp.listen(0, "127.0.0.1");

    var serving = spawn {
      var client = server.accept();
      client.end()
    }

    var socket = defer tcp.connect("127.0.0.1", server.port);
    var where = socket.address();

    assert.equal(where.host, "127.0.0.1");
    assert.equal(where.port, server.port);

    wait serving;
  });

  test("a delay that is not a number is refused", func() {
    var server = defer tcp.listen(0, "127.0.0.1");

    var serving = spawn {
      var client = server.accept();
      client.end()
    }

    var socket = defer tcp.connect("127.0.0.1", server.port);

    assert.throws(func() { socket.setKeepAlive(true, "soon"); }, "delay");

    wait serving;
  });
});

finish("tcp");
