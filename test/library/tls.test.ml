import "core:test" as { describe, test, assert, finish };
import "core:tls";
import "core:binary";
import "core:path";

// A self-signed certificate, generated once and committed, so these tests need no
// network and no certificate authority.
var certFile = { file: path.join("test", "fixtures", "tls", "cert.pem") };
var keyFile = { file: path.join("test", "fixtures", "tls", "key.pem") };

func serve() {
  return tls.listen(0, "127.0.0.1", { cert: certFile, key: keyFile });
}

describe("tls: an encrypted round trip", func() {
  test("a request and its reply travel both ways", func() {
    var server = defer serve();

    var serving = spawn {
      var peer = server.accept();
      var request = peer.read();
      peer.write("secure echo: " + request.toString());
      peer.end();
      peer.close();
    };

    var client = defer tls.connect("localhost", server.port, {
      ca: certFile,
      servername: "localhost"
    });

    client.write("hello");

    assert.equal(client.readAll().toString(), "secure echo: hello");

    wait serving;
  });

  test("binary data survives", func() {
    var server = defer serve();
    var payload = binary.writer().u32(123456).string("tail").build();

    var serving = spawn {
      var peer = server.accept();
      peer.write(peer.readExactly(8));
      peer.end();
      peer.close();
    };

    var client = defer tls.connect("localhost", server.port, {
      ca: certFile,
      servername: "localhost"
    });

    client.write(payload);

    var reader = binary.reader(client.readExactly(8));

    assert.equal(reader.u32(), 123456);
    assert.equal(reader.string(4), "tail");

    wait serving;
  });

  test("a socket behaves exactly like a tcp one", func() {
    var server = defer serve();

    var serving = spawn {
      var peer = server.accept();
      peer.write("abcdef");
      peer.end();
      peer.close();
    };

    var client = defer tls.connect("localhost", server.port, {
      ca: certFile,
      servername: "localhost"
    });

    assert.equal(client.readExactly(3).toString(), "abc");
    assert.equal(client.readAll().toString(), "def");
    assert.isTrue(client.ended());

    wait serving;
  });

  test("accept(handler) serves several clients", func() {
    var server = defer serve();
    var served = 0;

    server.accept(func(peer) {
      served += 1;
      peer.write("served");
      peer.end();
      peer.close();
    });

    var first = defer tls.connect(
      "localhost",
      server.port,
      { ca: certFile, servername: "localhost" }
    );
    assert.equal(first.readAll().toString(), "served");

    var second = defer tls.connect(
      "localhost",
      server.port,
      { ca: certFile, servername: "localhost" }
    );
    assert.equal(second.readAll().toString(), "served");

    assert.equal(served, 2);
  });
});

describe("tls: the handshake", func() {
  test("the negotiated connection can be inspected", func() {
    var server = defer serve();
    server.accept(func(peer) { peer.close(); });

    var client = defer tls.connect("localhost", server.port, {
      ca: certFile,
      servername: "localhost"
    });

    assert.includes(client.protocol(), "TLS");
    assert.notNil(client.cipher().name);
    assert.isTrue(client.authorized());
    assert.equal(client.peerCertificate().subject.CN, "localhost");
    assert.notNil(client.peerCertificate().fingerprint256);
  });

  test("an unknown certificate is refused by default", func() {
    var server = defer serve();
    server.accept(func(peer) { peer.close(); });

    // no `ca`, so the self-signed certificate is not trusted
    assert.throws(
      func() { tls.connect("localhost", server.port); },
      "self-signed certificate"
    );
  });

  test("verification can be turned off explicitly", func() {
    var server = defer serve();

    server.accept(func(peer) {
      peer.write("insecure");
      peer.end();
      peer.close();
    });

    var client = defer tls.connect("localhost", server.port, {
      rejectUnauthorized: false
    });

    assert.equal(client.readAll().toString(), "insecure");
    assert.isFalse(client.authorized());
  });

  test("connecting where nothing listens fails", func() {
    var server = serve();
    var port = server.port;
    server.close();

    assert.throws(
      func() { tls.connect("localhost", port, { ca: certFile }); },
      "cannot connect"
    );
  });
});

describe("tls: a server needs material", func() {
  test("cert and key are both required", func() {
    assert.throws(func() { tls.listen(0, "127.0.0.1", {}); }, "needs options.cert and options.key");
    assert.throws(
      func() { tls.listen(0, "127.0.0.1", { cert: certFile }); },
      "needs options.cert and options.key"
    );
  });

  test("a missing certificate file is reported", func() {
    assert.throws(
      func() { tls.listen(0, "127.0.0.1", { cert: { file: "nope.pem" }, key: keyFile }); },
      "cannot read cert"
    );
  });

  test("material may be given inline", func() {
    var fs = import("core:fs");

    var server = defer tls.listen(0, "127.0.0.1", {
      cert: fs.readFile(certFile.file),
      key: fs.readFile(keyFile.file)
    });

    assert.greater(server.port, 0);
  });
});

describe("tls: resources", func() {
  test("close is idempotent", func() {
    var server = serve();

    server.close();
    server.close();

    assert.isTrue(server.closed);
  });

  test("defer releases a server", func() {
    func scoped() {
      var server = defer serve();
      return server;
    }

    assert.isTrue(scoped().closed);
  });

  test("defer releases a socket", func() {
    var server = defer serve();
    server.accept(func(peer) { peer.close(); });

    func scoped() {
      var client = defer tls.connect(
        "localhost",
        server.port,
        { ca: certFile, servername: "localhost" }
      );
      return client;
    }

    assert.isTrue(scoped().closed);
  });
});

describe("tls: the host's trust store", func() {
  test("rootCertificates lists the authorities the host trusts", func() {
    var roots = tls.rootCertificates();

    assert.typeOf(roots, "array");
    assert.greater(length(roots), 0);
  });
});

finish("tls");
