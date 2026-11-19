# `arrays`

Working with arrays.

```ml
import "core:arrays";
```

## Suspension

Every method returns immediately **unless you pass it a callback that suspends**. The
callback-taking methods run your function as part of the call, so if the function waits —
reads a file, calls a server — the whole call suspends with it. You still write the call
normally; use `spawn` only to overlap it with other work.

| Method | Suspends | Description |
| --- | --- | --- |
| `arrays.forEach(a, fn)` | with the callback | visit each element |
| `arrays.map(a, fn)` | with the callback | transform each element |
| `arrays.filter(a, fn)` | with the callback | keep the ones that match |
| `arrays.reduce(a, fn, start)` / `reduceRight` | with the callback | fold to one value |
| `arrays.find(a, fn)` / `findIndex` / `findLast` / `findLastIndex` | with the callback | search |
| `arrays.some(a, fn)` / `every(a, fn)` | with the callback | test |
| `arrays.flatMap(a, fn)` | with the callback | map, then flatten one level |
| `arrays.sort(a, compare)` | with the comparator | sort in place |
| everything below | — | immediate |

### Changing an array

| Method | Description |
| --- | --- |
| `arrays.push(a, …)` / `pop(a)` | at the end |
| `arrays.unshift(a, …)` / `shift(a)` | at the start |
| `arrays.splice(a, start, count, …)` | remove and insert |
| `arrays.reverse(a)` | in place |
| `arrays.with(a, i, value)` | a copy with one element replaced |
| `arrays.toReversed(a)` / `toSorted(a, fn)` / `toSpliced(a, …)` | copies, leaving the original alone |

### Reading

| Method | Description |
| --- | --- |
| `arrays.at(a, i)` | one element; negatives count from the end |
| `arrays.slice(a, start, end)` | a piece |
| `arrays.concat(a, …)` | join arrays |
| `arrays.includes(a, v)` / `indexOf` / `lastIndexOf` | search by value |
| `arrays.join(a, separator)` | to text |
| `arrays.flat(a, depth)` | flatten nested arrays |
| `arrays.keys(a)` / `values(a)` / `entries(a)` | iterate |
| `arrays.from(value, fn)` / `of(…)` | build one |
| `arrays.toString(a)` / `toLocaleString(a)` | text |

## Examples

### The usual pipeline

```ml
import "core:arrays";

var names = arrays.map(
  arrays.filter(users, func(u) { return u.active; }),
  func(u) { return u.name; }
);

coreio.print(arrays.join(arrays.toSorted(names), ", "));
```

### Folding

```ml
var total = arrays.reduce(orders, func(sum, order) {
  return sum + order.amount;
}, 0);
```

### A callback that waits

Because `map` runs your function as part of the call, a function that reads a file makes
the whole `map` suspend — which is exactly what you want, and still reads one file at a
time:

```ml
var contents = arrays.map(names, func(name) {
  return fs.readFile(name).toString();
});
```

To read them at the same time instead, spawn each one:

```ml
var jobs = arrays.map(names, func(name) { return spawn fs.readFile(name); });
var contents = wait.all(jobs);
```

### Copies versus in place

```ml
var original = [3, 1, 2];

var sorted = arrays.toSorted(original);    // original unchanged
arrays.sort(original);                     // original changed
```

## Notes

- `sort` and `reverse` change the array you give them; `toSorted` and `toReversed` return
  a copy. The copying forms are usually the safer default.
- `arrays.push(a, v)` is how you grow an array; `a[length(a)] = v` does the same thing.
