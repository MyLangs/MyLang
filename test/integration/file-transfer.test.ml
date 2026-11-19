// ============================================================================
//  Sending files over HTTP and HTTPS.
//
//  A file leaving one program and arriving in another crosses more libraries than any
//  other ordinary task: `fs` reads it, `crypto` vouches for it, `compress` or `archive`
//  may pack it, `json` describes it, `net/http` carries it, and `tls` wraps the carrying.
//  These tests send real bytes through a real socket and check that what arrives is what
//  left - the same length, the same digest, byte for byte - over both schemes, and that
//  the ways this can go wrong (an untrusted certificate, a body past the limit, a digest
//  that does not match) are reported rather than quietly accepted.
//
//  The certificate is the self-signed pair the `tls` tests use, so nothing here needs a
//  network or a certificate authority.
// ============================================================================

import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:net/http";
import "core:fs";
import "core:path";
import "core:os";
import "core:crypto";
import "core:compress";
import "core:archive";
import "core:json";
import "core:bytes";
import "core:arrays";
import "core:strings";
import "core:time";

var dir = path.join(os.tmpdir(), "mylang-integration-file-transfer");

var certPem = fs.readFile(path.join("test", "fixtures", "tls", "cert.pem")).toString();
var keyPem = fs.readFile(path.join("test", "fixtures", "tls", "key.pem")).toString();

func freshDir() {
  var utils = fs.FSUtils();

  utils.removeDir(dir);
  utils.ensureDir(dir);
}

/** Where a received upload is written, one name per test. */
func inbox(name) { return path.join(dir, "inbox-" + name); }

/** A file of `size` pseudo-random bytes, with its digest. */
func makeFile(name, size) {
  var body = crypto.randomBytes(size);
  var file = path.join(dir, name);

  fs.writeFile(file, body);

  return { path: file, body: body, sha256: crypto.sha256(body), size: size };
}

/**
 * A server that stores whatever is posted to `/upload` and serves it back from
 * `/download/:name`, over https when `secure` is true and plain http when it is not.
 */
func uploadServer(secure) {
  var options = { bodyLimit: 8000000 };

  if (secure) {
    options.key = keyPem;
    options.cert = certPem;
  }

  var server = http.Server(options);

  server.post("/upload/:name", func(ctx) {
    var target = inbox(ctx.params.name);

    fs.writeFile(target, ctx.body);

    ctx.json({
      stored: ctx.params.name,
      bytes: length(ctx.body),
      sha256: crypto.sha256(ctx.body),
      secure: ctx.secure
    });
  });

  // the upload has to match the digest the sender promised in a header
  server.post("/verified/:name", func(ctx) {
    var promised = ctx.headers["x-content-sha256"];
    var actual = crypto.sha256(ctx.body);

    if (promised != actual) {
      return ctx.status(422).json({ error: "digest mismatch", expected: promised, actual: actual });
    }

    fs.writeFile(inbox(ctx.params.name), ctx.body);

    ctx.status(201).json({ sha256: actual });
  });

  server.get("/download/:name", func(ctx) {
    ctx.sendFile(inbox(ctx.params.name));
  });

  return server;
}

/** A client pointed at `where`, trusting the test certificate when the scheme needs it. */
func clientFor(where) {
  var base = where.protocol + "://localhost:" + where.port;

  if (where.protocol == "https") {
    return http.Client({
      baseURL: base,
      timeout: 20000,
      requestOptions: { ca: certPem, servername: "localhost" }
    });
  }

  return http.Client({ baseURL: base, timeout: 20000 });
}

var binaryHeaders = { headers: { "content-type": "application/octet-stream" } };

