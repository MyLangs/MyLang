// ============================================================================
//  Language features meeting libraries.
//
//  The language tests use plain values; the library tests use plain control flow. These
//  put the two together: a struct that owns a socket, an enum used as a protocol tag,
//  `defer` inside a method, optional chaining over a value a library produced, an error
//  from a library caught by a `try` three calls up.
// ============================================================================

import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:fs";
import "core:path";
import "core:os";
import "core:tcp";
import "core:bytes";
import "core:binary";
import "core:crypto";
import "core:json";
import "core:compress";
import "core:arrays";
import "core:collections";
import "core:iter";
import "core:objects";
import "core:strings";

var dir = path.join(os.tmpdir(), "mylang-integration-language");

func freshDir() {
  var utils = fs.FSUtils();

  utils.removeDir(dir);
  utils.ensureDir(dir);
}

// A struct that owns a resource: the release belongs to the struct, so the caller only
// has to `defer` the struct itself.
struct Vault {
  private var handle;
  private var key;
  var path;

  func init(file, key) {
    this.path = file;
    this.key = key;
    this.handle = fs.file(file, "w");

    // A struct body cannot declare a computed member name, so the dispose member is
    // assigned here. `defer Vault(...)` then releases the handle the struct opened.
    var handle = this.handle;

    this[symbol.dispose] = func() { handle.close(); };
  }

  func store(name, value) {
    var sealed = crypto.encrypt(json.stringify({ name: name, value: value }), this.key);
    var w = binary.writer();

    w.u32(length(sealed));

    this.handle.write(w.build());
    this.handle.write(sealed);

    return length(sealed);
  }
}

struct Counter {
  static var made = 0;
  private var n;

  func init() {
    this.n = 0;
    Counter.made += 1;
  }

  func add(value) {
    this.n += value;

    return this;
  }

  func total() { return this.n; }
}

enum Frame {
  Hello,
  Data,
  Goodbye
}

describe("a struct that owns a library resource", func() {
  beforeEach(freshDir);

  test("defer on the struct releases what the struct opened", func() {
    var file = path.join(dir, "vault.bin");
    var sizes = [];

    func useVault() {
      var vault = defer Vault(file, "a-password");

      sizes[length(sizes)] = vault.store("first", 1);
      sizes[length(sizes)] = vault.store("second", 2);

      return vault.path;
    }

    var used = useVault();

    assert.equal(used, file);
    assert.lengthOf(sizes, 2);

    // the handle was closed by the struct's dispose, so everything is on disk
    var written = fs.readFile(file);

    assert.greater(length(written), 0);

    // and the frames can be read back
    var r = binary.reader(written);
    var first = r.u32();

    assert.equal(first, sizes[0]);

    var sealed = r.bytes(first);
    var back = json.parse(crypto.decrypt(sealed, "a-password").toString());

    assert.equal(back.name, "first");
    assert.equal(back.value, 1);
  });

  test("a private member is not reachable from outside, even holding a resource", func() {
    var vault = defer Vault(path.join(dir, "private.bin"), "k");

    assert.throws(func() { return vault.handle; }, "private");
    assert.notNil(vault.path);
  });

  test("a method chain works on a struct that counts statically", func() {
    var before = Counter.made;
    var counter = Counter();

    assert.equal(counter.add(5).add(10).add(1).total(), 16);
    assert.equal(Counter.made, before + 1);
  });
});

describe("enums as protocol tags", func() {
  test("an enum value survives a binary round trip", func() {
    var w = binary.writer();

    w.u8(Frame.Data);
    w.string("payload");

    var r = binary.reader(w.build());
    var tag = r.u8();

    assert.equal(tag, Frame.Data);
    assert.notEqual(tag, Frame.Hello);
    assert.equal(r.string(7), "payload");
  });

  test("an enum chooses a branch over a socket", func() {
    var server = defer tcp.listen(0, "127.0.0.1");

    var serving = spawn {
      var client = server.accept();
      var tag = binary.reader(client.readExactly(1)).u8();

      if (tag == Frame.Hello) { client.write("greeted"); }
      if (tag == Frame.Goodbye) { client.write("farewell"); }

      client.end()
    }

    var socket = defer tcp.connect("127.0.0.1", server.port);
    var w = binary.writer();

    w.u8(Frame.Goodbye);

    socket.write(w.build());

    assert.equal(socket.readAll().toString(), "farewell");

    wait serving;
  });
});

