# `utils/colors`

Terminal colour and text styling.

```ml
import "core:utils/colors";
```

## Suspension

**Every method returns immediately.** Each one wraps text in escape codes and hands it
back; printing is still `coreio`'s job.


## Methods

### Foreground

`red`, `green`, `blue`, `yellow`, `magenta`, `cyan`, `white`, `black`, `gray` (`grey`),
and the bright forms `brightRed`, `brightGreen`, `brightBlue`, `brightYellow`,
`brightMagenta`, `brightCyan`, `brightWhite`

### Background

`bgRed`, `bgGreen`, `bgBlue`, `bgYellow`, `bgMagenta`, `bgCyan`, `bgWhite`, `bgBlack`

### Styles

`bold`, `dim`, `italic`, `underline`, `strikethrough`, `reverse`

### True colour

| Method | Description |
| --- | --- |
| `colors.rgb(text, r, g, b)` / `bgRgb(…)` | 24-bit colour |
| `colors.hex(text, "#ff8800")` / `bgHex(…)` | the same, as hex |
| `colors.hsl(text, h, s, l)` / `bgHsl(…)` | the same, as HSL |

### Helpers

| Method | Description |
| --- | --- |
| `colors.combine(text, …styles)` | apply several at once |
| `colors.rainbow(text)` | a colour per character |
| `colors.random(text)` | a random colour |
| `colors.strip(text)` | remove every escape code |
| `colors.enabled(on)` | turn colouring on or off globally |
| `colors.Colors` / `colors.Styles` | the raw codes (fields) |

## With `--no-colors`

When a program runs with `mylang --no-colors` (or `--no-color`), every function here
returns its text unchanged — `colors.red("x")` is `"x"`, so its length is the text's length —
and `colors.enabled()` is `false`. The first such call prints one warning, once per run:

```
ColorsDisabled: colours are turned off (--no-colors): utils/colors.red and every other colour function return plain text [WARN004]
```

`colors.strip` and `colors.enabled` are not colour producers and behave as always. Colour
codes a program writes by hand are removed from its output too.
## Examples

### Status output

```ml
import "core:utils/colors";

coreio.print(colors.green("✓ passed"));
coreio.print(colors.red("✗ failed"));
coreio.print(colors.gray("  skipped"));
```

### Combining styles

```ml
coreio.print(colors.combine("important", "bold", "underline", "red"));
```

### True colour

```ml
coreio.print(colors.hex("warning", "#ff8800"));
coreio.print(colors.rgb("link", 0, 120, 255));
```

### Respecting a plain terminal

```ml
import "core:os";
import "core:utils/colors";

colors.enabled(!os.getenv("NO_COLOR"));

coreio.print(colors.green("works either way"));
```

### Measuring coloured text

Escape codes count toward a string's length, which breaks alignment. Strip them first:

```ml
var label = colors.green("ok");

coreio.print(length(label));                  // includes the escape codes
coreio.print(length(colors.strip(label)));    // 2
```

## Notes

- `colors.enabled(false)` makes every function return its text unchanged, which is the
  clean way to support `NO_COLOR` and log files.
- True colour needs a terminal that supports it; the basic sixteen work everywhere.
