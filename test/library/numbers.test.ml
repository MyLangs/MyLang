import "core:test" as { describe, test, assert, finish };
import "numbers";

describe("numbers: arithmetic", func() {
  test("add", func() {
    assert.equal(numbers.add(2, 3), 5);
    assert.equal(numbers.add(-2, 2), 0);
    assert.closeTo(numbers.add(0.1, 0.2), 0.3);
  });

  test("subtract, multiply and divide", func() {
    assert.equal(numbers.subtract(10, 3), 7);
    assert.equal(numbers.multiply(4, 5), 20);
    assert.equal(numbers.divide(10, 4), 2.5);
    assert.equal(numbers.divide(10, 2), 5);
  });

  test("the binary operations ignore extra arguments", func() {
    assert.equal(numbers.add(1, 2, 3, 4), 3);
    assert.equal(numbers.subtract(10, 3, 2), 7);
    assert.equal(numbers.multiply(2, 3, 4), 6);
  });

  test("divide by zero is an error", func() {
    assert.throws(func() { numbers.divide(1, 0); }, "Division by zero");
  });

  test("power", func() {
    assert.equal(numbers.power(2, 10), 1024);
    assert.equal(numbers.power(9, 0.5), 3);
    assert.equal(numbers.power(2, -1), 0.5);
  });

  test("sqrt and cbrt", func() {
    assert.equal(numbers.sqrt(16), 4);
    assert.closeTo(numbers.sqrt(2), 1.4142135623730951);
    assert.equal(numbers.cbrt(27), 3);
    assert.equal(numbers.cbrt(-8), -2);
  });

  test("sqrt of a negative number is an error", func() {
    assert.throws(func() { numbers.sqrt(-1); }, "negative");
  });

  test("abs and sign", func() {
    assert.equal(numbers.abs(-5), 5);
    assert.equal(numbers.abs(5), 5);
    assert.equal(numbers.abs(-2.5), 2.5);
    assert.equal(numbers.sign(-3), -1);
    assert.equal(numbers.sign(0), 0);
    assert.equal(numbers.sign(9), 1);
  });

  test("mod keeps the sign of the dividend", func() {
    assert.equal(numbers.mod(10, 3), 1);
    assert.equal(numbers.mod(-7, 3), -1);
    assert.equal(numbers.mod(7, -3), 1);
  });

  test("divmod returns [quotient, remainder]", func() {
    assert.equal(numbers.divmod(17, 5), [3, 2]);
    assert.equal(numbers.divmod(-17, 5), [-4, -2]);
  });

  test("max and min take values or an array", func() {
    assert.equal(numbers.max(1, 5, 3), 5);
    assert.equal(numbers.min(4, 2, 8), 2);
    assert.equal(numbers.max([1, 9, 3]), 9);
    assert.equal(numbers.min([4, 2, 8]), 2);
  });

  test("sum and product of an array", func() {
    assert.equal(numbers.sum([1, 2, 3, 4]), 10);
    assert.equal(numbers.product([1, 2, 3, 4]), 24);
  });

  test("sum, product and max reject an empty array", func() {
    assert.throws(func() { numbers.sum([]); }, "cannot be empty");
    assert.throws(func() { numbers.product([]); }, "cannot be empty");
    assert.throws(func() { numbers.max([]); }, "cannot be empty");
  });
});

describe("numbers: rounding", func() {
  test("floor and ceil", func() {
    assert.equal(numbers.floor(2.7), 2);
    assert.equal(numbers.floor(-2.1), -3);
    assert.equal(numbers.ceil(2.1), 3);
    assert.equal(numbers.ceil(-2.7), -2);
  });

  test("round", func() {
    assert.equal(numbers.round(2.5), 3);
    assert.equal(numbers.round(2.4), 2);
    assert.equal(numbers.round(-2.5), -2);
  });

  test("trunc cuts towards zero", func() {
    assert.equal(numbers.trunc(2.9), 2);
    assert.equal(numbers.trunc(-2.9), -2);
  });

  test("round accepts a number of decimals", func() {
    assert.equal(numbers.round(3.14159, 2), 3.14);
    assert.equal(numbers.round(1234.5678, 1), 1234.6);
    assert.equal(numbers.round(2.5, 0), 3);
  });

  test("floor and ceil always round to integers", func() {
    assert.equal(numbers.floor(3.789, 1), 3);
    assert.equal(numbers.ceil(3.121, 1), 4);
  });
});