describe("a file survives the trip, over http and over https", func() {
  beforeEach(freshDir);

  test("the bytes that arrive are the bytes that left, both schemes", func() {
    for (var secure in [false, true]) {
      var server = defer uploadServer(secure);
      var where = server.listen(0, "127.0.0.1");
      var client = clientFor(where);
      var source = makeFile("source.bin", 64000);

      var response = client.post(
        "/upload/plain.bin",
        fs.readFile(source.path),
        binaryHeaders
      );

      assert.equal(response.status(), 200);

      var answer = response.json();

      assert.equal(answer.bytes, source.size);
      assert.equal(answer.sha256, source.sha256);
      assert.equal(answer.secure, secure);

      // and the copy on the receiving side is the same file, not just the same length
      var stored = fs.readFile(inbox("plain.bin"));

      assert.equal(length(stored), source.size);
      assert.equal(crypto.sha256(stored), source.sha256);
      assert.isTrue(bytes.equal(stored, source.body));
    }
  });

  test("https really is https", func() {
    var server = defer uploadServer(true);
    var where = server.listen(0, "127.0.0.1");

    assert.equal(where.protocol, "https");
    assert.isTrue(server.info().listening);
    assert.equal(server.info().address.port, where.port);
  });

  test("a file comes back down again, unchanged", func() {
    var server = defer uploadServer(true);
    var where = server.listen(0, "127.0.0.1");
    var client = clientFor(where);
    var source = makeFile("round.bin", 40000);

    client.post("/upload/round.bin", fs.readFile(source.path), binaryHeaders);

    var downloaded = client.get("/download/round.bin");

    assert.equal(downloaded.status(), 200);

    var back = downloaded.buffer();

    assert.equal(length(back), source.size);
    assert.equal(crypto.sha256(back), source.sha256);

    // write it a third time: disk, wire, disk, wire, disk
    var again = path.join(dir, "again.bin");

    fs.writeFile(again, back);

    assert.equal(crypto.hashFile(again, "sha256"), source.sha256);
  });

  test("a file larger than the default body limit still goes through", func() {
    var server = defer uploadServer(true);
    var where = server.listen(0, "127.0.0.1");
    var client = clientFor(where);

    // the default limit is two megabytes; this server was built with a larger one
    var source = makeFile("large.bin", 3000000);

    var response = client.post("/upload/large.bin", fs.readFile(source.path), binaryHeaders);

    assert.equal(response.status(), 200);
    assert.equal(response.json().sha256, source.sha256);
    assert.equal(fs.stat(inbox("large.bin")).size(), source.size);
  });

  test("an empty file is still a file", func() {
    var server = defer uploadServer(true);
    var where = server.listen(0, "127.0.0.1");
    var client = clientFor(where);

    fs.writeFile(path.join(dir, "empty.bin"), "");

    var response = client.post(
      "/upload/empty.bin",
      fs.readFile(path.join(dir, "empty.bin")),
      binaryHeaders
    );

    assert.equal(response.status(), 200);
    assert.equal(response.json().bytes, 0);
  });
});

describe("what the other libraries add to the trip", func() {
  beforeEach(freshDir);

  test("a packed file is unpacked on the far side and matches", func() {
    var server = defer uploadServer(true);
    var where = server.listen(0, "127.0.0.1");
    var client = clientFor(where);

    var text = strings.repeat("a line of a log file that compresses well\n", 2000);
    var source = path.join(dir, "log.txt");

    fs.writeFile(source, text);

    var packed = compress.gzip(fs.readFile(source));

    // worth sending packed at all
    assert.less(length(packed), length(text));

    var response = client.post("/upload/log.gz", packed, binaryHeaders);

    assert.equal(response.status(), 200);

    var received = fs.readFile(inbox("log.gz"));

    assert.equal(compress.detect(received), "gzip");
    assert.equal(compress.gunzip(received).toString(), text);
    assert.equal(crypto.sha256(compress.gunzip(received)), crypto.sha256(text));
  });

  test("a whole directory travels as one archive", func() {
    var server = defer uploadServer(true);
    var where = server.listen(0, "127.0.0.1");
    var client = clientFor(where);

    var tree = path.join(dir, "tree");
    var utils = fs.FSUtils();

    utils.ensureDir(path.join(tree, "sub"));

    var digests = {};

    for (var i = 1; i <= 3; i++) {
      var name = $"file{i}.txt";
      var body = strings.repeat($"contents of file {i}. ", 50);

      fs.writeFile(path.join(tree, name), body);
      digests[name] = crypto.sha256(body);
    }

    fs.writeFile(path.join(tree, "sub", "deep.txt"), "deep contents");

    var bundle = archive.create(tree, "zip");

    client.post("/upload/tree.zip", bundle, binaryHeaders);

    var received = fs.readFile(inbox("tree.zip"));

    assert.equal(archive.format(received), "zip");

    var restored = archive.extract(received, path.join(dir, "restored"));

    assert.greaterOrEqual(length(restored), 4);

    for (var name in digests) {
      var back = fs.readFile(path.join(dir, "restored", name));

      assert.equal(crypto.sha256(back), digests[name]);
    }

    assert.equal(
      fs.readFile(path.join(dir, "restored", "sub", "deep.txt")).toString(),
      "deep contents"
    );
  });

  test("the sender's digest is checked on arrival", func() {
    var server = defer uploadServer(true);
    var where = server.listen(0, "127.0.0.1");
    var client = clientFor(where);
    var source = makeFile("checked.bin", 20000);

    var accepted = client.post("/verified/checked.bin", fs.readFile(source.path), {
      headers: {
        "content-type": "application/octet-stream",
        "x-content-sha256": source.sha256
      }
    });

    assert.equal(accepted.status(), 201);
    assert.equal(accepted.json().sha256, source.sha256);
    assert.isTrue(fs.exists(inbox("checked.bin")));
  });

  test("a digest that does not match is refused, and nothing is written", func() {
    var server = defer uploadServer(true);
    var where = server.listen(0, "127.0.0.1");
    var client = clientFor(where);
    var source = makeFile("wrong.bin", 20000);

    var refused = client.post("/verified/wrong.bin", fs.readFile(source.path), {
      headers: {
        "content-type": "application/octet-stream",
        "x-content-sha256": crypto.sha256("a different payload entirely")
      }
    });

    assert.equal(refused.status(), 422);
    assert.equal(refused.json().error, "digest mismatch");
    assert.equal(refused.json().actual, source.sha256);
    assert.isFalse(fs.exists(inbox("wrong.bin")));
  });

  test("metadata as json and the file as bytes describe the same thing", func() {
    var server = defer uploadServer(true);
    var where = server.listen(0, "127.0.0.1");
    var client = clientFor(where);
    var source = makeFile("described.bin", 10000);

    var described = client.post("/upload/described.json", json.stringify({
      name: "described.bin",
      size: source.size,
      sha256: source.sha256
    }), { headers: { "content-type": "application/octet-stream" } });

    client.post("/upload/described.bin", fs.readFile(source.path), binaryHeaders);

    assert.equal(described.status(), 200);

    var manifest = json.parse(fs.readFile(inbox("described.json")).toString());
    var payload = fs.readFile(inbox("described.bin"));

    assert.equal(manifest.size, length(payload));
    assert.equal(manifest.sha256, crypto.sha256(payload));
  });
});

