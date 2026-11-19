# `iter`

Lazy sequences.

```ml
import "core:iter";
```

An iterator produces values one at a time, on demand. That is what makes it possible to
work with a sequence that is enormous, or endless, without building it in memory first.

## Suspension

Building an iterator returns immediately. Consuming one runs your callbacks, so a step
that waits makes the consumption wait with it.

| Method | Suspends | Description |
| --- | --- | --- |
| `iter.Iterator(source)` | — | wrap an array, string, object or custom iterable |
| `iter.range(start, stop, step)` | — | numbers |
| `iter.count(start, step)` | — | endless counting |
| `iter.cycle(items)` | — | repeat a sequence forever |
| `iter.repeat(value, times)` | — | the same value |
| `iter.enumerate(items, start)` | — | `{index, value}` for each item |
| `iter.zip(…)` / `zipLongest(…)` | — | walk several sequences together |
| `iter.chain(…)` | — | one sequence after another |
| `iter.takeWhile(items, fn)` / `dropWhile(items, fn)` | with the callback | cut a sequence |
| `iter.filterFalse(items, fn)` | with the callback | keep what does not match |
| `iter.compress(items, flags)` | — | keep where a flag is true |
| `iter.groupBy(items, fn)` | with the callback | group consecutive runs |
| `iter.accumulate(items, fn)` | with the callback | running totals |
| `iter.pairwise(items)` | — | each element with the next |
| `iter.flatten(items, depth)` | — | flatten nesting |
| `iter.map(items, fn)` | with the callback | each value through `fn` |
| `iter.filter(items, fn)` | with the callback | keep what matches |
| `iter.take(items, n)` | — | the first `n` values |
| `iter.skip(items, n)` | — | everything after the first `n` |
| `iter.toArray(items)` | with the source | collect every value |
| `iter.forEach(items, fn)` | with the callback | call `fn` with every value |
| `iter.symbol` | — | the protocol symbol a custom iterable implements |

Like every library, `iter` is functions that take the sequence as their **first argument** —
`iter.take(iter.count(), 3)`, never `iter.count().take(3)`. An iterator itself has one
member, `next()`, and works directly in `for … in`.

`items` may be anything iterable: an array, a string, an object (its `{ key, value }`
entries), an iterator from this library, or a custom iterable — an object with
`[symbol.iterator]`, or a struct that declares `func [symbol.iterator]()`.

Every function reads from the same source as `next()` and `for … in`, so they can be
mixed: after `it.next()`, a `for (x in it)` continues from the second value rather than
starting again, and an iterator that has finished stays finished.

## Examples

### A range

```ml
import "core:iter";

for (var i in iter.range(0, 10, 2)) {
  coreio.print(i);           // 0 2 4 6 8
}
```

### Index and value together

```ml
for (var pair in iter.enumerate(names)) {
  coreio.print(pair.index, pair.value);
}
```

### Walking two sequences

```ml
for (var pair in iter.zip(names, scores)) {
  coreio.print($"{pair[0]}: {pair[1]}");
}
```

### Taking from something endless

```ml
var firstTen = iter.toArray(iter.take(iter.count(1), 10));
```

### A lazy pipeline

```ml
var evens = iter.filter(numbers, func(n) { return n % 2 == 0; });
var squares = iter.map(evens, func(n) { return n * n; });

var result = iter.toArray(iter.take(squares, 5));
```

Nothing is computed until `toArray` asks for it, and only five values are ever produced.

### Your own iterable

```ml
var countdown = {
  [symbol.iterator]: func() {
    var n = 3;
    return { next: func() {
      n -= 1;
      return { value: n, done: n < 0 };
    }};
  }
};

for (var n in countdown) { coreio.print(n); }   // 2 1 0
```

Every function in this library takes it as it is — `iter.toArray(countdown)` is `[2, 1, 0]`
— and so does a struct that declares the member:

```ml
struct Countdown {
  var from;

  func [symbol.iterator]() {
    var n = this.from;

    return { next: func() {
      n -= 1;
      return { value: n, done: n < 0 };
    }};
  }
}

var doubled = iter.toArray(iter.map(Countdown(3), func(n) { return n * 2; }));   // [4, 2, 0]
```

A callback given to `map`, `filter` or `forEach` may wait, sleep or use a channel; the step
that called it waits with it, and other tasks keep running.

## Notes

- `iter.count` and `iter.cycle` never end: always pair them with `take` or a `break`.
- For an array you already have in memory, `arrays` is simpler; `iter` earns its place
  when the sequence is large, endless, or built in stages.
