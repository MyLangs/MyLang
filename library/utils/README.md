# `utils`

Small helpers that do not belong anywhere else.

```ml
import "core:utils";
```

## Suspension

**Every method returns immediately.**

| Method | Suspends | Description |
| --- | --- | --- |
| `utils.typeOf(value)` | — | the language's own type name for a value |

## `typeOf`

The same answer the `typeof` operator gives, available as a function so it can be passed
around and used in a callback.

It returns one of: `"nil"`, `"boolean"`, `"int"`, `"float"`, `"bigint"`, `"nan"`,
`"infinity"`, `"string"`, `"array"`, `"object"`, `"function"`, `"struct"`, `"enum"`,
`"error"`, `"symbol"`.

## Examples

```ml
import "core:utils";

coreio.print(utils.typeOf(1));        // int
coreio.print(utils.typeOf(1.5));      // float
coreio.print(utils.typeOf(1n));       // bigint
coreio.print(utils.typeOf([1]));      // array
coreio.print(utils.typeOf(nil));      // nil
```

### Filtering by type

```ml
var numbersOnly = arrays.filter(mixed, func(v) {
  var t = utils.typeOf(v);
  return t == "int" || t == "float";
});
```

### Reporting a bad argument

```ml
func area(width, height) {
  if (utils.typeOf(width) != "int") {
    throw $"width must be an int, received {utils.typeOf(width)}";
  }

  return width * height;
}
```

## Notes

- `int` and `float` are different answers, unlike many languages that call both "number".
- A `bytes` value answers `"object"`; use `bytes.is(value)` to recognise one.
- `utils/colors` is the companion module for terminal colour.