describe("the ways a transfer fails are reported", func() {
  beforeEach(freshDir);

  test("a client that does not trust the certificate is refused", func() {
    var server = defer uploadServer(true);
    var where = server.listen(0, "127.0.0.1");

    // no `ca`: the self-signed certificate has nothing to vouch for it
    var stranger = http.Client({
      baseURL: "https://localhost:" + where.port,
      timeout: 10000
    });

    var source = makeFile("refused.bin", 1000);

    assert.throws(func() {
      return stranger.post("/upload/refused.bin", fs.readFile(source.path), binaryHeaders);
    });

    assert.isFalse(fs.exists(inbox("refused.bin")));
  });

  test("plain http cannot talk to an https port", func() {
    var server = defer uploadServer(true);
    var where = server.listen(0, "127.0.0.1");

    var wrongScheme = http.Client({
      baseURL: "http://127.0.0.1:" + where.port,
      timeout: 5000
    });

    assert.throws(func() { return wrongScheme.get("/download/nothing"); });
  });

  test("a body past the server's limit does not become a file", func() {
    var small = http.Server({ key: keyPem, cert: certPem, bodyLimit: 4096 });

    small.post("/upload/:name", func(ctx) {
      fs.writeFile(inbox(ctx.params.name), ctx.body);
      ctx.json({ bytes: length(ctx.body) });
    });

    var where = small.listen(0, "127.0.0.1");
    var client = clientFor(where);
    var source = makeFile("too-big.bin", 64000);

    var response = client.post("/upload/too-big.bin", fs.readFile(source.path), binaryHeaders);

    assert.greaterOrEqual(response.status(), 400);
    assert.isFalse(response.ok);
    assert.isFalse(fs.exists(inbox("too-big.bin")));

    small.close();
  });

  test("asking for a file that was never uploaded is a 404", func() {
    var server = defer uploadServer(true);
    var where = server.listen(0, "127.0.0.1");
    var client = clientFor(where);

    var response = client.get("/download/absent.bin");

    assert.greaterOrEqual(response.status(), 400);
    assert.isFalse(response.ok);
  });
});

describe("several files at once", func() {
  beforeEach(freshDir);

  test("concurrent uploads do not get mixed up", func() {
    var server = defer uploadServer(true);
    var where = server.listen(0, "127.0.0.1");
    var client = clientFor(where);

    var sources = {};
    var jobs = [];

    for (var i = 0; i < 5; i++) {
      var name = $"part{i}.bin";
      var source = makeFile(name, 20000 + i * 1000);

      sources[name] = source;
      jobs[length(jobs)] = spawn client.post(
        "/upload/" + name,
        fs.readFile(source.path),
        binaryHeaders
      );
    }

    var responses = wait.all(jobs);

    assert.lengthOf(responses, 5);

    for (var name in sources) {
      var stored = fs.readFile(inbox(name));

      assert.equal(length(stored), sources[name].size);
      assert.equal(crypto.sha256(stored), sources[name].sha256);
    }
  });

  test("a server released by defer gives its port back", func() {
    var taken = {};

    func serveOnce() {
      var server = defer uploadServer(true);
      var where = server.listen(0, "127.0.0.1");
      var client = clientFor(where);
      var source = makeFile("once.bin", 5000);

      taken.port = where.port;

      var response = client.post("/upload/once.bin", fs.readFile(source.path), binaryHeaders);

      assert.equal(response.json().sha256, source.sha256);

      return 1;
    }

    serveOnce();

    time.Sleep(20);

    // the same port binds again, which it could not if the first server still held it
    var again = defer http.Server({ key: keyPem, cert: certPem });
    var where = again.listen(taken.port, "127.0.0.1");

    assert.equal(where.port, taken.port);
  });
});

finish("integration: file transfer");
