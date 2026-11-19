# `numbers`

Arithmetic, statistics, interpolation and numerical methods.

```ml
import "core:numbers";
```

## Suspension

**Every function returns immediately.** The methods that take a callback (`derivative`,
`integral`, `bisection`, `newtonRaphson`, `goldenSectionSearch`, `sort` with a comparator)
run it as plain computation, so the callback must finish immediately too — it cannot wait,
sleep or use a channel. This keeps numeric code predictable and fast.

## Methods

### Arithmetic

`add`, `subtract`, `multiply`, `divide`, `power`, `sqrt`, `cbrt`, `abs`, `sign`, `floor`,
`ceil`, `round`, `trunc`, `mod`, `divmod`, `max`, `min`, `sum`, `product`, `factorial`,
`gcd`, `lcm`, `clip`

### Number theory

`isPrime`, `primeFactors`, `fibonacci`, `combinations`, `permutations`

### Logarithms and trigonometry

`log`, `log10`, `log2`, `exp`, `exp2`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`,
`atan2`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `degrees`, `radians`

### Statistics

`mean`, `median`, `mode`, `range`, `variance`, `std`, `popVariance`, `popStd`, `quantile`,
`percentile`, `iqr`, `covariance`, `correlation`, `zscore`, `skewness`, `kurtosis`,
`harmonicMean`, `geometricMean`, `trimmedMean`

### Arrays of numbers

`linspace`, `arange`, `zeros`, `ones`, `full`, `cumsum`, `cumprod`, `diff`, `gradient`,
`unique`, `argmax`, `argmin`, `sort`, `argsort`, `reshape`, `flatten`

### Interpolation and calculus

`linearInterp`, `splineInterp`, `polynomialFit`, `polynomialEval`, `derivative`,
`integral`, `trapezoidalRule`, `simpsonsRule`, `bisection`, `newtonRaphson`,
`goldenSectionSearch`

### Constants

`PI`, `E`, `PHI`, `SQRT2`, `SQRT3`, `LN2`, `LN10`, `LOG2E`, `LOG10E`,
`PositiveInfinity`, `NegativeInfinity`, `MaxSafeInteger`, `Epsilon`, `MaxValue`,
`MinValue`, `NaN`

## Examples

### Describing a sample

```ml
import "core:numbers";

var sample = [12, 15, 11, 19, 14, 13];

coreio.print("mean:", numbers.mean(sample));
coreio.print("median:", numbers.median(sample));
coreio.print("std:", numbers.std(sample));
coreio.print("p90:", numbers.percentile(sample, 90));
```

### Response-time buckets

```ml
var times = collectResponseTimes();

coreio.print($"p50 {numbers.percentile(times, 50)}ms");
coreio.print($"p95 {numbers.percentile(times, 95)}ms");
coreio.print($"p99 {numbers.percentile(times, 99)}ms");
```

### Fitting a line

```ml
var coefficients = numbers.polynomialFit(xs, ys, 1);

coreio.print("slope:", coefficients[1]);
coreio.print("at x=10:", numbers.polynomialEval(coefficients, 10));
```

### Finding a root

```ml
var root = numbers.bisection(func(x) { return x * x - 2; }, 0, 2);

coreio.print(root);    // about 1.41421
```

### Building a series

```ml
var xs = numbers.linspace(0, 1, 11);     // 0, 0.1, … 1
var ys = numbers.arange(0, 10, 2);       // 0, 2, 4, 6, 8
```

## Notes

- For integers beyond the safe range, use `numbers/bigint`.
- `variance` and `std` are the sample forms; `popVariance` and `popStd` are the population
  forms.
- A callback here must complete immediately: if it tries to wait, the call fails with a
  clear message rather than silently returning something odd.
