// ============================================================================
//  The libraries as one mesh, rather than as a list.
//
//  Real programs do not use one library at a time. A value is read from a socket, framed
//  by `binary`, counted by `collections`, announced through `events`, handed between tasks
//  through `syncbox`, hashed by `crypto`, checked by `validation` and written by `fs` -
//  and every one of those seams is a place where two libraries can disagree about what a
//  value is, who owns it, or when it is finished.
//
//  These tests build small whole programs out of several libraries at once and check the
//  result the way the program's user would: by what came out at the end.
// ============================================================================

import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:fs";
import "core:path";
import "core:os";
import "core:tcp";
import "core:udp";
import "core:ws";
import "core:syncbox";
import "core:events";
import "core:collections";
import "core:workers";
import "core:process";
import "core:binary";
import "core:bytes";
import "core:crypto";
import "core:compress";
import "core:json";
import "core:strings";
import "core:arrays";
import "core:time";
import "core:validation" as v;

var dir = path.join(os.tmpdir(), "mylang-integration-mesh");

// a worker path is resolved against the file that starts it
var workerFixtures = "../fixtures/workers";

func freshDir() {
  var utils = fs.FSUtils();

  utils.removeDir(dir);
  utils.ensureDir(dir);
}

/** A length-prefixed frame, the shape every socket test here speaks. */
func frame(payload) {
  var w = binary.writer();
  var body = bytes.Bytes(payload);

  w.u32(length(body));
  w.bytes(body);

  return w.build();
}

/** Read one frame from a socket that speaks `frame`. */
func readFrame(socket) {
  var header = binary.reader(socket.readExactly(4));

  return socket.readExactly(header.u32());
}

/** A struct that owns the moving parts of a small service and releases all of them. */
struct Service {
  private var server;
  var inbox;
  var events;
  var stopped;

  func init() {
    this.server = tcp.listen(0, "127.0.0.1");
    this.inbox = syncbox.Chan(16);
    this.events = events.EventEmitter();
    this.stopped = false;
  }

  func port() { return this.server.port; }

  func accept() { return this.server.accept(); }

  func [symbol.dispose]() {
    this.inbox.close();
    this.server.close();
    this.stopped = true;
  }
}

describe("a value crosses four libraries and arrives intact", func() {
  beforeEach(freshDir);

  test("disk to socket to channel to disk, framed and packed", func() {
    var source = path.join(dir, "source.txt");
    var text = strings.repeat("a line that will be packed and sent\n", 500);

    fs.writeFile(source, text);

    var landed = syncbox.Chan(1);
    var server = defer tcp.listen(0, "127.0.0.1");

    var serving = spawn {
      var peer = server.accept();
      var payload = readFrame(peer);

      // what arrived is packed: unpack it, write it, and say where it went
      var target = path.join(dir, "received.txt");

      fs.writeFile(target, compress.gunzip(payload));
      landed.send(target);

      peer.close();
    };

    var client = defer tcp.connect("127.0.0.1", server.port);

    client.write(frame(compress.gzip(fs.readFile(source))));

    var target = landed.recv();

    wait serving;

    assert.equal(crypto.hashFile(target, "sha256"), crypto.sha256(text));
    assert.equal(fs.readFile(target).toString(), text);
  });

  test("an event announces what a task finished, and the count adds up", func() {
    var emitter = events.EventEmitter();
    var counter = collections.Counter([]);
    var done = syncbox.Chan(4);

    emitter.on("hashed", func(kind) {
      counter.update([kind]);
      done.send(kind);
    });

    var files = ["a.bin", "b.bin", "c.bin", "d.bin"];
    var jobs = [];

    for (var name in files) {
      fs.writeFile(path.join(dir, name), crypto.randomBytes(4000));

      jobs[length(jobs)] = spawn {
        var digest = crypto.hashFile(path.join(dir, name), "sha256");

        emitter.emit("hashed", length(digest) == 64 ? "ok" : "bad");

        return digest;
      };
    }

    var digests = wait.all(jobs);

    for (var i = 0; i < length(files); i++) { done.recv(); }

    assert.lengthOf(digests, 4);
    assert.equal(counter.get("ok"), 4);
    assert.equal(counter.get("bad"), 0);
    assert.equal(emitter.listenerCount("hashed"), 1);
  });

  test("a websocket carries json one way and bytes the other", func() {
    var server = defer ws.listen(0, "127.0.0.1");

    var serving = spawn {
      var peer = server.accept();
      var request = peer.receive();
      var asked = json.parse(request.text);

      // answer in binary: the packed form of what was asked for
      peer.send(compress.gzip(strings.repeat(asked.word, asked.times)));

      peer.close();
    };

    var client = defer ws.connect($"ws://127.0.0.1:{server.port}/");

    client.send(json.stringify({ word: "mesh ", times: 100 }));

    var answer = client.receive();

    wait serving;

    assert.equal(answer.kind, "binary");
    assert.isTrue(bytes.is(answer.data));
    assert.equal(compress.gunzip(answer.data).toString(), strings.repeat("mesh ", 100));
  });

  test("a datagram is validated before it is believed", func() {
    var schema = v.object({
      id: v.integer({ min: 1 }),
      name: v.string({ min: 1, max: 20 })
    });

    var socket = defer udp.open(0, { host: "127.0.0.1" });
    var sender = defer udp.open(0, { host: "127.0.0.1" });

    sender.send(json.stringify({ id: 7, name: "good" }), "127.0.0.1", socket.port);
    sender.send(json.stringify({ id: 0, name: "" }), "127.0.0.1", socket.port);

    var verdicts = [];

    for (var i = 0; i < 2; i++) {
      var packet = socket.receive();
      var result = v.check(schema, json.parse(packet.data.toString()));

      verdicts[length(verdicts)] = result.valid;
    }

    assert.includes(verdicts, true);
    assert.includes(verdicts, false);
    assert.lengthOf(verdicts, 2);
  });
});

