// ============================================================================
//  Resources and permissions across libraries.
//
//  Every library that owns something — a file handle, a socket, a server, a thread, a
//  compression stream — carries `symbol.dispose` and takes a counted slot. These tests
//  check that the protocol is really one protocol: that `defer` releases all of them the
//  same way, that slots come back, that release happens in the right order when several
//  libraries are involved, and that asking what is permitted agrees with what happens.
// ============================================================================

import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:fs";
import "core:path";
import "core:os";
import "core:tcp";
import "core:udp";
import "core:net/http";
import "core:compress";
import "core:workers";
import "core:process";
import "core:crypto";
import "core:time";
import "core:arrays";

var dir = path.join(os.tmpdir(), "mylang-integration-resources");

func freshDir() {
  var utils = fs.FSUtils();

  utils.removeDir(dir);
  utils.ensureDir(dir);
}

// A `func` declaration is not hoisted: a describe callback runs while `describe` is
// called, so a helper it uses has to be declared before that point.
func makeTracked(order, name) {
  return {
    name: name,
    [symbol.dispose]: func() { order[length(order)] = name; }
  };
}

describe("every owned thing answers to defer", func() {
  beforeEach(freshDir);

  test("a file handle, a socket, a server and a stream all release", func() {
    fs.writeFile(path.join(dir, "a.txt"), "contents");

    var closed = {};

    func scoped() {
      var handle = defer fs.file(path.join(dir, "a.txt"), "r");
      var server = defer tcp.listen(0, "127.0.0.1");
      var socket = defer udp.open(0, { host: "127.0.0.1" });
      var packer = defer compress.stream("gzip");

      return { handle: handle, server: server, socket: socket, packer: packer };
    }

    var held = scoped();

    assert.isTrue(held.handle.closed);
    assert.isTrue(held.server.closed);
    assert.isTrue(held.socket.closed);
    assert.isTrue(held.packer.closed);
  });

  test("closing twice is never an error, for any of them", func() {
    fs.writeFile(path.join(dir, "b.txt"), "x");

    var handle = fs.file(path.join(dir, "b.txt"), "r");
    var server = tcp.listen(0, "127.0.0.1");
    var packer = compress.stream("gzip");

    handle.close();
    handle.close();
    server.close();
    server.close();
    packer.close();
    packer.close();

    assert.isTrue(handle.closed);
    assert.isTrue(server.closed);
    assert.isTrue(packer.closed);
  });

  test("release happens in reverse order across libraries", func() {
    var order = [];

    func scoped() {
      var first = defer makeTracked(order, "first");
      var second = defer makeTracked(order, "second");
      var third = defer makeTracked(order, "third");

      order[length(order)] = "body";
    }

    scoped();

    assert.equal(arrays.join(order, ","), "body,third,second,first");
  });

  test("a throw does not stop the releases", func() {
    var order = [];

    func scoped() {
      var a = defer makeTracked(order, "a");
      var b = defer makeTracked(order, "b");

      throw "something went wrong";
    }

    assert.throws(scoped, "something went wrong");
    assert.equal(arrays.join(order, ","), "b,a");
  });

  test("a real handle is released even when the body throws", func() {
    var file = path.join(dir, "thrown.txt");

    func scoped() {
      var handle = defer fs.file(file, "w");

      handle.write("written anyway\n");

      throw "after the write";
    }

    assert.throws(scoped, "after the write");
    assert.equal(fs.readFile(file).toString(), "written anyway\n");
  });
});

describe("counted slots come back", func() {
  beforeEach(freshDir);

  // Without a limit these just have to not leak; the limit itself is exercised by
  // test/library/tcp.test.ml, which proves the refusal is an ordinary error.
  test("opening and closing many files in a loop does not run out", func() {
    var file = path.join(dir, "loop.txt");

    fs.writeFile(file, "x");

    for (var i = 0; i < 60; i++) {
      var handle = defer fs.file(file, "r");

      assert.equal(handle.read(1).toString(), "x");
    }

    assert.isTrue(true);
  });

  test("opening and closing many sockets in a loop does not run out", func() {
    for (var i = 0; i < 40; i++) {
      var server = defer tcp.listen(0, "127.0.0.1");

      assert.greater(server.port, 0);
    }

    assert.isTrue(true);
  });

  test("many short-lived tasks do not run out", func() {
    for (var round = 0; round < 10; round++) {
      var jobs = [];

      for (var i = 0; i < 12; i++) { jobs[length(jobs)] = spawn crypto.sha256($"round {round} job {i}") }

      var digests = wait.all(jobs);

      assert.lengthOf(digests, 12);
    }

    assert.isTrue(true);
  });

  test("an http server gives its port back when released", func() {
    var port = 0;

    func scoped() {
      var server = defer http.Server();

      port = server.listen(0, "127.0.0.1").port;
    }

    scoped();

    assert.isTrue(tcp.isPortFree(port, "127.0.0.1"));
  });

  test("a tcp server gives its port back, and the next one can take it", func() {
    var first = tcp.listen(0, "127.0.0.1");
    var port = first.port;

    first.close();

    // the same port, bound again by a different server
    var second = defer tcp.listen(port, "127.0.0.1");

    assert.equal(second.port, port);
  });
});