describe("numbers: number theory", func() {
  test("factorial", func() {
    assert.equal(numbers.factorial(0), 1);
    assert.equal(numbers.factorial(5), 120);
    assert.equal(numbers.factorial(10), 3628800);
  });

  test("factorial of a negative number is an error", func() {
    assert.throws(func() { numbers.factorial(-1); }, "non-negative");
  });

  test("gcd and lcm", func() {
    assert.equal(numbers.gcd(12, 18), 6);
    assert.equal(numbers.gcd(17, 5), 1);
    assert.equal(numbers.gcd(0, 5), 5);
    assert.equal(numbers.gcd(12, 18, 24), 6);
    assert.equal(numbers.lcm(4, 6), 12);
    assert.equal(numbers.lcm(3, 5), 15);
    assert.equal(numbers.lcm(2, 3, 4), 12);
  });

  test("isPrime", func() {
    assert.isTrue(numbers.isPrime(2));
    assert.isTrue(numbers.isPrime(17));
    assert.isTrue(numbers.isPrime(97));
    assert.isFalse(numbers.isPrime(18));
    assert.isFalse(numbers.isPrime(1));
    assert.isFalse(numbers.isPrime(0));
  });

  test("primeFactors", func() {
    assert.equal(numbers.primeFactors(60), [2, 2, 3, 5]);
    assert.equal(numbers.primeFactors(13), [13]);
  });

  test("primeFactors needs n >= 2", func() {
    assert.throws(func() { numbers.primeFactors(1); }, "n >= 2");
  });

  test("fibonacci", func() {
    assert.equal(numbers.fibonacci(0), 0);
    assert.equal(numbers.fibonacci(1), 1);
    assert.equal(numbers.fibonacci(10), 55);
    assert.equal(numbers.fibonacci(20), 6765);
  });

  test("combinations", func() {
    assert.equal(numbers.combinations(5, 2), 10);
    assert.equal(numbers.combinations(10, 0), 1);
    assert.equal(numbers.combinations(6, 6), 1);
    assert.equal(numbers.combinations(4, 5), 0);
  });

  test("permutations", func() {
    assert.equal(numbers.permutations(5, 2), 20);
    assert.equal(numbers.permutations(4, 4), 24);
    assert.equal(numbers.permutations(5, 0), 1);
  });
});

describe("numbers: logarithms, exponentials and trigonometry", func() {
  test("logarithms", func() {
    assert.equal(numbers.log(1), 0);
    assert.closeTo(numbers.log(numbers.E), 1);
    assert.closeTo(numbers.log10(1000), 3);
    assert.closeTo(numbers.log2(8), 3);
    assert.closeTo(numbers.log(8, 2), 3);
  });

  test("log of zero is an error", func() {
    assert.throws(func() { numbers.log(0); }, "must be positive");
  });

  test("exponentials", func() {
    assert.equal(numbers.exp(0), 1);
    assert.closeTo(numbers.exp(1), numbers.E);
    assert.equal(numbers.exp2(10), 1024);
  });

  test("sin, cos, tan", func() {
    assert.equal(numbers.sin(0), 0);
    assert.equal(numbers.cos(0), 1);
    assert.equal(numbers.tan(0), 0);
    assert.closeTo(numbers.sin(numbers.PI / 2), 1);
    assert.closeTo(numbers.cos(numbers.PI), -1);
  });

  test("inverse trigonometric functions", func() {
    assert.closeTo(numbers.asin(1), numbers.PI / 2);
    assert.equal(numbers.acos(1), 0);
    assert.closeTo(numbers.atan(1), numbers.PI / 4);
    assert.closeTo(numbers.atan2(1, 1), numbers.PI / 4);
    assert.closeTo(numbers.atan2(0, -1), numbers.PI);
  });

  test("hyperbolic functions", func() {
    assert.equal(numbers.sinh(0), 0);
    assert.equal(numbers.cosh(0), 1);
    assert.equal(numbers.tanh(0), 0);
    assert.equal(numbers.asinh(0), 0);
    assert.equal(numbers.acosh(1), 0);
    assert.equal(numbers.atanh(0), 0);
  });

  test("degrees and radians", func() {
    assert.closeTo(numbers.degrees(numbers.PI), 180);
    assert.closeTo(numbers.radians(180), numbers.PI);
    assert.closeTo(numbers.radians(90), numbers.PI / 2);
  });
});

