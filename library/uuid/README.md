# `uuid`

UUIDs.

```ml
import "core:uuid";
```

## Suspension

**Every method returns immediately.**

## Methods

| Method | Description |
| --- | --- |
| `uuid.v4()` | random — the usual choice for an identifier |
| `uuid.v1()` | time-based, so values sort roughly by creation |
| `uuid.v3(namespace, name)` | derived from a name, with MD5 |
| `uuid.v5(namespace, name)` | derived from a name, with SHA-1 |
| `uuid.generate(version, …)` | any of the above by number |
| `uuid.nil()` / `uuid.isNil(value)` | the all-zero UUID |
| `uuid.isValid(value)` | does this parse? |
| `uuid.version(value)` | which version is it? |
| `uuid.parse(value)` | its parts |
| `uuid.compare(a, b)` / `uuid.equal(a, b)` | ordering and equality |
| `uuid.toBytes(value)` / `fromBytes(bytes)` | the 16-byte form |
| `uuid.toHex(value)` / `fromHex(text)` | without dashes |
| `uuid.short(value)` / `fromShort(text)` | a compact base64 form |
| `uuid.batch(count, version)` | several at once |
| `uuid.getTime(value)` | when a v1 UUID was made |
| `uuid.namespaceDNS()` / `namespaceURL()` / `namespaceOID()` / `namespaceX500()` | the standard namespaces |

## Examples

### An identifier

```ml
import "core:uuid";

var id = uuid.v4();

coreio.print(id);                  // e.g. 7d3a…-…-4…-…-…
coreio.print(uuid.isValid(id));    // true
coreio.print(uuid.version(id));    // 4
```

### The same name, the same UUID

```ml
var id = uuid.v5(uuid.namespaceURL(), "https://example.com/users/1");

// anywhere, any time, the same input gives the same id
```

### Sortable identifiers

```ml
var ids = uuid.batch(5, 1);        // v1: roughly ordered by creation time

coreio.print(uuid.getTime(ids[0]));
```

### Storing one compactly

```ml
var id = uuid.v4();

var packed = uuid.toBytes(id);     // 16 bytes instead of 36 characters
var short = uuid.short(id);        // 22 characters

coreio.print(uuid.fromBytes(packed) == id);   // true
```

## Notes

- `v4` is random and is what you want unless you need one of the others.
- `v3` and `v5` are deterministic: the same namespace and name always produce the same
  UUID, which is how you derive a stable id from something you already have.
- `v1` encodes a timestamp and a machine identifier, so it leaks a little about where and
  when it was made.
