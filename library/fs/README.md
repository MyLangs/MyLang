# `fs`

The file system.

```ml
import "core:fs";
```

## Suspension

**Every operation here suspends.** The calling task parks on the host's asynchronous file
API and every other task keeps running, so `spawn fs.readFile(…)` really is concurrent.

You write the call normally — `wait` is not a prefix. Use `spawn` when you want file work
to overlap with other work:

```ml
var a = spawn fs.readFile("a.txt");
var b = spawn fs.readFile("b.txt");

var contents = wait.all([a, b]);
```

Each function also accepts a trailing callback, in which case it returns `nil` immediately
and calls you back later. The direct form is usually clearer.

## Permissions

| Operation | Needs |
| --- | --- |
| reading a file, a directory, a link, `stat`, `exists` | `--allow-read` |
| writing, creating, deleting, renaming, `chmod`, `chown`, `truncate` | `--allow-write` |
| `rename`, `copyFile`, `FSUtils().move` | both, on both paths |
| `fs.open` / `fs.file` | whichever the flags imply (`"r"` → read, `"w"`/`"a"`/`"+"` → write) |

```
mylang run app.ml --allow-read=./data --allow-write=./out
```

## Whole files

| Method | Suspends | Description |
| --- | --- | --- |
| `fs.readFile(path, options)` | yes | contents as `bytes` |
| `fs.writeFile(path, data, options)` | yes | replace the contents |
| `fs.appendFile(path, data, options)` | yes | add to the end |
| `fs.exists(path)` | yes | `true` / `false` |
| `fs.unlink(path)` | yes | delete a file |
| `fs.rename(from, to)` | yes | move or rename |
| `fs.copyFile(src, dest, mode)` | yes | copy |
| `fs.truncate(path, length)` | yes | shorten or extend |

`data` may be a string, a `bytes` value, a buffer or an array of byte values.

## Directories

| Method | Suspends | Description |
| --- | --- | --- |
| `fs.readdir(path, options)` | yes | the names inside |
| `fs.makedir(path, options)` | yes | create (`{ recursive: true }` for parents) |
| `fs.removedir(path, options)` | yes | remove |

## Metadata

| Method | Suspends | Description |
| --- | --- | --- |
| `fs.stat(path)` | yes | follows symbolic links |
| `fs.lstat(path)` | yes | does not follow them |
| `fs.FStat(fd)` | yes | by file descriptor |
| `fs.access(path, mode)` | yes | can this be reached? |
| `fs.chmod(path, mode)` | yes | permission bits |
| `fs.chown(path, uid, gid)` | yes | ownership |
| `fs.symlink(target, path, type)` | yes | create a symbolic link |
| `fs.readlink(path)` | yes | where a link points |
| `fs.realpath(path)` | yes | resolve every link |

A stats value answers `isFile()`, `isDirectory()`, `isSymbolicLink()`, `size()`, `mode()`,
`uid()`, `gid()`, `mtime()`, `ctime()`, `atime()` and `birthtime()`.

`fs.constants` holds `F_OK`, `R_OK`, `W_OK`, `X_OK` and the `COPYFILE_*` flags.

## Open files

Two styles, for two different needs.

An open handle holds a slot counted against `--max-open-files`, given back when it closes.
A program that opens files in a loop without releasing them runs out of slots and is told
so by name, instead of exhausting the system's own descriptors — which is the other reason
`defer` is the habit worth keeping here.

**A descriptor** — the low-level form, for code that already works with descriptors:

| Method | Suspends | Description |
| --- | --- | --- |
| `fs.open(path, flags, mode)` | yes | returns a numeric descriptor |
| `fs.read(fd, buffer, offset, length, position)` | yes | `{ bytesRead, buffer }` |
| `fs.write(fd, data, offset, length, position)` | yes | bytes written |
| `fs.close(fd)` | yes | release it |

**A handle** — the owned-resource form, which `defer` can release:

```ml
func readHeader(path) {
  var file = defer fs.file(path, "r");

  return file.read(512);
  // closed here, however the function returns
}
```

| Method | Suspends | Description |
| --- | --- | --- |
| `fs.file(path, flags, mode)` | yes | an open file as a resource |
| `file.read(size, position)` | yes | up to `size` bytes; empty at the end |
| `file.readAll()` | yes | the whole file from the current position |
| `file.write(data, position)` | yes | bytes written |
| `file.stat()` | yes | metadata of this handle |
| `file.truncate(length)` | yes | shorten |
| `file.sync()` | yes | flush to the device |
| `file.close()` | yes | release it (idempotent) |
| `file.closed` / `file.path` | — | fields |

## Watching

| Method | Suspends | Description |
| --- | --- | --- |
| `fs.Watcher(path, options, listener)` | — | a watcher, as a resource |
| `watcher.on(event, handler)` | — | add a listener |
| `watcher.once(event, handler)` | — | add a one-shot listener |
| `watcher.close()` | — | stop watching (idempotent) |
| `watcher.ref()` / `watcher.unref()` | — | whether it keeps the program alive |
| `fs.WatchFile(path, options, listener)` | — | poll one file for changes |

A watcher also carries `symbol.dispose`, so `defer` stops it.

## Helpers

`fs.FSUtils()` returns an object of higher-level operations:

| Method | Suspends | Description |
| --- | --- | --- |
| `ensureDir(path)` | yes | create a directory and its parents |
| `removeDir(path)` | yes | remove a directory and everything in it |
| `copyDir(src, dest)` | yes | copy recursively |
| `move(src, dest)` | yes | rename, falling back to copy+delete across devices |
| `getSize(path)` | yes | size of a file, or of a whole directory |
| `isEmpty(path)` | yes | is this directory empty? |
| `createTemp(prefix, suffix, dir)` | yes | create a temporary file and return its path |
| `walk(path, callback, options)` | yes | visit every entry; return `false` to skip a directory |

## Examples

### Reading and writing

```ml
import "core:fs";

var config = fs.readFile("config.json").toString();

fs.writeFile("backup.json", config);
fs.appendFile("log.txt", "backed up\n");
```

### Releasing a handle whatever happens

```ml
func appendLine(path, line) {
  var file = defer fs.file(path, "a");

  file.write(line + "\n");

  if (length(line) > 1000) { throw "line too long"; }   // the file is still closed
}
```

### Walking a tree

```ml
var utils = fs.FSUtils();

utils.walk("./src", func(path, stats) {
  if (stats.isDirectory()) { return true; }

  coreio.print(path, stats.size());
});
```

### Reading many files at once

```ml
var jobs = [];

for (var name in fs.readdir("./data")) {
  jobs[length(jobs)] = spawn fs.readFile("./data/" + name);
}

var files = wait.all(jobs);
```

### Watching for changes

```ml
var watcher = defer fs.Watcher("./src", { recursive: true }, func(event, name) {
  coreio.print(event, name);
});

wait spawn time.Sleep(60000);
```

## Notes

- `fs.readFile` returns `bytes`, not a string: call `.toString()` (optionally with an
  encoding) when you want text. Keeping it binary means the result goes straight into
  `crypto`, `compress`, `archive`, `tcp` or `ws`.
- There are no `*Sync` variants. A synchronous read would stop every task in the program,
  which is exactly what this library is built to avoid.
- `fs/stream` is the companion for files too large to hold in memory.
