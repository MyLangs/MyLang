# `coreio`

Printing and reading from the console.

```ml
import "core:coreio";
```

## Suspension

| Method | Suspends | Description |
| --- | --- | --- |
| `coreio.input(prompt)` | yes | read a line from the user |
| `coreio.scan(prompt, options)` | yes | read and convert a value |
| everything else | — | writes and returns |

Reading from the console parks only the task that asked; other tasks keep running while
the user types.

## Printing

| Method | Suspends | Description |
| --- | --- | --- |
| `coreio.print(…)` | — | write a line |
| `coreio.println(…)` | — | write without a line break |
| `coreio.printError(…)` | — | write to standard error |
| `coreio.printWarning` / `printInfo` / `printSuccess` / `printDebug` | — | labelled output |
| `coreio.printJSON(value, indent)` | — | pretty-printed JSON |
| `coreio.table(rows)` | — | a table |
| `coreio.colorize(text, colour)` | — | wrap text in a colour |
| `coreio.clear()` | — | clear the screen |
| `coreio.group(label)` / `groupCollapsed` / `groupEnd` | — | indent a block of output |
| `coreio.time(label)` / `timeLog` / `timeEnd` | — | measure a block |
| `coreio.count(label)` / `countReset` | — | count occurrences |
| `coreio.trace()` | — | where the code is |
| `coreio.assert(condition, …)` | — | print when a condition fails |
| `coreio.dir(value)` / `dirxml` | — | inspect a value |

## Examples

### Printing values

```ml
import "core:coreio";

coreio.print("hello", 42, [1, 2], { a: 1 });
coreio.printJSON({ name: "Ann", roles: ["admin"] }, 2);
coreio.printError("that did not work");
```

### Asking the user

```ml
var name = coreio.input("What is your name? ");
var age = coreio.scan("How old are you? ", { type: "int" });

coreio.print($"Hello {name}, {age}");
```

### Colour

```ml
coreio.print(coreio.colorize("passed", "green"));
coreio.print(coreio.colorize("failed", "red"));
```

### Timing a block

```ml
coreio.time("load");
loadEverything();
coreio.timeEnd("load");        // load: 412ms
```

## Notes

- `print` formats values the way the language sees them: `bytes` shows its size, a struct
  shows its public members, a function shows its name.
- For colour beyond the basics, `utils/colors` has the full palette.