describe("numbers: constants", func() {
  test("mathematical constants", func() {
    assert.closeTo(numbers.PI, 3.141592653589793);
    assert.closeTo(numbers.E, 2.718281828459045);
    assert.closeTo(numbers.PHI, 1.618033988749895);
    assert.closeTo(numbers.SQRT2, 1.4142135623730951);
    assert.closeTo(numbers.SQRT3, 1.7320508075688772);
    assert.closeTo(numbers.LN2, 0.6931471805599453);
    assert.closeTo(numbers.LN10, 2.302585092994046);
    assert.closeTo(numbers.LOG2E, 1.4426950408889634);
    assert.closeTo(numbers.LOG10E, 0.4342944819032518);
  });

  test("numeric limits", func() {
    assert.equal(numbers.MaxSafeInteger, 9007199254740991);
    assert.typeOf(numbers.PositiveInfinity, "infinity");
    assert.typeOf(numbers.NegativeInfinity, "infinity");
    assert.less(numbers.NegativeInfinity, 0);
    assert.greater(numbers.PositiveInfinity, 0);
    assert.greater(numbers.Epsilon, 0);
    assert.less(numbers.Epsilon, 0.000001);
    assert.greater(numbers.MaxValue, 1e300);
    assert.greater(numbers.MinValue, 0);
    assert.typeOf(numbers.NaN, "nan");
  });
});

describe("numbers: statistics", func() {
  var data = [2, 4, 4, 4, 5, 5, 7, 9];

  test("mean", func() {
    assert.equal(numbers.mean(data), 5);
    assert.equal(numbers.mean([1, 2, 3]), 2);
  });

  test("median", func() {
    assert.equal(numbers.median([3, 1, 2]), 2);
    assert.equal(numbers.median([1, 2, 3, 4]), 2.5);
    assert.equal(numbers.median(data), 4.5);
  });

  test("mode returns one value or a sorted list of ties", func() {
    assert.equal(numbers.mode(data), 4);
    assert.equal(numbers.mode([1, 1, 2, 2, 3]), [1, 2]);
    assert.equal(numbers.mode([7]), 7);
  });

  test("range", func() {
    assert.equal(numbers.range(data), 7);
  });

  test("variance and standard deviation default to the population form", func() {
    assert.equal(numbers.variance(data), 4);
    assert.equal(numbers.std(data), 2);
    assert.equal(numbers.popVariance(data), 4);
    assert.equal(numbers.popStd(data), 2);
  });

  test("a degrees-of-freedom argument gives the sample form", func() {
    assert.closeTo(numbers.variance(data, 1), 4.571428571428571);
    assert.closeTo(numbers.std(data, 1), 2.138089935299395);
  });

  test("quantile and percentile", func() {
    assert.equal(numbers.quantile(data, 0.5), 4.5);
    assert.equal(numbers.quantile(data, 0), 2);
    assert.equal(numbers.quantile(data, 1), 9);
    assert.equal(numbers.quantile([1, 2, 3, 4, 5], 0.25), 2);
    assert.equal(numbers.percentile(data, 50), 4.5);
    assert.closeTo(numbers.percentile([1, 2, 3, 4, 5], 90), 4.6);
    assert.equal(numbers.percentile([1, 2, 3, 4], 0), 1);
    assert.equal(numbers.percentile([1, 2, 3, 4], 100), 4);
  });

  test("quantile outside 0..1 is an error", func() {
    assert.throws(func() { numbers.quantile([1, 2], 2); }, "between 0 and 1");
  });

  test("iqr", func() {
    assert.equal(numbers.iqr([1, 2, 3, 4, 5, 6, 7, 8]), 3.5);
  });

  test("covariance and correlation", func() {
    assert.closeTo(numbers.covariance([1, 2, 3, 4], [2, 4, 6, 8]), 3.3333333333333335);
    assert.closeTo(numbers.correlation([1, 2, 3, 4], [2, 4, 6, 8]), 1);
    assert.closeTo(numbers.correlation([1, 2, 3], [3, 2, 1]), -1);
  });

  test("zscore of a value against a sample", func() {
    assert.equal(numbers.zscore(3, [1, 2, 3, 4, 5]), 0);
    assert.closeTo(numbers.zscore(5, [1, 2, 3, 4, 5]), 1.4142135623730951);
  });

  test("skewness of a symmetric sample is zero", func() {
    assert.equal(numbers.skewness([1, 2, 3, 4, 5]), 0);
  });

  test("harmonic and geometric means", func() {
    assert.closeTo(numbers.harmonicMean([1, 2, 4]), 1.7142857142857142);
    assert.closeTo(numbers.geometricMean([1, 2, 4, 8]), 2.8284271247461903);
  });

  test("trimmedMean ignores the extremes", func() {
    assert.equal(numbers.trimmedMean([1, 2, 3, 4, 100], 0.2), 3);
    assert.equal(numbers.trimmedMean([1, 2, 3, 4, 5], 0), 3);
  });

  test("statistics reject empty or non-numeric input", func() {
    assert.throws(func() { numbers.mean([]); }, "cannot be empty");
    assert.throws(func() { numbers.median([]); }, "cannot be empty");
    assert.throws(func() { numbers.mean(["a", "b"]); }, "must be a number");
  });
});