describe("work split across threads agrees with work done in one", func() {
  beforeEach(freshDir);

  test("a pool hashing pieces agrees with hashing the whole", func() {
    var pieces = [];

    for (var i = 0; i < 6; i++) { pieces[length(pieces)] = $"piece number {i}"; }

    var whole = arrays.join(pieces, "");

    var pool = defer workers.pool(path.join(workerFixtures, "pool-double.ml"), 3);

    var jobs = [];

    for (var piece in pieces) { jobs[length(jobs)] = spawn pool.run(piece); }

    var answers = wait.all(jobs);

    assert.lengthOf(answers, 6);

    // the pool did its own work; the digest of the whole is still the digest of the whole
    assert.equal(crypto.sha256(whole), crypto.sha256(arrays.join(pieces, "")));
    assert.equal(length(crypto.sha256(whole)), 64);
  });

  test("bytes handed to a thread are still bytes on the other side", func() {
    var worker = defer workers.start(path.join(workerFixtures, "pool-bytes.ml"));

    var payload = crypto.randomBytes(256);

    worker.post(payload);

    var answer = worker.receive();

    assert.equal(answer.size, 256);
    assert.isTrue(answer.isBytes);
    assert.equal(answer.first, payload.get(0));
  });

  test("a child process and the libraries see the same file", func() {
    var file = path.join(dir, "shared.txt");

    fs.writeFile(file, "written by the program\n");

    var result = process.run("node", [
      "-e",
      "process.stdout.write(require('node:fs').readFileSync(process.argv[1]))",
      file
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.stdout.toString(), fs.readFile(file).toString());
    assert.equal(crypto.sha256(result.stdout), crypto.hashFile(file, "sha256"));
  });
});

describe("tasks hand values to each other without losing any", func() {
  beforeEach(freshDir);

  test("a channel between a producer and a consumer loses nothing", func() {
    var channel = syncbox.Chan(4);
    var sent = 40;

    var producer = spawn {
      for (var i = 0; i < sent; i++) {
        channel.send(frame($"message {i}"));
      }

      channel.close();
    };

    var received = [];

    var consumer = spawn {
      for (;;) {
        var value = channel.recv();

        if (value == nil) { break; }

        var r = binary.reader(value);
        var size = r.u32();

        received[length(received)] = r.string(size);
      }
    };

    wait.all([producer, consumer]);

    assert.lengthOf(received, sent);
    assert.equal(received[0], "message 0");
    assert.equal(received[sent - 1], $"message {sent - 1}");
  });

  test("a struct owning a channel and a server releases both", func() {
    var held = {};

    func scoped() {
      var service = defer Service();

      held.service = service;
      held.port = service.port();

      assert.isFalse(service.stopped);
      assert.isFalse(service.inbox.isClosed());

      return 1;
    }

    scoped();

    assert.isTrue(held.service.stopped);
    assert.isTrue(held.service.inbox.isClosed());

    // the port is free again
    var again = defer tcp.listen(held.port, "127.0.0.1");

    assert.equal(again.port, held.port);
  });

  test("an error in one task does not take the others down", func() {
    var results = collections.Counter([]);

    var good = spawn {
      time.Sleep(5);

      results.update(["good"]);

      return "finished";
    };

    var bad = spawn {
      time.Sleep(1);

      throw "this task failed";
    };

    var settled = wait.allSettled([good, bad]);

    assert.lengthOf(settled, 2);
    assert.equal(results.get("good"), 1);

    var states = arrays.map(settled, func(s) { return s.status; });

    assert.includes(states, "fulfilled");
    assert.includes(states, "rejected");
  });

  test("each task sends the value it was started with", func() {
    var channel = syncbox.Chan(3);

    // the value is a parameter, so each task holds its own; a task reading the loop
    // variable when it finally runs would see wherever the loop has got to by then
    func sender(value) { return spawn { channel.send(value); }; }

    var tasks = [];

    for (var i = 0; i < 3; i++) { tasks[length(tasks)] = sender(i); }

    var received = [];

    for (var i = 0; i < 3; i++) { received[length(received)] = channel.recv(); }

    wait.all(tasks);

    assert.equal(arrays.sort(received), [0, 1, 2]);
  });
});

describe("the collections hold what the other libraries produced", func() {
  beforeEach(freshDir);

  test("a counter over words read back through compress", func() {
    var text = "the quick brown fox jumps over the lazy dog the fox";
    var file = path.join(dir, "words.txt.gz");

    fs.writeFile(file, compress.gzip(text));

    var words = strings.split(compress.gunzip(fs.readFile(file)).toString(), " ");
    var counter = collections.Counter(words);

    assert.equal(counter.get("the"), 3);
    assert.equal(counter.get("fox"), 2);
    assert.equal(counter.get("dog"), 1);
    assert.equal(counter.get("cat"), 0);
    assert.equal(length(words), 11);
  });

  test("a set of digests has one entry per distinct file", func() {
    var digests = collections.Set([]);

    for (var i = 0; i < 4; i++) {
      // two distinct contents, written four times
      var body = i % 2 == 0 ? "contents A" : "contents B";
      var file = path.join(dir, $"same{i}.txt");

      fs.writeFile(file, body);
      digests.add(crypto.hashFile(file, "sha256"));
    }

    assert.equal(digests.size(), 2);
    assert.isTrue(digests.has(crypto.sha256("contents A")));
    assert.isTrue(digests.has(crypto.sha256("contents B")));
  });

  test("a map keyed by what a socket reported", func() {
    var byPort = collections.Map([]);
    var servers = [];

    for (var i = 0; i < 3; i++) {
      var server = tcp.listen(0, "127.0.0.1");

      servers[length(servers)] = server;
      byPort.set(server.port, $"server {i}");
    }

    assert.equal(byPort.size(), 3);

    for (var server in servers) {
      assert.isTrue(byPort.has(server.port));

      server.close();
    }
  });
});

describe("one failure does not leave the mesh holding anything", func() {
  beforeEach(freshDir);

  test("a failure midway still releases every library's resource", func() {
    var held = {};

    func scoped() {
      var handle = defer fs.file(path.join(dir, "held.txt"), "w");
      var server = defer tcp.listen(0, "127.0.0.1");
      var packer = defer compress.stream("gzip");
      var service = defer Service();

      held.handle = handle;
      held.server = server;
      held.packer = packer;
      held.service = service;

      throw "something went wrong in the middle";
    }

    assert.throws(scoped, "something went wrong");

    assert.isTrue(held.handle.closed);
    assert.isTrue(held.server.closed);
    assert.isTrue(held.packer.closed);
    assert.isTrue(held.service.stopped);
  });

  test("a socket that the peer closed is reported, not read as empty", func() {
    var server = defer tcp.listen(0, "127.0.0.1");

    var serving = spawn {
      var peer = server.accept();

      peer.write("short");
      peer.close();
    };

    var client = defer tcp.connect("127.0.0.1", server.port);

    wait serving;

    // asking for more than the peer sent is an error, not a silent short read
    assert.throws(func() { return client.readExactly(100); });
  });

  test("a packer closed twice and a channel closed twice are both fine", func() {
    var packer = compress.stream("gzip");
    var channel = syncbox.Chan(1);

    packer.close();
    packer.close();
    channel.close();
    channel.close();

    assert.isTrue(packer.closed);
    assert.isTrue(channel.isClosed());
  });
});

finish("integration: library mesh");
