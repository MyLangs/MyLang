import "core:test" as { describe, test, skip, assert, finish };
import "core:dns";

// Only the local resolver is exercised: a test suite must not depend on the network
// being reachable, so the lookups here are the ones every machine can answer.

describe("dns: lookup", func() {
  test("localhost resolves to a loopback address", func() {
    var result = dns.lookup("localhost");

    assert.typeOf(result.address, "string");
    assert.includes([4, 6], result.family);
  });

  test("the address family can be asked for", func() {
    var result = dns.lookup("localhost", 4);

    assert.equal(result.family, 4);
    assert.equal(result.address, "127.0.0.1");
  });

  test("an impossible family is refused", func() {
    assert.throws(func() { dns.lookup("localhost", 5); }, "must be 4 or 6");
  });

  test("lookupAll returns every address", func() {
    var all = dns.lookupAll("localhost");

    assert.typeOf(all, "array");
    assert.greaterOrEqual(length(all), 1);
    assert.typeOf(all[0].address, "string");
  });

  test("a name that does not resolve is reported", func() {
    assert.throws(
      func() { dns.lookup("this-name-does-not-exist.invalid"); },
      "dns lookup"
    );
  });

  test("an empty hostname is refused", func() {
    assert.throws(func() { dns.lookup(""); }, "cannot be empty");
    assert.throws(func() { dns.lookup(5); }, "must be of type string");
  });
});

describe("dns: record types", func() {
  test("an unknown record type is refused before any query", func() {
    assert.throws(func() { dns.resolve("example.com", "NOPE"); }, "unknown record type");
  });

  test("the supported types are listed", func() {
    assert.includes(dns.types, "A");
    assert.includes(dns.types, "MX");
    assert.includes(dns.types, "TXT");
  });
});

describe("dns: addresses", func() {
  test("isIP recognises IPv4", func() {
    assert.equal(dns.isIP("127.0.0.1"), 4);
    assert.equal(dns.isIP("255.255.255.255"), 4);
    assert.equal(dns.isIP("256.0.0.1"), 0);
  });

  test("isIP recognises IPv6", func() {
    assert.equal(dns.isIP("::1"), 6);
    assert.equal(dns.isIP("fe80::1"), 6);
  });

  test("isIP rejects anything else", func() {
    assert.equal(dns.isIP("example.com"), 0);
    assert.equal(dns.isIP(""), 0);
  });
});

describe("dns: resolvers", func() {
  test("the resolver list can be read", func() {
    assert.typeOf(dns.servers(), "array");
  });

  test("setServers checks its argument", func() {
    assert.throws(func() { dns.setServers("8.8.8.8"); }, "must be of type array");
  });
});

finish("dns");
