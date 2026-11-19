// ============================================================================
//  A struct's own `symbol.dispose`, against the libraries' native resources.
//
//  `func [symbol.dispose]() { ... }` in a struct body puts a value the program defined
//  into the same protocol every built-in resource already speaks. These tests check that
//  the two really are one protocol: that `defer` does not care which it got, that order
//  holds when both kinds are in the same block, that a struct can own several library
//  resources and release them all, and that the member behaves like a method of the
//  struct (its `this`, its `private` members, its right to suspend) rather than like a
//  loose function that happens to be stored there.
// ============================================================================

import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:fs";
import "core:path";
import "core:os";
import "core:tcp";
import "core:udp";
import "core:compress";
import "core:crypto";
import "core:json";
import "core:arrays";
import "core:strings";
import "core:iter";
import "core:time";

var dir = path.join(os.tmpdir(), "mylang-integration-struct-resources");

func freshDir() {
  var utils = fs.FSUtils();

  utils.removeDir(dir);
  utils.ensureDir(dir);
}

// A `func` declaration is not hoisted and a `describe` callback runs while `describe` is
// called, so everything the callbacks use is declared up here.

var order = [];

func note(name) { order[length(order)] = name; }

func resetOrder() { order = []; }

// ---------------------------------------------------------------------------
//  The structs under test.
// ---------------------------------------------------------------------------

/** Nothing but the protocol: the smallest disposable a program can write. */
struct Tag {
  var name;

  func [symbol.dispose]() { note(this.name); }
}

/** A struct that owns a file handle and closes it through a private member. */
struct Log {
  private var handle;
  private var written;
  var file;

  func init(file) {
    this.file = file;
    this.handle = fs.file(file, "w");
    this.written = 0;
  }

  func line(text) {
    this.handle.write(text + "\n");
    this.written = this.written + 1;
  }

  func lines() { return this.written; }

  func [symbol.dispose]() {
    // a private member, and a method of the same struct, both reachable from here
    this.handle.write($"-- {this.lines()} lines --\n");
    this.handle.close();
  }
}

/** A struct that owns three resources from three different libraries. */
struct Bundle {
  var handle;
  var server;
  var packer;

  func init(file) {
    this.handle = fs.file(file, "w");
    this.server = tcp.listen(0, "127.0.0.1");
    this.packer = compress.stream("gzip");
  }

  func allClosed() {
    return this.handle.closed && this.server.closed && this.packer.closed;
  }

  func [symbol.dispose]() {
    // every one of them, in the reverse order they were taken
    this.packer.close();
    this.server.close();
    this.handle.close();
  }
}

/** A disposer that suspends: it writes a file before it finishes. */
struct Flushed {
  var file;
  var flushed;

  func init(file) {
    this.file = file;
    this.flushed = false;
  }

  func [symbol.dispose]() {
    fs.writeFile(this.file, "flushed by the disposer");
    this.flushed = true;
  }
}

/** A struct whose disposer throws, to check that the others still run. */
struct Angry {
  func [symbol.dispose]() { throw "the disposer failed"; }
}

/** A struct named after the other protocol symbol. */
struct Countdown {
  var from;

  func [symbol.iterator]() {
    var current = this.from;

    return {
      next: func() {
        if (current <= 0) { return { done: true, value: nil }; }

        current = current - 1;

        return { done: false, value: current + 1 };
      }
    };
  }
}

/** Both protocol symbols on one struct. */
struct Walked {
  var items;
  var released;

  func init(items) {
    this.items = items;
    this.released = false;
  }

  func [symbol.iterator]() {
    var i = 0;
    var items = this.items;

    return {
      next: func() {
        if (i >= length(items)) { return { done: true, value: nil }; }

        var value = items[i];

        i = i + 1;

        return { done: false, value: value };
      }
    };
  }

  func [symbol.dispose]() { this.released = true; }
}

/** A bracketed name that is not a protocol symbol: refused when an instance is built. */
struct NotASymbol {
  func ["dispose"]() { return 1; }
}

/** The same symbol twice: refused when an instance is built. */
struct Twice {
  func [symbol.dispose]() { return 1; }
  func [symbol.dispose]() { return 2; }
}

/** The old shape, assigned in `init`, which has to keep working unchanged. */
struct Assigned {
  var released;

  func init() {
    this.released = false;

    var self = this;

    this[symbol.dispose] = func() { self.released = true; };
  }
}

