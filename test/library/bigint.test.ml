import "core:test" as { describe, test, assert, finish };
import "numbers/bigint";

describe("bigint: arithmetic", func() {
  test("add, subtract, multiply", func() {
    assert.equal(bigint.add(2n, 3n), 5n);
    assert.equal(bigint.subtract(10n, 3n), 7n);
    assert.equal(bigint.multiply(4n, 5n), 20n);
    assert.typeOf(bigint.add(1n, 2n), "bigint");
  });

  test("divide truncates and remainder keeps the sign of the dividend", func() {
    assert.equal(bigint.divide(17n, 5n), 3n);
    assert.equal(bigint.remainder(17n, 5n), 2n);
    assert.equal(bigint.mod(17n, 5n), 2n);
    assert.equal(bigint.remainder(-17n, 5n), -2n);
  });

  test("division by zero is an error", func() {
    assert.throws(func() { bigint.divide(1n, 0n); }, "Division by zero");
  });

  test("power", func() {
    assert.equal(bigint.power(2n, 100n), 1267650600228229401496703205376n);
    assert.equal(bigint.pow(3n, 4n), 81n);
  });

  test("regular numbers are accepted and converted", func() {
    assert.equal(bigint.add(10, 5), 15n);
    assert.equal(bigint.add(5, 6n), 11n);
  });

  test("results beyond 64 bits are exact", func() {
    assert.equal(
      bigint.multiply(99999999999999999999n, 99999999999999999999n),
      9999999999999999999800000000000000000001n
    );
  });

  test("abs and sign", func() {
    assert.equal(bigint.abs(-5n), 5n);
    assert.equal(bigint.sign(-5n), -1n);
    assert.equal(bigint.sign(0n), 0n);
    assert.equal(bigint.sign(7n), 1n);
  });

  test("max and min", func() {
    assert.equal(bigint.max(1n, 5n, 3n), 5n);
    assert.equal(bigint.min(4n, 2n, 8n), 2n);
  });

  test("clamp", func() {
    assert.equal(bigint.clamp(15n, 0n, 10n), 10n);
    assert.equal(bigint.clamp(-5n, 0n, 10n), 0n);
    assert.equal(bigint.clamp(5n, 0n, 10n), 5n);
  });

  test("sum and product of a list", func() {
    assert.equal(bigint.sum([1n, 2n, 3n]), 6n);
    assert.equal(bigint.product([1n, 2n, 3n, 4n]), 24n);
  });

  test("isEven and isOdd", func() {
    assert.isTrue(bigint.isEven(4n));
    assert.isFalse(bigint.isEven(5n));
    assert.isTrue(bigint.isOdd(5n));
    assert.isFalse(bigint.isOdd(4n));
  });
});

describe("bigint: comparison", func() {
  test("compare returns -1, 0 or 1", func() {
    assert.equal(bigint.compare(1n, 2n), -1);
    assert.equal(bigint.compare(2n, 1n), 1);
    assert.equal(bigint.compare(2n, 2n), 0);
  });

  test("named predicates", func() {
    assert.isTrue(bigint.equal(1n, 1n));
    assert.isTrue(bigint.notEqual(1n, 2n));
    assert.isTrue(bigint.lessThan(1n, 2n));
    assert.isTrue(bigint.lessThanOrEqual(2n, 2n));
    assert.isTrue(bigint.greaterThan(3n, 2n));
    assert.isFalse(bigint.greaterThanOrEqual(2n, 3n));
  });

  test("short aliases", func() {
    assert.isTrue(bigint.eq(1n, 1n));
    assert.isFalse(bigint.ne(1n, 1n));
    assert.isTrue(bigint.lt(1n, 2n));
    assert.isTrue(bigint.lte(1n, 1n));
    assert.isFalse(bigint.gt(1n, 2n));
    assert.isTrue(bigint.gte(2n, 2n));
  });
});

describe("bigint: bit operations", func() {
  test("and, or, xor, not", func() {
    assert.equal(bigint.bitwiseAnd(12n, 10n), 8n);
    assert.equal(bigint.bitwiseOr(12n, 10n), 14n);
    assert.equal(bigint.bitwiseXor(12n, 10n), 6n);
    assert.equal(bigint.bitwiseNot(5n), -6n);
  });

  test("short aliases", func() {
    assert.equal(bigint.and(6n, 3n), 2n);
    assert.equal(bigint.or(6n, 3n), 7n);
    assert.equal(bigint.xor(6n, 3n), 5n);
    assert.equal(bigint.not(0n), -1n);
  });

  test("shifts", func() {
    assert.equal(bigint.leftShift(1n, 10n), 1024n);
    assert.equal(bigint.rightShift(1024n, 3n), 128n);
    assert.equal(bigint.lshift(1n, 4n), 16n);
    assert.equal(bigint.rshift(16n, 2n), 4n);
  });

  test("popCount and bitLength", func() {
    assert.equal(bigint.popCount(255n), 8n);
    assert.equal(bigint.bitLength(255n), 8);
    assert.equal(bigint.bitLength(256n), 9);
    assert.equal(bigint.bitLength(0n), 0);
  });

  test("testBit, setBit, clearBit, flipBit", func() {
    assert.equal(bigint.testBit(5n, 0n), 1n);
    assert.equal(bigint.testBit(5n, 1n), 0n);
    assert.equal(bigint.setBit(0n, 3n), 8n);
    assert.equal(bigint.clearBit(15n, 0n), 14n);
    assert.equal(bigint.flipBit(5n, 1n), 7n);
  });

  test("powers of two", func() {
    assert.equal(bigint.nextPowerOfTwo(5n), 8n);
    assert.equal(bigint.nextPowerOfTwo(8n), 8n);
    assert.isTrue(bigint.isPowerOfTwo(8n));
    assert.isFalse(bigint.isPowerOfTwo(6n));
  });

  test("trailing and leading zeros", func() {
    assert.equal(bigint.trailingZeros(8n), 3);
    assert.equal(bigint.trailingZeros(5n), 0);
    assert.equal(bigint.leadingZeros(1n, 8n), 7);
  });
});

