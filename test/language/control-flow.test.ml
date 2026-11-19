import "core:test" as { describe, test, assert, finish };

describe("if / else", func() {
  func classify(n) {
    if (n < 0) { return "negative"; }
    else if (n == 0) { return "zero"; }
    else { return "positive"; }
  }

  test("takes the matching branch", func() {
    assert.equal(classify(-5), "negative");
    assert.equal(classify(0), "zero");
    assert.equal(classify(5), "positive");
  });

  test("if without else does nothing when false", func() {
    var r = "unchanged";
    if (false) { r = "changed"; }
    assert.equal(r, "unchanged");
  });

  test("single-statement bodies without braces", func() {
    var r = 0;
    if (true) r = 1;
    assert.equal(r, 1);
  });

  test("truthiness of conditions", func() {
    func t(v) { if (v) { return true; } return false; }
    assert.isTrue(t(1));
    assert.isTrue(t("text"));
    assert.isTrue(t([]));
    assert.isTrue(t(true));
    assert.isFalse(t(0));
    assert.isFalse(t(""));
    assert.isFalse(t(nil));
    assert.isFalse(t(false));
  });

  test("nested conditions", func() {
    func f(a, b) {
      if (a) {
        if (b) { return "both"; }
        return "only a";
      }
      return "none";
    }
    assert.equal(f(true, true), "both");
    assert.equal(f(true, false), "only a");
    assert.equal(f(false, true), "none");
  });
});

describe("while", func() {
  test("repeats while the condition holds", func() {
    var i = 0;
    var sum = 0;
    while (i < 5) { sum += i; i++; }
    assert.equal(sum, 10);
    assert.equal(i, 5);
  });

  test("never runs when the condition starts false", func() {
    var runs = 0;
    while (false) { runs++; }
    assert.equal(runs, 0);
  });

  test("break leaves the loop", func() {
    var i = 0;
    while (true) {
      if (i == 3) { break; }
      i++;
    }
    assert.equal(i, 3);
  });

  test("continue skips the rest of the iteration", func() {
    var i = 0;
    var sum = 0;
    while (i < 6) {
      i++;
      if (i % 2 == 0) { continue; }
      sum += i;
    }
    assert.equal(sum, 9);
  });
});

describe("for", func() {
  test("classic three-part loop", func() {
    var sum = 0;
    for (var i = 0; i < 5; i++) { sum += i; }
    assert.equal(sum, 10);
  });

  test("counting down", func() {
    var out = [];
    for (var i = 3; i > 0; i--) { out[length(out)] = i; }
    assert.equal(out, [3, 2, 1]);
  });

  test("custom step", func() {
    var sum = 0;
    for (var i = 0; i < 10; i += 3) { sum += i; }
    assert.equal(sum, 18);
  });

  test("empty initialiser", func() {
    var i = 0;
    for (; i < 3; i++) {}
    assert.equal(i, 3);
  });

  test("break and continue", func() {
    var seen = [];
    for (var i = 0; i < 10; i++) {
      if (i == 2) { continue; }
      if (i == 5) { break; }
      seen[length(seen)] = i;
    }
    assert.equal(seen, [0, 1, 3, 4]);
  });

  test("break only leaves the innermost loop", func() {
    var count = 0;
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 3; j++) {
        if (j == 1) { break; }
        count++;
      }
    }
    assert.equal(count, 3);
  });

  test("nested loops", func() {
    var pairs = 0;
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 4; j++) { pairs++; }
    }
    assert.equal(pairs, 12);
  });
});

describe("for-in", func() {
  test("iterates array values", func() {
    var out = [];
    for (var item in [10, 20, 30]) { out[length(out)] = item; }
    assert.equal(out, [10, 20, 30]);
  });

  test("iterates object keys", func() {
    var keys = [];
    for (var key in { a: 1, b: 2, c: 3 }) { keys[length(keys)] = key; }
    assert.equal(keys, ["a", "b", "c"]);
  });

  test("object values via keys", func() {
    var person = { name: "Alice", age: 30 };
    var parts = [];
    for (var key in person) { parts[length(parts)] = $"{key}={person[key]}"; }
    assert.equal(parts, ["name=Alice", "age=30"]);
  });

  test("iterates string characters", func() {
    var chars = [];
    for (var c in "abc") { chars[length(chars)] = c; }
    assert.equal(chars, ["a", "b", "c"]);
  });

  test("empty collections do not iterate", func() {
    var runs = 0;
    for (var x in []) { runs++; }
    for (var k in {}) { runs++; }
    for (var c in "") { runs++; }
    assert.equal(runs, 0);
  });

  test("break and continue", func() {
    var out = [];
    for (var n in [1, 2, 3, 4, 5, 6]) {
      if (n % 2 == 0) { continue; }
      if (n == 5) { break; }
      out[length(out)] = n;
    }
    assert.equal(out, [1, 3]);
  });

  test("accumulates into an outer variable", func() {
    var sum = 0;
    for (var n in [1, 2, 3, 4]) { sum += n; }
    assert.equal(sum, 10);
  });

  test("non-iterable values raise a clear error", func() {
    assert.throws(func() { for (var x in 5) {} }, "is not iterable");
    assert.throws(func() { for (var x in nil) {} }, "is not iterable");
  });
});

