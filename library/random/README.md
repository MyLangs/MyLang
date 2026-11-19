# `random`

Random numbers and sampling.

```ml
import "core:random";
```

## Suspension

**Every method returns immediately.**

## Methods

| Method | Description |
| --- | --- |
| `random.random()` | a float in `[0, 1)` |
| `random.randint(a, b)` | an integer, both ends included |
| `random.randrange(start, stop, step)` | an integer from a range |
| `random.uniform(a, b)` | a float between two bounds |
| `random.choice(items)` | one element |
| `random.choices(items, k, weights)` | `k` elements, with replacement |
| `random.sample(items, k)` | `k` distinct elements |
| `random.shuffle(items)` | shuffle in place |
| `random.getrandbits(n)` | `n` random bits |
| `random.seed(value)` | make the sequence reproducible |
| `random.getState()` / `setState(state)` | save and restore the generator |
| `random.SystemRandom()` | a generator backed by the OS, which cannot be seeded |

### Distributions

`gauss`, `normalVariate`, `lognormVariate`, `expoVariate`, `triangular`, `vonMisesVariate`,
`gammaVariate`, `betaVariate`, `paretoVariate`, `weibullVariate`

## Examples

### Picking

```ml
import "core:random";

coreio.print(random.choice(["rock", "paper", "scissors"]));
coreio.print(random.sample(deck, 5));
```

### Reproducible runs

```ml
random.seed(42);

coreio.print(random.randint(1, 100));    // the same number every run
```

### Weighted choice

```ml
var outcome = random.choices(["common", "rare", "legendary"], 1, [90, 9, 1])[0];
```

### Shuffling

```ml
var order = arrays.slice(players, 0);    // a copy

random.shuffle(order);
```

### Simulating

```ml
var samples = [];

for (var i = 0; i < 10000; i++) {
  arrays.push(samples, random.gauss(100, 15));
}

coreio.print(numbers.mean(samples), numbers.std(samples));
```

## Notes

- This generator is fast and reproducible, which makes it right for simulations, tests and
  games — and **wrong** for anything secret.
- For tokens, passwords, salts and keys use `crypto.randomBytes`, `crypto.randomInt`,
  `crypto.randomString` or `random.SystemRandom()`, which draw from the operating system.