describe("what is permitted agrees with what happens", func() {
  beforeEach(freshDir);

  test("process.can and the real call say the same thing about reading", func() {
    var file = path.join(dir, "ask.txt");

    fs.writeFile(file, "content");

    var allowed = process.can("read", file);

    if (allowed) {
      assert.equal(fs.readFile(file).toString(), "content");
    } else {
      assert.throws(func() { fs.readFile(file); }, "Permission denied");
    }
  });

  test("process.can and the real call agree about the network", func() {
    var allowed = process.can("net", "127.0.0.1");

    if (allowed) {
      var server = defer tcp.listen(0, "127.0.0.1");

      assert.greater(server.port, 0);
    } else {
      assert.throws(func() { tcp.listen(0, "127.0.0.1"); }, "Permission denied");
    }
  });

  test("the policy describes itself consistently", func() {
    var policy = process.permissions();

    assert.typeOf(policy.sandboxed, "boolean");
    assert.notNil(policy.read);
    assert.notNil(policy.write);
    assert.notNil(policy.net);

    // if nothing is sandboxed then every kind must be allowed, and the reverse
    if (!policy.sandboxed) {
      assert.isTrue(process.can("read", "/"));
      assert.isTrue(process.can("net", "example.com"));
    }
  });

  test("asking about a kind that takes no target still answers", func() {
    assert.typeOf(process.can("worker", ""), "boolean");
    assert.typeOf(process.can("sys", "cpus"), "boolean");
    assert.typeOf(process.can("env", "HOME"), "boolean");
  });
});

describe("a resource shared between libraries behaves once", func() {
  beforeEach(freshDir);

  test("a socket written by one task and closed by another", func() {
    var server = defer tcp.listen(0, "127.0.0.1");

    var serving = spawn {
      var client = server.accept();
      var seen = client.readAll();

      client.close();

      return seen.toString();
    }

    var socket = tcp.connect("127.0.0.1", server.port);

    var writing = spawn {
      socket.write("written by another task");
      socket.end();

      return "written";
    }

    wait writing;

    var outcome = wait serving;

    socket.close();

    assert.equal(outcome.result, "written by another task");
    assert.isTrue(socket.closed);
  });

  test("a file written through a handle is readable at once by the whole-file call", func() {
    var file = path.join(dir, "handover.txt");

    func write() {
      var handle = defer fs.file(file, "w");

      handle.write("first\n");
      handle.write("second\n");
    }

    write();

    // the handle is released by now, so everything it wrote must be on disk
    assert.equal(fs.readFile(file).toString(), "first\nsecond\n");
    assert.equal(fs.stat(file).size(), 13);
  });

  test("a compression stream's output is accepted by the whole-value decompressor", func() {
    var packer = defer compress.stream("gzip");

    for (var i = 0; i < 20; i++) { packer.write($"row {i};"); }

    var packed = packer.finish();
    var back = compress.gunzip(packed).toString();

    assert.includes(back, "row 0;");
    assert.includes(back, "row 19;");
  });

  test("a worker's answer is a value every other library accepts", func() {
    fs.writeFile(
      path.join(dir, "digest.ml"),
      'import "core:crypto";\n' +
        "for (;;) { var t = worker.receive(); if (t == nil) { break; } worker.post(crypto.sha256(t)); }"
    );

    var w = defer workers.start(path.join(dir, "digest.ml"));

    w.post("hash me");

    var digest = w.receive();

    // the worker's answer and the same hash computed here must agree
    assert.equal(digest, crypto.sha256("hash me"));
    assert.equal(length(digest), 64);
  });

  test("bytes from a worker survive the crossing and are still bytes", func() {
    fs.writeFile(
      path.join(dir, "bytes.ml"),
      'import "core:crypto";\n' +
        "for (;;) { var n = worker.receive(); if (n == nil) { break; } worker.post(crypto.randomBytes(n)); }"
    );

    var w = defer workers.start(path.join(dir, "bytes.ml"));

    w.post(128);

    var block = w.receive();

    assert.equal(length(block), 128);
    assert.equal(length(crypto.sha256(block)), 64);
    assert.equal(length(compress.gzip(block)) > 0, true);
  });
});

finish("integration: resources");
