import "core:test" as { describe, test, assert, finish };
import "random";

describe("random: reproducibility", func() {
  test("the same seed gives the same sequence", func() {
    random.seed(42);
    var a = [random.random(), random.random(), random.random()];
    random.seed(42);
    var b = [random.random(), random.random(), random.random()];
    assert.equal(a, b);
  });

  test("different seeds give different values", func() {
    random.seed(1);
    var a = random.random();
    random.seed(2);
    var b = random.random();
    assert.notEqual(a, b);
  });

  test("seed must be an integer", func() {
    assert.throws(func() { random.seed("abc"); }, "must be of type int");
  });

  test("getState / setState restore the generator", func() {
    random.seed(7);
    var state = random.getState();
    var a = random.random();
    random.setState(state);
    var b = random.random();
    assert.equal(a, b);
  });

  test("shuffle is reproducible with a seed", func() {
    random.seed(3);
    var a = [1, 2, 3, 4, 5, 6];
    random.shuffle(a);
    random.seed(3);
    var b = [1, 2, 3, 4, 5, 6];
    random.shuffle(b);
    assert.equal(a, b);
  });
});

describe("random: integers", func() {
  test("random() is in [0, 1)", func() {
    for (var i = 0; i < 200; i++) {
      var r = random.random();
      assert.isTrue(r >= 0 && r < 1, "value " + r);
    }
  });

  test("randint is inclusive on both ends", func() {
    var seen = {};
    for (var i = 0; i < 300; i++) {
      var r = random.randint(1, 3);
      assert.isTrue(r >= 1 && r <= 3);
      seen[$"{r}"] = true;
    }
    assert.equal(length(seen), 3);
  });

  test("randint with equal bounds", func() {
    assert.equal(random.randint(5, 5), 5);
  });

  test("randrange respects start, stop and step", func() {
    for (var i = 0; i < 200; i++) {
      var r = random.randrange(0, 10, 2);
      assert.isTrue(r % 2 == 0 && r >= 0 && r < 10, "value " + r);
    }
  });

  test("randrange with one argument counts from zero", func() {
    for (var i = 0; i < 100; i++) {
      var r = random.randrange(5);
      assert.isTrue(r >= 0 && r < 5);
    }
  });

  test("randrange rejects an empty range", func() {
    assert.throws(func() { random.randrange(5, 5); }, "empty range");
  });

  test("getrandbits stays below 2^k", func() {
    for (var i = 0; i < 100; i++) {
      var r = random.getrandbits(8);
      assert.isTrue(r >= 0 && r < 256);
    }
    assert.typeOf(random.getrandbits(8), "int");
  });

  test("getrandbits needs 1 to 32 bits", func() {
    assert.throws(func() { random.getrandbits(0); }, "between 1 and 32");
  });

  test("arguments must be integers", func() {
    assert.throws(func() { random.randint("a", 2); }, "must be of type int");
  });
});

describe("random: sequences", func() {
  test("choice picks an element of the list", func() {
    for (var i = 0; i < 100; i++) {
      var c = random.choice(["a", "b", "c"]);
      assert.includes(["a", "b", "c"], c);
    }
  });

  test("choice eventually picks every element", func() {
    var seen = {};
    for (var i = 0; i < 300; i++) { seen[random.choice(["a", "b", "c"])] = true; }
    assert.equal(length(seen), 3);
  });

  test("choice on an empty list is an error", func() {
    assert.throws(func() { random.choice([]); }, "empty sequence");
  });

  test("choices without k returns a single element", func() {
    var c = random.choices([1, 2, 3]);
    assert.includes([1, 2, 3], c);
  });

  test("choices with k returns a list of k elements", func() {
    var picked = random.choices(["a", "b"], nil, nil, 5);
    assert.typeOf(picked, "array");
    assert.lengthOf(picked, 5);
  });

  test("choices honours weights", func() {
    var picked = random.choices(["a", "b"], [0, 1], nil, 30);
    for (var x in picked) { assert.equal(x, "b"); }
  });

  test("choices rejects mismatching weights", func() {
    assert.throws(func() { random.choices(["a", "b"], [1], nil, 3); }, "weights length");
  });

  test("sample returns k distinct positions", func() {
    var r = random.sample([1, 2, 3, 4, 5], 3);
    assert.lengthOf(r, 3);
    var seen = {};
    for (var x in r) { seen[$"{x}"] = true; }
    assert.equal(length(seen), 3);
  });

  test("sample cannot exceed the population", func() {
    assert.throws(func() { random.sample([1, 2], 5); }, "larger than population");
  });

  test("shuffle permutes in place and returns nothing", func() {
    var a = [1, 2, 3, 4, 5];
    var result = random.shuffle(a);
    assert.isNil(result);
    assert.lengthOf(a, 5);
    var sum = 0;
    for (var x in a) { sum += x; }
    assert.equal(sum, 15);
  });
});

describe("random: distributions", func() {
  test("uniform stays between its bounds", func() {
    for (var i = 0; i < 200; i++) {
      var r = random.uniform(2, 5);
      assert.isTrue(r >= 2 && r <= 5);
    }
  });

  test("triangular stays between its bounds", func() {
    for (var i = 0; i < 200; i++) {
      var r = random.triangular(0, 10, 5);
      assert.isTrue(r >= 0 && r <= 10);
    }
  });

  test("gauss is centred on mu", func() {
    random.seed(1);
    var sum = 0;
    for (var i = 0; i < 2000; i++) { sum += random.gauss(10, 2); }
    assert.closeTo(sum / 2000, 10, 0.3);
  });

  test("normalVariate is centred on mu", func() {
    random.seed(1);
    var sum = 0;
    for (var i = 0; i < 2000; i++) { sum += random.normalVariate(0, 1); }
    assert.closeTo(sum / 2000, 0, 0.1);
  });

  test("lognormVariate is positive", func() {
    for (var i = 0; i < 100; i++) { assert.greater(random.lognormVariate(0, 1), 0); }
  });

  test("expoVariate is non-negative and needs a positive rate", func() {
    for (var i = 0; i < 100; i++) { assert.greaterOrEqual(random.expoVariate(1), 0); }
    assert.throws(func() { random.expoVariate(0); }, "must be positive");
  });

  test("vonMisesVariate is an angle in [0, 2π)", func() {
    for (var i = 0; i < 300; i++) {
      var r = random.vonMisesVariate(0, 1);
      assert.isTrue(r >= 0 && r < 6.283185307179587, "value " + r);
    }
  });

  test("gammaVariate is positive", func() {
    for (var i = 0; i < 100; i++) { assert.greater(random.gammaVariate(2, 1), 0); }
  });

  test("betaVariate is within [0, 1]", func() {
    for (var i = 0; i < 100; i++) {
      var r = random.betaVariate(2, 3);
      assert.isTrue(r >= 0 && r <= 1);
    }
  });

  test("paretoVariate is at least 1", func() {
    for (var i = 0; i < 100; i++) { assert.greaterOrEqual(random.paretoVariate(2), 1); }
  });

  test("weibullVariate is non-negative", func() {
    for (var i = 0; i < 100; i++) { assert.greaterOrEqual(random.weibullVariate(1, 1), 0); }
  });

  test("SystemRandom returns a float in [0, 1)", func() {
    for (var i = 0; i < 50; i++) {
      var r = random.SystemRandom();
      assert.isTrue(r >= 0 && r < 1);
    }
  });
});

finish("random");