describe("a struct declares the protocol every library already speaks", func() {
  beforeEach(freshDir);

  test("defer releases a struct that declares symbol.dispose", func() {
    resetOrder();

    func scoped() {
      var tag = defer Tag("released");

      return tag.name;
    }

    assert.equal(scoped(), "released");
    assert.equal(order, ["released"]);
  });

  test("the disposer is a method: this, private members and other methods", func() {
    var file = path.join(dir, "struct.log");

    func scoped() {
      var log = defer Log(file);

      log.line("first");
      log.line("second");

      return log;
    }

    var log = scoped();

    // the disposer's own write landed, which only works if it ran with the handle open
    assert.equal(fs.readFile(file).toString(), "first\nsecond\n-- 2 lines --\n");
    assert.equal(log.lines(), 2);

    // `private` is still private from out here
    assert.throws(func() { return log.handle; });
  });

  test("a struct and a native resource release in one reverse order", func() {
    resetOrder();

    var seen = {};

    func scoped() {
      var first = defer Tag("first");
      var handle = defer fs.file(path.join(dir, "between.txt"), "w");
      var last = defer Tag("last");

      seen.handle = handle;

      return 1;
    }

    scoped();

    assert.equal(order, ["last", "first"]);
    assert.isTrue(seen.handle.closed);
  });

  test("a struct owning three libraries' resources releases all of them", func() {
    var held = {};

    func scoped() {
      var bundle = defer Bundle(path.join(dir, "bundle.txt"));

      assert.isFalse(bundle.allClosed());

      held.bundle = bundle;

      return 1;
    }

    scoped();

    assert.isTrue(held.bundle.allClosed());
  });

  test("the disposer may suspend", func() {
    var file = path.join(dir, "flushed.txt");

    func scoped() {
      var flushed = defer Flushed(file);

      assert.isFalse(fs.exists(file));

      return flushed;
    }

    var flushed = scoped();

    assert.isTrue(flushed.flushed);
    assert.equal(fs.readFile(file).toString(), "flushed by the disposer");
  });

  test("declaring it and assigning it in init mean the same thing", func() {
    var held = {};

    func scoped() {
      var assigned = defer Assigned();

      held.value = assigned;

      return 1;
    }

    scoped();

    assert.isTrue(held.value.released);
  });

  test("an instance carries the member, and defer accepts it", func() {
    var tag = Tag("inspected");

    assert.typeOf(tag[symbol.dispose], "function");
    assert.notNil(tag[symbol.dispose]);
  });
});

describe("the member is not a named one", func() {
  beforeEach(freshDir);

  test("json does not see it", func() {
    var text = json.stringify(Walked([1, 2]));
    var back = json.parse(text);

    assert.equal(back.released, false);
    assert.equal(length(back.items), 2);
    assert.isFalse(strings.includes(text, "dispose"));
  });

  test("a struct without it is still an ordinary struct", func() {
    var tag = Tag("x");
    var plain = Assigned();

    assert.typeOf(tag, "struct");
    assert.typeOf(plain, "struct");
  });

  test("a bracketed name that is not a protocol symbol is refused", func() {
    var err = assert.throws(func() { return NotASymbol(); });

    assert.includes(err.message, "symbol.dispose");
  });

  test("the same symbol declared twice is refused", func() {
    var err = assert.throws(func() { return Twice(); });

    assert.includes(err.message, "Duplicate");
  });

  // These three cannot be written in this file: they are refused while it is read, which
  // would stop the suite rather than fail a test. Each lives in a fixture that is parsed
  // when it is imported.
  test("private on a symbol member is refused while parsing", func() {
    var err = assert.throws(func() {
      return import("../fixtures/symbol-private.ml");
    });

    assert.includes(err.message, "cannot be 'private'");
  });

  test("static on a symbol member is refused while parsing", func() {
    var err = assert.throws(func() {
      return import("../fixtures/symbol-static.ml");
    });

    assert.includes(err.message, "cannot be 'static'");
  });

  test("a symbol field is refused while parsing", func() {
    var err = assert.throws(func() {
      return import("../fixtures/symbol-field.ml");
    });

    assert.includes(err.message, "must be a method");
  });

  test("a struct from another module keeps its disposer", func() {
    var module = import("../fixtures/symbol-ok.ml");
    var file = path.join(dir, "imported.txt");
    var held = {};

    func scoped() {
      var sink = defer module.Sink(file);

      sink.write("through an imported struct");

      held.sink = sink;

      return 1;
    }

    scoped();

    assert.isTrue(held.sink.closed);
    assert.equal(fs.readFile(file).toString(), "through an imported struct");
  });
});