describe("bigint: number theory", func() {
  test("factorial", func() {
    assert.equal(bigint.factorial(0n), 1n);
    assert.equal(bigint.factorial(5n), 120n);
    assert.equal(bigint.factorial(25n), 15511210043330985984000000n);
  });

  test("gcd and lcm", func() {
    assert.equal(bigint.gcd(12n, 18n), 6n);
    assert.equal(bigint.lcm(4n, 6n), 12n);
  });

  test("modPow", func() {
    assert.equal(bigint.modPow(2n, 10n, 1000n), 24n);
    assert.equal(bigint.modPow(3n, 200n, 13n), 9n);
  });

  test("modInverse", func() {
    assert.equal(bigint.modInverse(3n, 11n), 4n);
    assert.equal(bigint.modInverse(10n, 17n), 12n);
  });

  test("modInverse fails when none exists", func() {
    assert.throws(func() { bigint.modInverse(2n, 4n); }, "does not exist");
  });

  test("isPrime and nextPrime", func() {
    assert.isTrue(bigint.isPrime(97n));
    assert.isTrue(bigint.isPrime(2n));
    assert.isFalse(bigint.isPrime(100n));
    assert.isFalse(bigint.isPrime(1n));
    assert.equal(bigint.nextPrime(14n), 17n);
    assert.equal(bigint.nextPrime(13n), 13n);
  });

  test("fibonacci and lucas", func() {
    assert.equal(bigint.fibonacci(10n), 55n);
    assert.equal(bigint.fibonacci(100n), 354224848179261915075n);
    assert.equal(bigint.lucas(0n), 2n);
    assert.equal(bigint.lucas(1n), 1n);
    assert.equal(bigint.lucas(10n), 123n);
  });

  test("sqrt and isSquare", func() {
    assert.equal(bigint.sqrt(16n), 4n);
    assert.equal(bigint.sqrt(17n), 4n);
    assert.isTrue(bigint.isSquare(16n));
    assert.isFalse(bigint.isSquare(17n));
  });

  test("binomial", func() {
    assert.equal(bigint.binomial(5n, 2n), 10n);
    assert.equal(bigint.binomial(10n, 0n), 1n);
    assert.equal(bigint.binomial(52n, 5n), 2598960n);
  });
});

describe("bigint: conversion", func() {
  test("toString with a radix", func() {
    assert.equal(bigint.toString(255n), "255");
    assert.equal(bigint.toString(255n, 16n), "ff");
    assert.equal(bigint.toString(255n, 2n), "11111111");
    assert.equal(bigint.toString(-10n), "-10");
  });

  test("fromString with a radix", func() {
    assert.equal(bigint.fromString("12345678901234567890"), 12345678901234567890n);
    assert.equal(bigint.fromString("ff", 16n), 255n);
    assert.equal(bigint.fromString("101", 2n), 5n);
  });

  test("toHex, toBinary, toOctal", func() {
    assert.equal(bigint.toHex(255n), "ff");
    assert.equal(bigint.toBinary(5n), "101");
    assert.equal(bigint.toOctal(8n), "10");
  });

  test("toBytes and fromBytes round-trip", func() {
    assert.equal(bigint.toBytes(258n), [1, 2]);
    assert.equal(bigint.fromBytes(bigint.toBytes(258n)), 258n);
  });

  test("format groups digits", func() {
    assert.equal(bigint.format(1234567n), "1,234,567");
    assert.equal(bigint.format(-1234n), "-1,234");
  });

  test("range", func() {
    assert.equal(bigint.range(1n, 5n), [1n, 2n, 3n, 4n]);
    assert.equal(bigint.range(0n, 10n, 3n), [0n, 3n, 6n, 9n]);
  });
});

describe("bigint: randomness", func() {
  test("random returns a non-negative bigint", func() {
    var r = bigint.random(64n);
    assert.typeOf(r, "bigint");
    assert.isTrue(r >= 0n);
  });

  test("randomRange stays inside the range", func() {
    for (var i = 0; i < 20; i++) {
      var r = bigint.randomRange(10n, 20n);
      assert.typeOf(r, "bigint");
      assert.isTrue(r >= 10n && r < 20n);
    }
  });
});

describe("bigint: validation", func() {
  test("non-numeric arguments are rejected", func() {
    assert.throws(func() { bigint.add("a", 1n); }, "must be of type");
  });
});

finish("bigint");
