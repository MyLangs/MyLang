# `collections`

Set, Map, Counter, DefaultDict and OrderedDict.

```ml
import "core:collections";
```

## Suspension

**Every method returns immediately.**

## Types

| Type | Description |
| --- | --- |
| `collections.Set(items)` | unique values, with set algebra |
| `collections.Map(entries)` | keys of any type, in insertion order |
| `collections.Counter(items)` | counts how often each value appears |
| `collections.DefaultDict(factory)` | a map that fills in a missing key |
| `collections.OrderedDict(entries)` | a map with explicit ordering |

### `Set`

`add`, `delete`, `has`, `clear`, `size`, `values`, `union`, `intersection`, `difference`,
`symmetricDifference`, `isSubsetOf`, `isSupersetOf`, `isDisjointFrom`

### `Map`

`set`, `get`, `has`, `delete`, `clear`, `size`, `keys`, `values`, `entries`, `forEach`

### `Counter`

`get` (the count for one value), `update` (count more items), `mostCommon`, `total`,
`subtract`, `elements`, plus `keys`, `values` and `set`

### `DefaultDict`

`get` (creates the value when missing), plus everything `Map` has

### `OrderedDict`

`moveToEnd`, `moveToStart`, `popFirst`, `popLast`, plus everything `Map` has

## Examples

### Unique values

```ml
import "core:collections";

var seen = collections.Set();

for (var name in names) {
  if (seen.has(name)) { continue; }

  seen.add(name);
  process(name);
}

coreio.print("unique:", seen.size());
```

### Set algebra

```ml
var admins = collections.Set(["ann", "bo"]);
var active = collections.Set(["bo", "cy"]);

coreio.print(admins.intersection(active).values());   // ["bo"]
coreio.print(admins.union(active).values());
coreio.print(admins.difference(active).values());     // ["ann"]
```

### Counting

```ml
var words = collections.Counter(strings.words(text));

for (var entry in words.mostCommon(5)) {
  coreio.print(entry[0], entry[1]);
}
```

### Grouping without checking for a missing key

```ml
var byRole = collections.DefaultDict(func() { return []; });

for (var user in users) {
  arrays.push(byRole.get(user.role), user.name);
}
```

### Keys that are not strings

```ml
var cache = collections.Map();

cache.set([1, 2], "first");
cache.set({ id: 3 }, "second");
```

## Notes

- A plain object already works as a map with string keys; `Map` is for keys of other
  types, and for keeping insertion order explicit.
- `Set` compares values the way the language does, so two arrays with the same contents are
  two different members.