describe("release happens however the block ends", func() {
  beforeEach(freshDir);

  test("a thrown error still releases, and the body's error wins", func() {
    resetOrder();

    func scoped() {
      var tag = defer Tag("on-throw");

      throw "the body failed";
    }

    var err = assert.throws(scoped);

    assert.includes(err.message, "the body failed");
    assert.equal(order, ["on-throw"]);
  });

  test("a failing disposer does not stop the others", func() {
    resetOrder();

    func scoped() {
      var before = defer Tag("before");
      var angry = defer Angry();
      var after = defer Tag("after");

      return 1;
    }

    assert.throws(scoped);

    // "after" is registered last so it goes first; "before" still ran after the failure
    assert.equal(order, ["after", "before"]);
  });

  test("break and continue release what the iteration took", func() {
    resetOrder();

    func scoped() {
      for (var i = 0; i < 4; i++) {
        var tag = defer Tag($"round-{i}");

        if (i == 1) { continue; }
        if (i == 2) { break; }
      }

      return 1;
    }

    scoped();

    assert.equal(order, ["round-0", "round-1", "round-2"]);
  });

  test("a cancelled task releases what it was holding", func() {
    resetOrder();

    var task = spawn {
      var tag = defer Tag("cancelled");

      time.Sleep(500);

      note("should not run");
    };

    time.Sleep(5);

    task.cancel();

    time.Sleep(30);

    assert.isTrue(task.isCancelled());
    assert.equal(order, ["cancelled"]);
  });
});

describe("the iterator symbol works the same way in a struct", func() {
  test("for-in walks a struct that declares symbol.iterator", func() {
    var seen = [];

    for (var n in Countdown(3)) { seen[length(seen)] = n; }

    assert.equal(seen, [3, 2, 1]);
  });

  test("the walked-out values feed the iter library", func() {
    var seen = [];

    for (var n in Countdown(3)) { seen[length(seen)] = n; }

    assert.equal(arrays.join(seen, ","), "3,2,1");

    var doubled = [];

    for (var n in iter.Iterator(seen)) { doubled[length(doubled)] = n * 2; }

    assert.equal(doubled, [6, 4, 2]);
    assert.equal(arrays.map(seen, func(n) { return n * 2; }), [6, 4, 2]);
  });

  test("iter takes a struct that declares symbol.iterator", func() {
    assert.equal(iter.toArray(Countdown(3)), [3, 2, 1]);
    assert.equal(
      iter.toArray(iter.filter(Countdown(4), func(n) { return n % 2 == 0; })),
      [4, 2]
    );
    assert.equal(iter.toArray(iter.zip(Countdown(2), ["a", "b"])), [[2, "a"], [1, "b"]]);
  });

  test("the protocol can be driven by hand", func() {
    var it = Countdown(2)[symbol.iterator]();

    assert.equal(it.next().value, 2);
    assert.equal(it.next().value, 1);
    assert.isTrue(it.next().done);
  });

  test("one struct can carry both symbols at once", func() {
    var held = {};
    var seen = [];

    func scoped() {
      var walked = defer Walked(["a", "b", "c"]);

      for (var item in walked) { seen[length(seen)] = item; }

      held.value = walked;

      return 1;
    }

    scoped();

    assert.equal(seen, ["a", "b", "c"]);
    assert.isTrue(held.value.released);
  });
});

describe("a struct resource behaves like a library one under concurrency", func() {
  beforeEach(freshDir);

  test("two tasks each release their own instance", func() {
    resetOrder();

    func hold(name) {
      var tag = defer Tag(name);

      time.Sleep(10);

      return name;
    }

    var a = spawn hold("task-a");
    var b = spawn hold("task-b");

    var results = wait.all([a, b]);

    assert.equal(length(results), 2);
    assert.equal(length(order), 2);
    assert.includes(order, "task-a");
    assert.includes(order, "task-b");
  });

  test("a struct holding a socket releases it when its task ends", func() {
    var held = {};

    func serve() {
      var bundle = defer Bundle(path.join(dir, "concurrent.txt"));

      held.port = bundle.server.port;
      held.bundle = bundle;

      time.Sleep(10);

      return 1;
    }

    wait spawn serve();

    assert.greater(held.port, 0);
    assert.isTrue(held.bundle.allClosed());

    // the port came back: something else can take it now
    var again = defer tcp.listen(held.port, "127.0.0.1");

    assert.equal(again.port, held.port);
  });

  test("a digest taken inside a disposer is the same as one taken outside", func() {
    var file = path.join(dir, "digest.bin");
    var payload = crypto.randomBytes(2048);

    fs.writeFile(file, payload);

    var seen = {};

    func scoped() {
      var tag = defer Tag("digest");

      seen.inside = crypto.sha256(fs.readFile(file));

      return 1;
    }

    scoped();

    assert.equal(seen.inside, crypto.sha256(payload));
  });
});

finish("integration: struct resources");
