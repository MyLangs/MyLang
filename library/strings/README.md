# `strings`

Text.

```ml
import "core:strings";
```

## Suspension

**Every method returns immediately.** There is nothing to wait for; `spawn` buys you
nothing here.

## Methods

### Looking at text

| Method | Description |
| --- | --- |
| `strings.at(s, i)` / `charAt(s, i)` | one character (`at` accepts negatives) |
| `strings.charCodeAt(s, i)` / `codePointAt(s, i)` | its numeric value |
| `strings.length(s)` | how many characters |
| `strings.includes(s, part)` | is it there? |
| `strings.indexOf(s, part)` / `lastIndexOf(s, part)` | where |
| `strings.startsWith(s, part)` / `endsWith(s, part)` | at the edges |
| `strings.count(s, part)` | how many times |
| `strings.localeCompare(a, b)` | ordering |

### Changing it

| Method | Description |
| --- | --- |
| `strings.replace(s, from, to)` / `replaceAll(s, from, to)` | substitute |
| `strings.slice(s, start, end)` / `substring` / `substr` | a piece |
| `strings.split(s, separator)` / `join(parts, separator)` | apart and back |
| `strings.repeat(s, n)` / `concat(…)` | build |
| `strings.padStart(s, n, fill)` / `padEnd(s, n, fill)` | pad |
| `strings.trim(s)` / `trimStart` / `trimEnd` / `trimLeft` / `trimRight` | strip whitespace |
| `strings.insert(s, i, text)` / `remove(s, start, end)` | edit by position |
| `strings.truncate(s, n, suffix)` | shorten with an ellipsis |
| `strings.reverse(s)` | backwards |
| `strings.wrapWith(s, mark)` / `wrapBetween(s, open, close)` | surround |

### Case

| Method | Description |
| --- | --- |
| `strings.toLowerCase(s)` / `toUpperCase(s)` | case |
| `strings.toLocaleLowerCase` / `toLocaleUpperCase` | locale-aware case |
| `strings.capitalize(s)` | first letter up |
| `strings.toTitleCase(s)` | Every Word Up |

### Splitting into units

| Method | Description |
| --- | --- |
| `strings.lines(s)` | split on line breaks |
| `strings.words(s)` | split on whitespace |

### Building from codes

| Method | Description |
| --- | --- |
| `strings.fromCharCode(…)` / `fromCodePoint(…)` | characters from numbers |
| `strings.raw(…)` | a raw template |
| `strings.normalize(s, form)` | Unicode normalisation |

## Examples

### Parsing a line

```ml
import "core:strings";

var line = "  name = Ann  ";
var parts = strings.split(strings.trim(line), "=");

var key = strings.trim(parts[0]);
var value = strings.trim(parts[1]);
```

### Formatting output

```ml
for (var row in rows) {
  coreio.print(strings.padEnd(row.name, 20) + strings.padStart($"{row.count}", 6));
}
```

### Working with a file's contents

```ml
import "core:fs";
import "core:strings";

var text = fs.readFile("notes.txt").toString();

for (var line in strings.lines(text)) {
  if (strings.startsWith(line, "#")) { continue; }

  coreio.print(strings.toTitleCase(line));
}
```

### Truncating for display

```ml
coreio.print(strings.truncate(description, 60, "…"));
```

## Notes

- Strings are immutable: every method returns a new string rather than changing the one
  you passed.
- For binary data, use `bytes`; converting with `.toString(encoding)` is the bridge.
