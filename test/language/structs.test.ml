import "core:test" as { describe, test, assert, finish };

struct Point {
  var x;
  var y;
  func distance() { return (this.x ** 2 + this.y ** 2) ** 0.5; }
}

struct Config {
  var host = "localhost";
  var port = 80;
}

struct Counter {
  var n = 0;
  func inc() { this.n += 1; return this; }
  func get() { return this.n; }
}

struct User {
  var name;
  var email;
  var age;

  func init(name, email, age = 18) {
    this.name = name;
    this.email = email;
    this.age = age;
  }

  func greet() { return $"Hello, I'm {this.name}!"; }
  func isAdult() { return this.age >= 18; }
}

struct BankAccount {
  var accountNumber;
  var balance;
  var owner;

  func init(owner, initialDeposit = 0) {
    this.accountNumber = 12345;
    this.balance = initialDeposit;
    this.owner = owner;
  }

  func deposit(amount) {
    if (amount > 0) { this.balance += amount; return true; }
    return false;
  }

  func withdraw(amount) {
    if (amount > 0 && amount <= this.balance) { this.balance -= amount; return true; }
    return false;
  }

  func getBalance() { return this.balance; }
}

describe("Fields without a constructor", func() {
  test("positional arguments fill the fields in order", func() {
    var p = Point(1, 2);
    assert.equal(p.x, 1);
    assert.equal(p.y, 2);
  });

  test("missing arguments leave fields nil", func() {
    var none = Point();
    assert.isNil(none.x);
    assert.isNil(none.y);
    var one = Point(1);
    assert.equal(one.x, 1);
    assert.isNil(one.y);
  });

  test("fields can be assigned after creation", func() {
    var p = Point();
    p.x = 3;
    p.y = 4;
    assert.equal(p.x, 3);
    assert.equal(p.distance(), 5);
  });

  test("default field values", func() {
    var c = Config();
    assert.equal(c.host, "localhost");
    assert.equal(c.port, 80);
  });

  test("arguments override default field values", func() {
    var c = Config("example.org", 8080);
    assert.equal(c.host, "example.org");
    assert.equal(c.port, 8080);
  });
});

describe("Constructor (init)", func() {
  test("init receives the arguments", func() {
    var u = User("Alice", "alice@example.com", 25);
    assert.equal(u.name, "Alice");
    assert.equal(u.email, "alice@example.com");
    assert.equal(u.age, 25);
  });

  test("init supports default parameters", func() {
    var u = User("Bob", "bob@example.com");
    assert.equal(u.age, 18);
    assert.isTrue(u.isAdult());
  });

  test("init keeps working for every instance, not just the first", func() {
    var a = User("A", "a@x", 20);
    var b = User("B", "b@x");
    var c = User("C", "c@x", 5);
    assert.equal(b.age, 18);
    assert.equal(c.age, 5);
    assert.equal(c.name, "C");
    assert.isFalse(c.isAdult());
  });

  test("init with default parameter applies on later instances", func() {
    var first = BankAccount("John Doe", 1000);
    var second = BankAccount("Jane");
    assert.equal(first.getBalance(), 1000);
    assert.equal(second.getBalance(), 0);
    assert.equal(second.owner, "Jane");
    assert.equal(second.accountNumber, 12345);
  });

  test("a many-times-created struct stays consistent", func() {
    var balances = [];
    for (var i = 0; i < 5; i++) {
      var acc = BankAccount("owner" + i, i * 10);
      balances[length(balances)] = acc.getBalance();
    }
    assert.equal(balances, [0, 10, 20, 30, 40]);
  });
});

