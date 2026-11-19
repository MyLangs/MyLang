import "core:test" as { describe, test, assert, finish };
import "syncbox";
import "time";

describe("syncbox: buffered channels", func() {
  test("capacity and length", func() {
    var c = syncbox.Chan(3);
    assert.equal(c.cap(), 3);
    assert.equal(c.len(), 0);
    c.send(1);
    c.send(2);
    assert.equal(c.len(), 2);
  });

  test("values arrive in FIFO order by default", func() {
    var c = syncbox.Chan(3);
    c.send(1);
    c.send(2);
    c.send(3);
    assert.equal(c.recv(), 1);
    assert.equal(c.recv(), 2);
    assert.equal(c.recv(), 3);
    assert.equal(c.len(), 0);
  });

  test("lifo mode returns the newest value first", func() {
    var c = syncbox.Chan(3, { mode: "lifo" });
    c.send(1);
    c.send(2);
    c.send(3);
    assert.equal(c.recv(), 3);
    assert.equal(c.recv(), 2);
    assert.equal(c.recv(), 1);
  });

  test("explicit fifo mode", func() {
    var c = syncbox.Chan(3, { mode: "fifo" });
    c.send(1);
    c.send(2);
    assert.equal(c.recv(), 1);
  });

  test("any value can be sent, including nil and objects", func() {
    var c = syncbox.Chan(3);
    var o = { a: 1 };
    c.send(o);
    c.send(nil);
    c.send([1, 2]);
    assert.equal(c.recv(), o);
    assert.isNil(c.recv());
    assert.equal(c.recv(), [1, 2]);
  });

  test("trySend and tryRecv never block", func() {
    var c = syncbox.Chan(1);
    assert.isTrue(c.trySend("a"));
    assert.isFalse(c.trySend("b"));
    assert.equal(c.tryRecv(), "a");
    assert.isNil(c.tryRecv());
  });

  test("an empty channel's tryRecv returns nil", func() {
    assert.isNil(syncbox.Chan(2).tryRecv());
  });

  test("a channel of size 0 has no buffer for trySend", func() {
    var c = syncbox.Chan(0);
    assert.isFalse(c.trySend(1));
    assert.equal(c.len(), 0);
  });
});

describe("syncbox: overflow policies", func() {
  test("drop oldest evicts the head when full", func() {
    var c = syncbox.Chan(2, { drop: "oldest" });
    c.send(1);
    c.send(2);
    c.send(3);
    assert.equal(c.len(), 2);
    assert.equal(c.recv(), 2);
    assert.equal(c.recv(), 3);
  });

  test("drop newest discards the new value when full", func() {
    var c = syncbox.Chan(2, { drop: "newest" });
    c.send(1);
    c.send(2);
    c.send(3);
    assert.equal(c.len(), 2);
    assert.equal(c.recv(), 1);
    assert.equal(c.recv(), 2);
  });

  test("sends never block when a drop policy is set", func() {
    var c = syncbox.Chan(1, { drop: "newest" });
    for (var i = 0; i < 10; i++) { c.send(i); }
    assert.equal(c.recv(), 0);
  });
});