describe("errors from libraries meet the language's handling", func() {
  beforeEach(freshDir);

  test("an error three calls down is caught at the top", func() {
    func level3() { return fs.readFile(path.join(dir, "not-here-at-all.txt")); }
    func level2() { return level3(); }
    func level1() { return level2(); }

    var caught = nil;

    try {
      level1();
    } catch (e) {
      caught = e;
    }

    assert.notNil(caught);
  });

  test("finally runs after a library error, and defer still releases", func() {
    var order = [];
    var file = path.join(dir, "finally.txt");

    func work() {
      var handle = defer fs.file(file, "w");

      try {
        handle.write("before\n");

        fs.readFile(path.join(dir, "absent.txt"));

        order[length(order)] = "not reached";
      } catch (e) {
        order[length(order)] = "caught";
      } finally {
        order[length(order)] = "finally";
      }
    }

    work();

    assert.equal(arrays.join(order, ","), "caught,finally");
    assert.equal(fs.readFile(file).toString(), "before\n");
  });

  test("a library error inside a callback reaches the caller", func() {
    var paths = [path.join(dir, "one.txt"), path.join(dir, "missing.txt")];

    fs.writeFile(paths[0], "here");

    assert.throws(func() {
      return arrays.map(paths, func(p) { return fs.readFile(p).toString(); });
    });
  });

  test("a throw from a struct method is catchable", func() {
    assert.throws(func() {
      var vault = Vault(path.join(dir, "nested", "deep", "cannot-open.bin"), "k");

      return vault;
    });
  });
});

describe("optional chaining over library values", func() {
  beforeEach(freshDir);

  test("a missing key on a parsed object is nil, not an error", func() {
    var parsed = json.parse('{"a": {"b": 1}}');

    assert.equal(parsed?.a?.b, 1);
    assert.equal(parsed?.a?.missing, nil);
    assert.equal(parsed?.absent?.deeper, nil);
  });

  test("chaining over something a library did not return", func() {
    var found = arrays.find([1, 2, 3], func(n) { return n > 10; });

    assert.equal(found, nil);
    assert.equal(found?.anything, nil);
  });
});

describe("data structures holding library values", func() {
  beforeEach(freshDir);

  test("a Map keyed by name holding bytes from different libraries", func() {
    var store = collections.Map();

    store.set("random", crypto.randomBytes(16));
    store.set("packed", compress.gzip("some text to pack"));
    store.set("built", binary.writer().u32(7).build());

    assert.equal(store.size(), 3);
    assert.equal(length(store.get("random")), 16);
    assert.isTrue(bytes.is(store.get("packed")));
    assert.equal(binary.reader(store.get("built")).u32(), 7);
  });

  test("a Set of digests collapses identical content", func() {
    var seen = collections.Set();

    for (var text in ["a", "b", "a", "c", "b"]) { seen.add(crypto.sha256(text)); }

    assert.equal(seen.size(), 3);
  });

  test("a lazy sequence over files read on demand", func() {
    for (var i = 1; i <= 3; i++) { fs.writeFile(path.join(dir, $"n{i}.txt"), $"body {i}"); }

    var names = fs.readdir(dir);
    var read = 0;

    // enumerate is lazy, so nothing is read until the loop asks
    for (var pair in iter.enumerate(names)) {
      read += length(fs.readFile(path.join(dir, pair.value)).toString());
    }

    assert.equal(length(names), 3);
    assert.greater(read, 0);
  });

  test("grouping records that came from json", func() {
    var text = json.stringify([
      { city: "Kyiv", n: 1 },
      { city: "Lviv", n: 2 },
      { city: "Kyiv", n: 3 }
    ]);

    var rows = json.parse(text);

    var byCity = arrays.reduce(rows, func(acc, row) {
      if (!objects.hasOwnProperty(acc, row.city)) { acc[row.city] = 0; }

      acc[row.city] += row.n;

      return acc;
    }, {});

    assert.equal(byCity.Kyiv, 4);
    assert.equal(byCity.Lviv, 2);
  });
});

describe("string interpolation over library values", func() {
  beforeEach(freshDir);

  test("interpolation reads a library value correctly", func() {
    var file = path.join(dir, "interp.txt");

    fs.writeFile(file, "contents");

    var info = fs.stat(file);

    assert.equal($"size is {info.size()}", "size is 8");
    assert.equal($"digest starts with {strings.slice(crypto.sha256('x'), 0, 4)}".length > 20, true);
  });

  test("interpolation of a bytes value uses its text", func() {
    var value = bytes.Bytes("hello");

    assert.equal($"says {value.toString()}", "says hello");
  });
});

finish("integration: language and libraries");