describe("Methods", func() {
  test("methods read fields through this", func() {
    var u = User("Alice", "a@x", 25);
    assert.equal(u.greet(), "Hello, I'm Alice!");
    assert.isTrue(u.isAdult());
  });

  test("methods mutate fields", func() {
    var acc = BankAccount("John Doe", 1000);
    assert.isTrue(acc.deposit(500));
    assert.isTrue(acc.withdraw(200));
    assert.equal(acc.getBalance(), 1300);
  });

  test("methods can reject invalid operations", func() {
    var acc = BankAccount("John", 100);
    assert.isFalse(acc.deposit(-5));
    assert.isFalse(acc.withdraw(500));
    assert.isFalse(acc.withdraw(0));
    assert.equal(acc.getBalance(), 100);
  });

  test("methods returning this can be chained", func() {
    var c = Counter();
    c.inc().inc().inc();
    assert.equal(c.get(), 3);
  });

  test("methods can call other methods", func() {
    struct Calc {
      var v = 2;
      func dbl() { return this.v * 2; }
      func quad() { return this.dbl() * 2; }
    }
    assert.equal(Calc().quad(), 8);
  });

  test("method with arguments", func() {
    struct Acc {
      var total = 0;
      func add(n) { this.total += n; }
    }
    var a = Acc();
    a.add(5);
    a.add(6);
    assert.equal(a.total, 11);
  });

  test("a method returning this returns the same instance", func() {
    var c = Counter();
    assert.isTrue(c.inc() == c);
  });
});

describe("Instances", func() {
  test("instances do not share state", func() {
    var a = Counter();
    var b = Counter();
    a.inc();
    a.inc();
    b.inc();
    assert.equal(a.get(), 2);
    assert.equal(b.get(), 1);
  });

  test("field assignment affects only that instance", func() {
    var a = Point(1, 2);
    var b = Point(3, 4);
    a.x = 9;
    assert.equal(a.x, 9);
    assert.equal(b.x, 3);
  });

  test("collection fields created in init are per instance", func() {
    struct Bag {
      var items;
      func init() { this.items = []; }
      func add(x) { this.items[length(this.items)] = x; return this; }
      func size() { return length(this.items); }
    }
    var a = Bag();
    var b = Bag();
    a.add(1).add(2);
    b.add(9);
    assert.equal(a.size(), 2);
    assert.equal(b.size(), 1);
    assert.equal(a.items, [1, 2]);
    assert.equal(b.items, [9]);
  });

  test("instances can be stored in collections", func() {
    var list = [Point(1, 2), Point(3, 4)];
    assert.equal(list[1].x, 3);
    var holder = { p: Point(5, 6) };
    assert.equal(holder.p.y, 6);
  });

  test("structs can contain structs", func() {
    struct Line { var a; var b; }
    var l = Line(Point(0, 0), Point(3, 4));
    assert.equal(l.b.distance(), 5);
  });

  test("a linked list built from struct nodes", func() {
    struct Node {
      var value;
      var next;
      func init(value) { this.value = value; this.next = nil; }
    }
    var head = Node(1);
    head.next = Node(2);
    head.next.next = Node(3);
    var sum = 0;
    var cur = head;
    while (cur != nil) {
      sum += cur.value;
      cur = cur.next;
    }
    assert.equal(sum, 6);
  });

  test("struct expressions create anonymous structs", func() {
    var Shape = struct Anon { var side; };
    assert.equal(Shape(4).side, 4);
  });
});

describe("Types and protections", func() {
  test("typeof", func() {
    assert.equal(typeof Point, "struct");
    assert.equal(typeof Point(1, 2), "struct");
  });

  test("readonly fields cannot be reassigned", func() {
    struct Locked { var id = 0 as readonly; var name; }
    var r = Locked(7, "n");
    assert.equal(r.id, 7);
    assert.throws(func() { r.id = 8; }, "read-only property");
    assert.equal(r.id, 7);
    r.name = "changed";
    assert.equal(r.name, "changed");
  });

  test("a struct name cannot be reassigned", func() {
    assert.throws(func() { Point = 5; }, "struct");
  });

  test("reading an unknown field fails", func() {
    var p = Point(1, 2);
    assert.throws(func() { var v = p.nothing; }, "does not exist");
  });

  test("calling an unknown method fails", func() {
    var p = Point(1, 2);
    assert.throws(func() { p.nothing(); }, "unknown function");
  });
});

finish("structs");
