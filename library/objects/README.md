# `objects`

Working with objects.

```ml
import "core:objects";
```

## Suspension

Every method returns immediately **unless you pass a callback that suspends** — the
callback runs as part of the call, so a function that waits makes the call wait with it.

| Method | Suspends | Description |
| --- | --- | --- |
| `objects.filter(o, fn)` | with the callback | keep matching entries |
| `objects.reduce(o, fn, start)` | with the callback | fold to one value |
| `objects.every(o, fn)` / `some(o, fn)` | with the callback | test |
| `objects.find(o, fn)` / `findKey(o, fn)` | with the callback | search |
| `objects.mapValues(o, fn)` / `mapKeys(o, fn)` | with the callback | transform |
| `objects.transform(o, fn, start)` | with the callback | build something else |
| `objects.groupBy(o, fn)` | with the callback | group an object's values by what the callback returns |
| everything else | — | immediate |

### Reading

| Method | Description |
| --- | --- |
| `objects.keys(o)` / `values(o)` / `entries(o)` | the parts |
| `objects.fromEntries(pairs)` | the inverse |
| `objects.hasOwnProperty(o, key)` | is it there? |
| `objects.propertyIsEnumerable(o, key)` | will iteration see it? |
| `objects.getOwnPropertyDescriptor(o, key)` / `getOwnPropertyDescriptors(o)` | details |
| `objects.is(a, b)` | same value? |

### Building

| Method | Description |
| --- | --- |
| `objects.assign(target, …)` | copy members in |
| `objects.create(proto, descriptors)` | a new object |
| `objects.defineProperty(o, key, descriptor)` / `defineProperties` | precise definition |
| `objects.merge(a, b, …)` | deep merge |
| `objects.defaults(o, fallbacks)` | fill in what is missing |
| `objects.pick(o, ...keys)` / `omit(o, ...keys)` | a subset; the keys are separate arguments, not a list |
| `objects.invert(o)` | swap keys and values |
| `objects.compact(o)` | drop `nil` members |
| `objects.deepClone(o)` / `shallowClone(o)` | copy |

## Examples

### Shaping a record

```ml
import "core:objects";

var publicUser = objects.omit(user, "password", "resetToken");
var summary = objects.pick(user, "id", "name");
```

### Defaults

```ml
var settings = objects.defaults(given, {
  host: "127.0.0.1",
  port: 8080,
  verbose: false
});
```

### Grouping

`groupBy` here takes an **object** and groups its values, giving an object of objects:

```ml
import "core:objects";

var scores = { ada: 91, alan: 64, barbara: 88 };

var byBand = objects.groupBy(scores, func(score) {
  return score >= 80 ? "high" : "low";
});

coreio.print(byBand);          // {high: {ada: 91, barbara: 88}, low: {alan: 64}}
```

To group a **list**, fold it yourself — there is no single call for it, because what the
groups should hold differs every time:

```ml
import "core:arrays";
import "core:objects";

var users = [{ role: "admin", n: "ada" }, { role: "user", n: "alan" }];

var byRole = arrays.reduce(users, func(acc, user) {
  // reading a key an object does not have is an error, so ask first
  if (!objects.hasOwnProperty(acc, user.role)) { acc[user.role] = []; }

  acc[user.role] = arrays.concat(acc[user.role], [user.n]);

  return acc;
}, {});

coreio.print(byRole);          // {admin: [ada], user: [alan]}
```

### Transforming values

```ml
var upper = objects.mapValues(headers, func(v) {
  return strings.toUpperCase(v);
});
```

### Merging configuration

```ml
var config = objects.merge(defaults, fromFile, fromEnvironment);
```

## Notes

- `merge` goes deep, `assign` does not: `assign` replaces a nested object wholesale, while
  `merge` combines it.
- `deepClone` copies nested structures, so changing the copy never touches the original.
- Iteration sees only an object's own members — a struct's `private` members stay hidden.
