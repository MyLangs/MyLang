# `numbers/bigint`

Integers of unlimited size.

```ml
import "core:numbers/bigint";
```

The language's `int` holds whole numbers up to the safe range; a `bigint` holds any whole
number at all. Write one with an `n` suffix: `12345678901234567890n`.

## Suspension

**Every function returns immediately.**

## Methods

### Arithmetic

`add`, `subtract`, `multiply`, `divide`, `remainder`, `mod`, `power` (`pow`), `abs`,
`sign`, `max`, `min`, `sum`, `product`, `clamp`

### Comparison

`compare`, `equal` (`eq`), `notEqual` (`ne`), `lessThan` (`lt`), `lessThanOrEqual` (`lte`),
`greaterThan` (`gt`), `greaterThanOrEqual` (`gte`), `isEven`, `isOdd`

### Bits

`bitwiseAnd` (`and`), `bitwiseOr` (`or`), `bitwiseXor` (`xor`), `bitwiseNot` (`not`),
`leftShift` (`lshift`), `rightShift` (`rshift`), `popCount`, `bitLength`, `testBit`,
`setBit`, `clearBit`, `flipBit`, `trailingZeros`, `leadingZeros`, `isPowerOfTwo`,
`nextPowerOfTwo`

### Number theory

`factorial`, `gcd`, `lcm`, `modPow`, `modInverse`, `isPrime`, `nextPrime`, `fibonacci`,
`lucas`, `sqrt`, `isSquare`, `binomial`

### Conversion

`toString`, `fromString`, `toHex`, `toBinary`, `toOctal`, `toBytes`, `fromBytes`, `format`

### Other

`random`, `randomRange`, `range`

## Examples

### Numbers too large for `int`

```ml
import "core:numbers/bigint";

var huge = bigint.factorial(50n);

coreio.print(bigint.toString(huge));
coreio.print("digits:", length(bigint.toString(huge)));
```

### Modular arithmetic

```ml
var result = bigint.modPow(base, exponent, modulus);
```

### Bits

```ml
var flags = 0n;

flags = bigint.setBit(flags, 3);
flags = bigint.setBit(flags, 7);

coreio.print(bigint.toBinary(flags));     // 10001000
coreio.print(bigint.popCount(flags));     // 2
```

### Crossing to bytes

```ml
import "core:numbers/bigint";
import "core:binary";

var packed = bigint.toBytes(1234567890123456789n);
var back = bigint.fromBytes(packed);
```

### Formatting for people

```ml
coreio.print(bigint.format(1234567890n));     // 1,234,567,890
```

## Notes

- A `bigint` and an `int` do not mix in plain arithmetic: convert with
  `bigint.fromString` or the `n` suffix.
- `divide` truncates toward zero; `mod` always returns a non-negative result, while
  `remainder` keeps the sign of the dividend.
