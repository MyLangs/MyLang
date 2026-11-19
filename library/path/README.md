# `path`

File system paths, as text.

```ml
import "core:path";
```

## Suspension

**Every method returns immediately.** Nothing here touches the disk — these are string
operations, which is why they need no permission either.

| Method | Suspends | Description |
| --- | --- | --- |
| `path.join(…parts)` | — | join segments, normalising as it goes |
| `path.resolve(…parts)` | — | an absolute path |
| `path.normalize(p)` | — | collapse `.` and `..` |
| `path.relative(from, to)` | — | how to get from one to the other |
| `path.dirname(p)` | — | the directory part |
| `path.basename(p, extension)` | — | the last segment |
| `path.extname(p)` | — | the extension |
| `path.parse(p)` | — | `{ root, dir, base, name, ext }` |
| `path.format(parts)` | — | the inverse of `parse` |
| `path.isAbsolute(p)` | — | does it start at the root? |
| `path.toNamespacedPath(p)` | — | the Windows namespaced form |
| `path.sep` / `path.delimiter` | — | separators for this platform (fields) |
| `path.posix` / `path.win32` | — | the same API, forced to one platform |

## Examples

### Building paths

```ml
import "core:path";

var full = path.join(baseDir, "data", name + ".json");

coreio.print(path.basename(full));         // name.json
coreio.print(path.basename(full, ".json")); // name
coreio.print(path.extname(full));          // .json
coreio.print(path.dirname(full));          // …/data
```

### Taking one apart

```ml
var parts = path.parse("/home/ann/notes.txt");

coreio.print(parts.dir);    // /home/ann
coreio.print(parts.name);   // notes
coreio.print(parts.ext);    // .txt
```

### Keeping output inside a directory

```ml
func safeOutputPath(root, requested) {
  var full = path.resolve(root, requested);

  if (!strings.startsWith(full, path.resolve(root) + path.sep)) {
    throw "that path escapes the output directory";
  }

  return full;
}
```

### Walking a tree

```ml
import "core:fs";
import "core:path";

for (var name in fs.readdir(dir)) {
  var full = path.join(dir, name);

  if (fs.stat(full).isDirectory()) { continue; }

  coreio.print(path.relative(dir, full));
}
```

## Notes

- `join` is for combining segments; `resolve` also makes the result absolute, using the
  working directory when nothing else is.
- `path.posix` and `path.win32` let you handle paths for the other platform — useful when
  building archive entry names, which always use `/`.