describe("numbers: array helpers", func() {
  test("linspace", func() {
    assert.equal(numbers.linspace(0, 1, 5), [0, 0.25, 0.5, 0.75, 1]);
    assert.equal(numbers.linspace(0, 10, 3), [0, 5, 10]);
  });

  test("arange", func() {
    assert.equal(numbers.arange(5), [0, 1, 2, 3, 4]);
    assert.equal(numbers.arange(2, 6), [2, 3, 4, 5]);
    assert.equal(numbers.arange(0, 10, 3), [0, 3, 6, 9]);
    assert.equal(numbers.arange(5, 0, -2), [5, 3, 1]);
    assert.equal(numbers.arange(0, 1, 0.25), [0, 0.25, 0.5, 0.75]);
  });

  test("arange with a zero step is an error", func() {
    assert.throws(func() { numbers.arange(0, 5, 0); }, "Step cannot be zero");
  });

  test("zeros, ones and full", func() {
    assert.equal(numbers.zeros(3), [0, 0, 0]);
    assert.equal(numbers.ones(2), [1, 1]);
    assert.equal(numbers.full(3, 7), [7, 7, 7]);
  });

  test("a negative size is an error", func() {
    assert.throws(func() { numbers.zeros(-1); }, "non-negative");
  });

  test("cumsum and cumprod", func() {
    assert.equal(numbers.cumsum([1, 2, 3, 4]), [1, 3, 6, 10]);
    assert.equal(numbers.cumprod([1, 2, 3, 4]), [1, 2, 6, 24]);
  });

  test("diff and gradient", func() {
    assert.equal(numbers.diff([1, 4, 9, 16]), [3, 5, 7]);
    assert.equal(numbers.diff([5]), []);
    assert.equal(numbers.gradient([1, 4, 9, 16]), [3, 4, 6, 7]);
  });

  test("unique returns sorted distinct values", func() {
    assert.equal(numbers.unique([3, 1, 2, 3, 1]), [1, 2, 3]);
  });

  test("argmax and argmin", func() {
    assert.equal(numbers.argmax([1, 9, 3]), 1);
    assert.equal(numbers.argmin([4, 2, 8]), 1);
    assert.equal(numbers.argmax([5, 5]), 0);
  });

  test("sort is numeric and can be descending", func() {
    assert.equal(numbers.sort([3, 1, 2]), [1, 2, 3]);
    assert.equal(numbers.sort([10, 9, 1]), [1, 9, 10]);
    assert.equal(numbers.sort([3, 1, 2], true), [3, 2, 1]);
  });

  test("argsort returns the sorting permutation", func() {
    assert.equal(numbers.argsort([30, 10, 20]), [1, 2, 0]);
    assert.equal(numbers.argsort([30, 10, 20], true), [0, 2, 1]);
  });

  test("reshape builds rows", func() {
    assert.equal(numbers.reshape([1, 2, 3, 4, 5, 6], 2, 3), [[1, 2, 3], [4, 5, 6]]);
  });

  test("reshape checks the size", func() {
    assert.throws(func() { numbers.reshape([1, 2, 3], 2, 2); }, "Cannot reshape");
  });

  test("flatten", func() {
    assert.equal(numbers.flatten([[1, 2], [3, [4]]]), [1, 2, 3, 4]);
  });

  test("clip limits every element", func() {
    assert.equal(numbers.clip([1, 5, 9], 2, 6), [2, 5, 6]);
    assert.equal(numbers.clip([1, 5, 9], 2), [2, 5, 9]);
    assert.equal(numbers.clip([1, 5, 9]), [1, 5, 9]);
  });

  test("clip rejects min > max", func() {
    assert.throws(func() { numbers.clip([1], 5, 2); }, "cannot be greater");
  });
});

