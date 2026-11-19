# `json`

JSON.

```ml
import "core:json";
```

## Suspension

**Both methods return immediately.**

| Method | Suspends | Description |
| --- | --- | --- |
| `json.parse(text, reviver)` | — | text to a value |
| `json.stringify(value, replacer, indent)` | — | a value to text |

## Examples

### Reading a config file

```ml
import "core:json";
import "core:fs";

var config = json.parse(fs.readFile("config.json").toString());

coreio.print(config.port);
```

### Writing one

```ml
fs.writeFile("config.json", json.stringify(config, nil, 2));
```

### Over the network

```ml
import "core:json";
import "core:net/http";

var client = http.Client();
var response = client.get("https://api.example.com/users");

for (var user in json.parse(response.data)) {
  coreio.print(user.name);
}
```

### Validating what came back

JSON tells you the text parsed, not that it has the shape you expect. `validation` does
that:

```ml
import "core:json";
import "core:validation" as v;

var schema = v.object({ id: v.integer(), name: v.string() });

var user = v.parse(schema, json.parse(body));
```

### A replacer and a reviver

```ml
var text = json.stringify(record, func(key, value) {
  if (key == "password") { return nil; }
  return value;
});

var back = json.parse(text, func(key, value) {
  if (key == "created") { return time.DateTime(value); }
  return value;
});
```

## Notes

- `parse` throws on malformed text, which is usually right for input from outside — wrap
  it in `try` when the source is untrusted.
- `stringify` with an indent produces readable output; without one, the compact form.
- A `bytes` value is not JSON: convert with `.toString()` first, or encode it with
  `crypto.base64Encode`.
