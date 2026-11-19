import "core:test" as { describe, test, assert, finish };

enum Status { Pending, Active, Completed, Failed }
enum HttpStatus { Ok = 200, Created = 201, BadRequest = 400, NotFound = 404 }
enum Color { Red = "r", Green = "g" }

enum Level {
  Low,
  High,
  func label() {
    match (this) {
      case Level.Low: return "low";
      case Level.High: return "high";
    }
  }
  func isHigh() { return this == Level.High; }
}

enum Direction {
  North, East, South, West,
  func opposite() {
    match (this) {
      case (.North): return "South";
      case (.East): return "West";
      case (.South): return "North";
      case (.West): return "East";
    }
  }
}

describe("Values", func() {
  test("members are numbered from zero", func() {
    assert.equal(Status.Pending, 0);
    assert.equal(Status.Active, 1);
    assert.equal(Status.Completed, 2);
    assert.equal(Status.Failed, 3);
  });

  test("custom numeric values", func() {
    assert.equal(HttpStatus.Ok, 200);
    assert.equal(HttpStatus.Created, 201);
    assert.equal(HttpStatus.NotFound, 404);
  });

  test("string values", func() {
    assert.equal(Color.Red, "r");
    assert.equal(Color.Green, "g");
  });

  test("a start value continues counting upwards", func() {
    enum Start { A = 5; B; C; }
    assert.equal(Start.A, 5);
    assert.equal(Start.B, 6);
    assert.equal(Start.C, 7);
  });

  test("members may be separated by commas or semicolons", func() {
    enum Commas { A, B, C }
    enum Semis { A; B; C; }
    assert.equal(Commas.C, 2);
    assert.equal(Semis.C, 2);
  });

  test("explicit values may be separated by a new line", func() {
    enum Lines {
      A = 10
      B = 20
    }
    assert.equal(Lines.A, 10);
    assert.equal(Lines.B, 20);
  });

  test("a single-member enum", func() {
    enum One { Only }
    assert.equal(One.Only, 0);
  });

  test("members are usable as numbers", func() {
    assert.equal(HttpStatus.Ok + 1, 201);
    assert.isTrue(HttpStatus.NotFound > HttpStatus.Ok);
  });

  test("members interpolate and concatenate as their values", func() {
    assert.equal($"status={HttpStatus.Ok}", "status=200");
    assert.equal("c:" + Color.Red, "c:r");
  });
});

describe("Reverse lookup", func() {
  test("by number", func() {
    assert.equal(Status[0], "Pending");
    assert.equal(Status[3], "Failed");
    assert.equal(HttpStatus[404], "NotFound");
  });

  test("by string value", func() {
    assert.equal(Color["g"], "Green");
  });
});

describe("Using members", func() {
  test("stored in variables, collections and objects", func() {
    var s = Status.Completed;
    assert.equal(s, 2);
    var list = [Status.Pending, Status.Failed];
    assert.isTrue(list[1] == Status.Failed);
    var o = { code: HttpStatus.Created };
    assert.equal(o.code, 201);
  });

  test("returned from functions", func() {
    func notFound() { return HttpStatus.NotFound; }
    assert.isTrue(notFound() == 404);
  });

  test("equality", func() {
    assert.isTrue(Status.Active == Status.Active);
    assert.isFalse(Status.Active == Status.Failed);
    assert.isTrue(Status.Active != Status.Failed);
  });

  test("match on enum members", func() {
    func describeStatus(s) {
      match (s) {
        case Status.Pending: return "waiting";
        case Status.Active: return "running";
        default: return "other";
      }
    }
    assert.equal(describeStatus(Status.Pending), "waiting");
    assert.equal(describeStatus(Status.Active), "running");
    assert.equal(describeStatus(Status.Failed), "other");
  });
});

describe("Enum methods", func() {
  test("match (this) with Enum.Member cases", func() {
    assert.equal(Level.Low.label(), "low");
    assert.equal(Level.High.label(), "high");
  });

  test("match (this) with (.Member) cases", func() {
    assert.equal(Direction.North.opposite(), "South");
    assert.equal(Direction.East.opposite(), "West");
    assert.equal(Direction.South.opposite(), "North");
    assert.equal(Direction.West.opposite(), "East");
  });

  test("methods work on a member stored in a variable", func() {
    var l = Level.High;
    assert.equal(l.label(), "high");
    assert.isTrue(l.isHigh());
    var d = Direction.West;
    assert.equal(d.opposite(), "East");
  });

  test("this compares equal to its own member only", func() {
    assert.isTrue(Level.High.isHigh());
    assert.isFalse(Level.Low.isHigh());
  });

  test("the HTTP status example from the documentation", func() {
    enum Http {
      Ok = 200,
      NotFound = 404,
      func isError() { return this == Http.NotFound; }
    }
    assert.isTrue(Http.NotFound.isError());
    assert.isFalse(Http.Ok.isError());
  });
});

describe("Protections", func() {
  test("members are read-only", func() {
    assert.throws(func() { Status.Active = 9; }, "read-only");
    assert.equal(Status.Active, 1);
  });

  test("the enum itself cannot be reassigned", func() {
    assert.throws(func() { Status = 5; }, "enum");
  });

  test("unknown members fail", func() {
    assert.throws(func() { var x = Status.Nope; }, "does not exist");
  });

  test("typeof", func() {
    assert.equal(typeof Status, "enum");
    assert.equal(typeof Status.Active, "int");
  });
});

finish("enums");