describe("numbers: interpolation and polynomials", func() {
  test("linearInterp clamps outside the range", func() {
    assert.equal(numbers.linearInterp([0, 10], [0, 100], [5]), [50]);
    assert.equal(numbers.linearInterp([0, 1, 2], [0, 10, 40], [0.5, 1.5, -1, 3]), [5, 25, 0, 40]);
  });

  test("splineInterp passes through the data points", func() {
    var r = numbers.splineInterp([0, 1, 2, 3], [0, 1, 4, 9], [0, 3]);
    assert.closeTo(r[0], 0);
    assert.closeTo(r[1], 9);
  });

  test("polynomialEval uses ascending coefficients", func() {
    assert.equal(numbers.polynomialEval([1, 2, 3], [0, 1, 2]), [1, 6, 17]);
  });

  test("polynomialFit recovers a line", func() {
    var c = numbers.polynomialFit([0, 1, 2, 3], [1, 3, 5, 7], 1);
    assert.closeTo(c[0], 1);
    assert.closeTo(c[1], 2);
  });

  test("derivative and integral of polynomial coefficients", func() {
    assert.equal(numbers.derivative([1, 2, 3, 4]), [2, 6, 12]);
    assert.equal(numbers.derivative([5]), [0]);
    assert.equal(numbers.integral([2, 6]), [0, 2, 3]);
    assert.equal(numbers.integral([2, 6], 7), [7, 2, 3]);
  });

  test("trapezoidalRule integrates samples", func() {
    assert.equal(numbers.trapezoidalRule([0, 1, 2, 3]), 4.5);
    assert.equal(numbers.trapezoidalRule([0, 1, 2, 3], 2), 9);
    assert.equal(numbers.trapezoidalRule([5, 5, 5], 1), 10);
  });

  test("simpsonsRule needs an odd number of samples", func() {
    assert.closeTo(numbers.simpsonsRule([0, 1, 4, 9, 16], 1), 21.333333333333332);
    assert.throws(func() { numbers.simpsonsRule([1, 2, 3, 4]); }, "odd number");
  });
});

describe("numbers: root finding and optimisation", func() {
  test("bisection finds a root", func() {
    var root = numbers.bisection(func(x) { return x * x - 2; }, 0, 2);
    assert.closeTo(root, 1.4142135623730951, 0.0001);
  });

  test("bisection requires a sign change", func() {
    assert.throws(func() {
      numbers.bisection(func(x) { return x * x + 1; }, 0, 2);
    }, "opposite signs");
  });

  test("newtonRaphson converges", func() {
    var root = numbers.newtonRaphson(func(x) { return x * x - 9; }, func(x) { return 2 * x; }, 1);
    assert.closeTo(root, 3, 0.000001);
  });

  test("goldenSectionSearch finds a minimum", func() {
    var x = numbers.goldenSectionSearch(func(x) { return (x - 2) * (x - 2); }, 0, 5);
    assert.closeTo(x, 2, 0.0001);
  });
});

describe("numbers: argument validation", func() {
  test("arguments must be numbers", func() {
    assert.throws(func() { numbers.add("a", 1); }, "must be of type number");
    assert.throws(func() { numbers.sqrt("x"); }, "must be of type number");
  });

  test("array arguments must be arrays", func() {
    assert.throws(func() { numbers.sum(5); }, "must be of type array");
  });
});

finish("numbers");