describe("syncbox: blocking behaviour", func() {
  test("an unbuffered send waits for the receiver (rendezvous)", func() {
    var c = syncbox.Chan(0);
    var got = [];
    var receiver = spawn { got[length(got)] = c.recv(); };
    c.send("hello");
    wait receiver;
    assert.equal(got, ["hello"]);
  });

  test("producer and consumer exchange values in order", func() {
    var c = syncbox.Chan(0);
    var out = [];
    var consumer = spawn {
      for (var i = 0; i < 3; i++) { out[length(out)] = c.recv(); }
    };
    for (var i = 0; i < 3; i++) { c.send(i * 10); }
    wait consumer;
    assert.equal(out, [0, 10, 20]);
  });

  test("recv waits until something is sent", func() {
    var c = syncbox.Chan(1);
    var log = [];
    var receiver = spawn {
      log[length(log)] = "waiting";
      var v = c.recv();
      log[length(log)] = v;
    };
    time.Sleep(20);
    log[length(log)] = "sending";
    c.send(42);
    wait receiver;
    assert.equal(log, ["waiting", "sending", 42]);
  });

  test("send waits while the buffer is full and resumes after a recv", func() {
    var c = syncbox.Chan(1);
    var log = [];
    var sender = spawn {
      c.send(1);
      log[length(log)] = "sent1";
      c.send(2);
      log[length(log)] = "sent2";
    };
    time.Sleep(20);
    assert.equal(log, ["sent1"]);
    assert.equal(c.recv(), 1);
    wait sender;
    assert.equal(log, ["sent1", "sent2"]);
    assert.equal(c.recv(), 2);
  });

  test("several blocked senders are released in order", func() {
    var c = syncbox.Chan(1);
    var senders = [];
    c.send(0);
    for (var i = 1; i <= 3; i++) {
      var n = i;
      senders[length(senders)] = spawn { c.send(n); };
      time.Sleep(5);
    }
    var received = [];
    for (var j = 0; j < 4; j++) { received[length(received)] = c.recv(); }
    for (var s in senders) { wait s; }
    assert.equal(received, [0, 1, 2, 3]);
  });

  test("a recv timeout returns nil when nothing arrives", func() {
    var c = syncbox.Chan(1, { timeout: 30 });
    var start = time.now();
    assert.isNil(c.recv());
    assert.greaterOrEqual(time.now() - start, 25);
  });

  test("a fan-in of several producers", func() {
    var c = syncbox.Chan(0);
    var producers = [];
    for (var i = 0; i < 3; i++) {
      var id = i;
      producers[length(producers)] = spawn { c.send(id); };
    }
    var seen = [];
    for (var j = 0; j < 3; j++) { seen[length(seen)] = c.recv(); }
    for (var p in producers) { wait p; }
    assert.lengthOf(seen, 3);
    assert.includes(seen, 0);
    assert.includes(seen, 1);
    assert.includes(seen, 2);
  });
});

describe("syncbox: closing", func() {
  test("isClosed reflects close()", func() {
    var c = syncbox.Chan(1);
    assert.isFalse(c.isClosed());
    c.close();
    assert.isTrue(c.isClosed());
  });

  test("buffered values can still be received after close", func() {
    var c = syncbox.Chan(2);
    c.send(1);
    c.close();
    assert.equal(c.recv(), 1);
    assert.isNil(c.recv());
  });

  test("sending on a closed channel is an error", func() {
    var c = syncbox.Chan(1);
    c.close();
    assert.throws(func() { c.send(1); }, "closed or expired");
    assert.isFalse(c.trySend(1));
  });

  test("closing twice is harmless", func() {
    var c = syncbox.Chan(1);
    c.close();
    assert.doesNotThrow(func() { c.close(); });
  });

  test("a closed empty channel returns nil immediately", func() {
    var c = syncbox.Chan(0);
    c.close();
    assert.isNil(c.recv());
  });

  test("a time-to-live expires the channel", func() {
    var c = syncbox.Chan(1, { ttl: 20 });
    time.Sleep(40);
    assert.throws(func() { c.send(1); }, "closed or expired");
    assert.isFalse(c.trySend(1));
  });
});

describe("syncbox: replay and hooks", func() {
  test("replay keeps the most recent sends", func() {
    var c = syncbox.Chan(5, { replay: 2 });
    c.send(1);
    c.send(2);
    c.send(3);
    assert.equal(c.getReplay(), [2, 3]);
  });

  test("replayClear forgets them", func() {
    var c = syncbox.Chan(5, { replay: 2 });
    c.send(1);
    c.replayClear();
    assert.equal(c.getReplay(), []);
  });

  test("without the replay option nothing is kept", func() {
    var c = syncbox.Chan(5);
    c.send(1);
    assert.equal(c.getReplay(), []);
  });

  test("onSend, onRecv and onClose hooks fire", func() {
    var log = [];
    var c = syncbox.Chan(2, {
      onSend: func(v) { log[length(log)] = "send" + v; },
      onRecv: func(v) { log[length(log)] = "recv" + v; },
      onClose: func() { log[length(log)] = "closed"; }
    });
    c.send(1);
    c.recv();
    c.close();
    time.Sleep(20);
    assert.equal(log, ["send1", "recv1", "closed"]);
  });
});

describe("syncbox: validation", func() {
  test("the size must be a number", func() {
    assert.throws(func() { syncbox.Chan("x"); }, "must be of type number");
  });

  test("options must be an object", func() {
    assert.throws(func() { syncbox.Chan(1, 5); }, "must be of type object");
  });
});

finish("syncbox");
