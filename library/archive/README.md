# `archive`

Reading and writing tar and zip archives.

```ml
import "core:archive";
```

An archive is an ordinary `bytes` value, so it can come from `fs`, from an HTTP response,
or straight off a socket without ever being written to disk. Compression is not
reimplemented here: deflate comes from the same code `compress` uses.

## Suspension

| Method | Suspends | Description |
| --- | --- | --- |
| `archive.zip(entries, options)` | yes | build a zip (entries are deflated) |
| `archive.unzip(data)` | yes | entries of a zip |
| `archive.tar(entries)` | — | build a tar (no compression involved) |
| `archive.untar(data)` | — | entries of a tar |
| `archive.read(data)` | yes | entries of a zip, tar or tar.gz, format detected |
| `archive.extract(data, destination)` | yes | unpack onto disk; returns the names written |
| `archive.create(directory, format, options)` | yes | pack a directory into `"zip"` or `"tar"` |
| `archive.extractFile(archive, destination)` | yes | unpack an archive **from disk**, one entry at a time |
| `archive.createFile(directory, archive, format)` | yes | pack a directory **onto disk**, streaming each file |
| `archive.format(data)` | — | `"zip"`, `"tar"`, `"gzip"` or `"unknown"` |

## Permissions

| Method | Needs |
| --- | --- |
| `archive.extract` | `--allow-write` for the destination |
| `archive.create` | `--allow-read` for the directory |
| `archive.extractFile` | `--allow-read` for the archive, `--allow-write` for the destination |
| `archive.createFile` | `--allow-read` for the directory, `--allow-write` for the archive |

Everything else works purely on values in memory and needs no permission.

## Entries

An entry you pass in:

| Field | Meaning |
| --- | --- |
| `name` | path inside the archive (required) |
| `data` | contents: `bytes`, a string, or a byte array |
| `directory` | `true` for a directory entry |
| `mode` | permission bits; `0644` for files, `0755` for directories |
| `mtime` | modification time |

An entry you get back carries `name`, `data` (as `bytes`), `size`, `directory`, `mode` and
`mtime`.

## Archives too large to hold

`archive.extract` needs the whole archive in memory as a `bytes` value first, which a
multi-gigabyte archive cannot satisfy. `archive.extractFile` reads it from disk instead: a
tar is walked block by block, and a zip through its directory, one entry at a time. The
memory it uses depends on the largest entry rather than on the size of the archive.

```ml
var names = archive.extractFile("./backup.zip", "./restored");

coreio.print(length(names), "files restored");
```

Entry names are checked exactly as in `archive.extract`, so an untrusted archive cannot
write outside the destination.

`archive.createFile` is the other direction — it writes the archive as it goes, streaming
each file from disk into the output, so what the program holds does not depend on the size
of the tree or of any file in it:

```ml
archive.createFile("./site", "./site.zip", "zip");
archive.createFile("./site", "./site.tar", "tar");
```

A gzipped archive has to be read as one piece, since the compression wraps the whole file;
`extractFile` says so rather than failing obscurely. Unpack it first:

```ml
compress.file("gunzip", "./backup.tar.gz", "./backup.tar");
archive.extractFile("./backup.tar", "./restored");
```

## Large and unusual archives

Both formats have limits that an old reader cannot see past, and both have a standard way
around them, which this library writes and reads:

- **A zip** counts its entries in 16 bits and its sizes in 32, so past 65,535 entries or
  4 GB it carries a *zip64* end record. Archives written here use it only when they must,
  so a small archive stays readable by anything, and archives read here follow it when it
  is there.
- **A tar** has 100 bytes for an entry name. A longer one travels in a *PAX extended
  header* ahead of its entry — what GNU tar and bsdtar both write — and is read back
  whole. The older GNU long-name form is read as well.

Nothing has to be asked for: a 70,000-entry zip and a deeply nested path simply work, and
the system `unzip` and `tar` read what comes out.

## Examples

### Building a zip in memory and sending it

```ml
import "core:archive";
import "core:fs";

var bundle = archive.zip([
  { name: "README.md", data: fs.readFile("README.md") },
  { name: "src/", directory: true },
  { name: "src/main.ml", data: fs.readFile("src/main.ml") }
]);

fs.writeFile("bundle.zip", bundle);
```

### Reading an archive without knowing its format

```ml
var entries = archive.read(fs.readFile(name));

for (var entry in entries) {
  if (entry.directory) { continue; }

  coreio.print(entry.name, entry.size);
}
```

### Restoring a backup larger than memory

```ml
import "core:archive";

// a 20 GB archive, unpacked under a 256 MB limit: only one entry is held at a time
var restored = archive.extractFile("./nightly.tar", "./restore");

coreio.print("restored", length(restored), "files");
```

```
mylang run restore.ml --allow-read=./nightly.tar --allow-write=./restore --max-memory=256MB
```

### Packing a directory and unpacking it elsewhere

```ml
var packed = archive.create("./site", "zip", { level: 9 });
var written = archive.extract(packed, "./deploy");

coreio.print($"extracted {length(written)} file(s)");
```

### A tar.gz

```ml
import "core:archive";
import "core:compress";

var tarred = archive.tar([{ name: "notes.txt", data: "hello" }]);

fs.writeFile("notes.tar.gz", compress.gzip(tarred));

// reading it back needs no special handling
var entries = archive.read(fs.readFile("notes.tar.gz"));
```

## Untrusted archives

An entry name that climbs out of the destination (`../../etc/passwd`, `/etc/passwd`, a
Windows drive letter) is how an archive writes over files it was never given. Those names
are **refused**, both when packing and when extracting:

```ml
archive.zip([{ name: "../escape", data: "x" }]);
// Error: entries[0].name escapes the archive root: "../escape"
```

`archive.extract` additionally re-checks every name it reads from the archive, so an
archive built elsewhere cannot reach outside the destination you gave it.

## Notes

- zip entries use stored or deflate; an entry that would grow when compressed is stored
  as-is, like every zip writer does.
- tar uses the ustar format, so names are limited to 100 bytes — a longer one is reported
  rather than silently truncated.
- `archive.read` handles `.zip`, `.tar` and `.tar.gz`. For other formats, unpack the outer
  layer with `compress` first.