describe("continue", func() {
  test("skips every remaining statement of the iteration", func() {
    var log = [];
    for (var i = 0; i < 4; i++) {
      if (i == 1) { continue; }
      log[length(log)] = "a" + i;
      log[length(log)] = "b" + i;
      log[length(log)] = "c" + i;
    }
    assert.equal(log, ["a0", "b0", "c0", "a2", "b2", "c2", "a3", "b3", "c3"]);
  });

  test("works when followed by another if", func() {
    var seen = [];
    for (var i = 0; i < 6; i++) {
      if (i == 2) { continue; }
      if (i == 9) { break; }
      seen[length(seen)] = i;
    }
    assert.equal(seen, [0, 1, 3, 4, 5]);
  });

  test("as the last statement does not swallow the next iteration", func() {
    var seen = [];
    for (var i = 0; i < 4; i++) {
      seen[length(seen)] = i;
      if (i < 2) { continue; }
    }
    assert.equal(seen, [0, 1, 2, 3]);
  });

  test("in a while loop with several statements after it", func() {
    var i = 0;
    var kept = [];
    while (i < 5) {
      i++;
      if (i == 3) { continue; }
      kept[length(kept)] = i;
      kept[length(kept)] = i * 10;
    }
    assert.equal(kept, [1, 10, 2, 20, 4, 40, 5, 50]);
  });

  test("in a for-in loop over an object", func() {
    var keys = [];
    for (var k in { a: 1, b: 2, c: 3 }) {
      if (k == "b") { continue; }
      keys[length(keys)] = k;
    }
    assert.equal(keys, ["a", "c"]);
  });

  test("only affects the innermost loop", func() {
    var out = [];
    for (var i = 0; i < 2; i++) {
      for (var j = 0; j < 3; j++) {
        if (j == 1) { continue; }
        out[length(out)] = $"{i}{j}";
      }
      out[length(out)] = "end" + i;
    }
    assert.equal(out, ["00", "02", "end0", "10", "12", "end1"]);
  });

  test("inside a match inside a loop", func() {
    var out = [];
    for (var n in [1, 2, 3, 4]) {
      match (n) {
        case 2: { continue; }
        default: {}
      }
      out[length(out)] = n;
    }
    assert.equal(out, [1, 3, 4]);
  });

  test("inside a function called from a loop", func() {
    func work(n) {
      for (var i = 0; i < 3; i++) {
        if (i == 1) { continue; }
        n += 1;
      }
      return n;
    }
    var total = 0;
    for (var k = 0; k < 2; k++) { total += work(0); }
    assert.equal(total, 4);
  });
});

describe("match", func() {
  test("matches literal values", func() {
    func name(n) {
      match (n) {
        case 1: return "one";
        case 2: return "two";
        default: return "many";
      }
    }
    assert.equal(name(1), "one");
    assert.equal(name(2), "two");
    assert.equal(name(99), "many");
  });

  test("parentheses around the case value are optional", func() {
    func name(n) {
      match (n) {
        case (1): return "one";
        case (2): return "two";
        default: return "many";
      }
    }
    assert.equal(name(1), "one");
    assert.equal(name(2), "two");
    assert.equal(name(3), "many");
  });

  test("matches strings", func() {
    func level(role) {
      match (role) {
        case "admin": return 3;
        case "editor": return 2;
        default: return 0;
      }
    }
    assert.equal(level("admin"), 3);
    assert.equal(level("editor"), 2);
    assert.equal(level("guest"), 0);
  });

  test("case bodies can be blocks", func() {
    var log = [];
    var v = "x";
    match (v) {
      case "a": { log[length(log)] = "a"; }
      case "x": { log[length(log)] = "x"; }
      default: { log[length(log)] = "default"; }
    }
    assert.equal(log, ["x"]);
  });

  test("only the first matching case runs", func() {
    var hits = 0;
    match (1) {
      case 1: { hits++; }
      case 1: { hits++; }
      default: { hits++; }
    }
    assert.equal(hits, 1);
  });

  test("default runs when nothing matches", func() {
    var r = "none";
    match (42) {
      case 1: { r = "one"; }
      default: { r = "default"; }
    }
    assert.equal(r, "default");
  });

  test("no match and no default does nothing", func() {
    var r = "untouched";
    match (42) {
      case 1: { r = "one"; }
    }
    assert.equal(r, "untouched");
  });

  test("matches an expression result", func() {
    var role = { name: "admin" };
    var r = "";
    match (role.name) {
      case "user": { r = "user"; }
      case "admin": { r = "admin"; }
    }
    assert.equal(r, "admin");
  });

  test("object patterns with case (.key)", func() {
    var perms = { admin: false, moderator: true, user: true };
    var r = "";
    match (perms) {
      case (.admin): { r = "admin"; }
      case (.moderator): { r = "moderator"; }
      default: { r = "default"; }
    }
    assert.equal(r, "moderator");
  });

  test("object patterns fall back to default", func() {
    var perms = { admin: false, moderator: false };
    var r = "";
    match (perms) {
      case (.admin): { r = "admin"; }
      case (.moderator): { r = "moderator"; }
      default: { r = "default"; }
    }
    assert.equal(r, "default");
  });

  test("return from inside a case leaves the function", func() {
    func f(x) {
      match (x) {
        case 1: return "early";
        default: {}
      }
      return "late";
    }
    assert.equal(f(1), "early");
    assert.equal(f(2), "late");
  });

  test("break inside a loop around match", func() {
    var seen = [];
    for (var n in [1, 2, 3, 4]) {
      match (n) {
        case 3: { break; }
        default: { seen[length(seen)] = n; }
      }
    }
    assert.equal(seen, [1, 2]);
  });
});

finish("control-flow");
