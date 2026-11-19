import "core:test" as { describe, test, assert, finish };
import "core:udp";
import "core:binary";
import "core:time";

describe("udp: sending and receiving", func() {
  test("a datagram arrives with its sender", func() {
    var listener = udp.open(0);
    var sender = udp.open(0);

    sender.send("hello udp", "127.0.0.1", listener.port);

    var packet = listener.receive();

    assert.equal(packet.data.toString(), "hello udp");
    assert.equal(packet.port, sender.port);
    assert.equal(packet.address, "127.0.0.1");

    listener.close();
    sender.close();
  });

  test("binary payloads survive", func() {
    var listener = udp.open(0);
    var sender = udp.open(0);
    var payload = binary.writer().u32(7).u16(9).build();

    sender.send(payload, "127.0.0.1", listener.port);

    var reader = binary.reader(listener.receive().data);

    assert.equal(reader.u32(), 7);
    assert.equal(reader.u16(), 9);

    listener.close();
    sender.close();
  });

  test("several datagrams are queued in order", func() {
    var listener = udp.open(0);
    var sender = udp.open(0);

    sender.send("one", "127.0.0.1", listener.port);
    sender.send("two", "127.0.0.1", listener.port);

    assert.equal(listener.receive().data.toString(), "one");
    assert.equal(listener.receive().data.toString(), "two");

    listener.close();
    sender.close();
  });

  test("send reports how many bytes went out", func() {
    var listener = udp.open(0);
    var sender = udp.open(0);

    assert.equal(sender.send("12345", "127.0.0.1", listener.port), 5);

    listener.receive();
    listener.close();
    sender.close();
  });
});

describe("udp: waiting", func() {
  test("receive with a timeout gives up and returns nil", func() {
    var socket = udp.open(0);

    assert.isNil(socket.receive(30));

    socket.close();
  });

  test("a timeout does not lose a datagram that arrives in time", func() {
    var listener = udp.open(0);
    var sender = udp.open(0);

    var sending = spawn {
      wait spawn time.Sleep(10);
      sender.send("late but there", "127.0.0.1", listener.port);
    };

    var packet = listener.receive(500);

    assert.notNil(packet);
    assert.equal(packet.data.toString(), "late but there");

    wait sending;
    listener.close();
    sender.close();
  });

  test("pending counts what has arrived", func() {
    var listener = udp.open(0);
    var sender = udp.open(0);

    assert.equal(listener.pending(), 0);

    sender.send("x", "127.0.0.1", listener.port);
    listener.receive();

    assert.equal(listener.pending(), 0);

    listener.close();
    sender.close();
  });

  test("waiting does not block other tasks", func() {
    var socket = udp.open(0);
    var ticks = 0;
    var running = true;

    var ticker = spawn {
      while (running) {
        ticks += 1;
        wait spawn time.Sleep(1);
      }
    };

    socket.receive(50);

    running = false;
    wait ticker;

    assert.greater(ticks, 1);

    socket.close();
  });
});

describe("udp: resources", func() {
  test("the bound port is reported", func() {
    var socket = udp.open(0);

    assert.greater(socket.port, 0);
    assert.equal(socket.address, "0.0.0.0");

    socket.close();
  });

  test("close is idempotent", func() {
    var socket = udp.open(0);

    socket.close();
    socket.close();

    assert.isTrue(socket.closed);
  });

  test("defer releases the socket", func() {
    func scoped() {
      var socket = defer udp.open(0);
      return socket;
    }

    assert.isTrue(scoped().closed);
  });

  test("using a closed socket is an error", func() {
    var socket = udp.open(0);
    socket.close();

    assert.throws(func() { socket.send("x", "127.0.0.1", 9999); }, "already closed");
  });

  test("a port number must be in range", func() {
    assert.throws(func() { udp.open(99999); }, "between 0 and 65535");
  });
});

finish("udp");
