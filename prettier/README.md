# `mylang prettier` — the MyLang formatter

```bash
mylang prettier --write          # format every .ml file in the project
mylang prettier --check          # exit 1 if anything is not formatted (for CI)
```

One style for every MyLang file, so a review is about what the code does and never about
where the spaces go. It is opinionated in the way [Prettier](https://prettier.io) is: there
are few options, and the ones there are change taste, not structure.

Three promises hold for everything it does:

1. **It never changes what a program means.** It moves only the space _between_ tokens. No
   token is added, removed, reordered or rewritten — a string's quote may change, its value
   may not. `--verify` re-lexes every result with the language's own lexer and fails if a
   single token differs.
2. **It never holds a file whole.** Files are read, tokenized, formatted and written as
   streams. What is in memory at once is one line of tokens and one unfinished token, so a
   file of any size formats in a few megabytes.
3. **It never leaves a file half-written.** `--write` streams the result into a temporary
   file beside the original and renames it over the original only if something changed.
   A file that cannot be formatted is left exactly as it was.

---

## Contents

|                                               |                                                                |
| --------------------------------------------- | -------------------------------------------------------------- |
| [Using it](#using-it)                         | the command, its modes, what it prints, its exit codes         |
| [Settings](#settings)                         | the `"prettier"` section of `mylang.json`, every option, flags |
| [Which files](#which-files)                   | directories, globs, `include` and `ignore`                     |
| [Ignore directives](#ignore-directives)       | preserve files and lines, and show skip diagnostics            |
| [What it does to code](#what-it-does-to-code) | every rule, with before and after                              |
| [What it refuses](#what-it-refuses)           | syntax errors, bad options                                     |
| [In a project](#in-a-project)                 | `mylang init`, scripts, CI, an editor                          |
| [How it works](#how-it-works)                 | the streaming design, and why it moves only whitespace         |

---

## Using it

```bash
mylang prettier [paths...] [options]
mylang fmt [paths...] [options]          # the same command
```

`paths` are files, directories or globs; without any, the current directory. A directory
contributes the files `include` matches, minus those `ignore` matches.

### Modes

| Mode                   | What it does                                                                                | Exit code |
| ---------------------- | ------------------------------------------------------------------------------------------- | --------- |
| _(none)_               | prints each file formatted to standard output                                               | 0         |
| `-w, --write`          | rewrites the files that are not formatted; prints `<file> formatted` for each, then a count | 0         |
| `-c, --check`          | changes nothing; prints `[warn] <file>` for each file that is not formatted                 | 1 if any  |
| `-l, --list-different` | changes nothing; prints only the names of those files                                       | 1 if any  |
| `--stdin`              | formats standard input to standard output                                                   | 0         |

The three file modes cannot be combined. Any mode may add `--verify`.

```bash
$ mylang prettier --check
[warn] src/server.ml
[warn] test/server.test.ml
[warn] 2 files are not formatted; run mylang prettier --write

$ mylang prettier --write
src/server.ml formatted
test/server.test.ml formatted
2 of 14 files formatted

$ mylang prettier --check
All matched files use MyLang style!
```

### Exit codes

| Code | Meaning                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------- |
| `0`  | everything is formatted (or has just been formatted)                                                    |
| `1`  | `--check` or `--list-different` found files that are not formatted                                      |
| `2`  | something could not be formatted at all: a syntax error, a bad option, a missing path, no files matched |

### `--verify`

```bash
mylang prettier --write --verify
```

Before anything is written, each file and its formatted version are lexed with the
interpreter's own lexer, and the two token lists must be identical — same kinds, same
values, same order. If they ever differ the file is reported (exit 2) and left alone.

This cannot fail on correct input — the formatter is built so it cannot — but it is how you
prove that on your own code instead of taking it on trust. It reads each file whole,
because the language's lexer does; without `--verify` nothing is.

### Colour

Output is coloured when the terminal supports it. `--no-colors` (or `--no-color`, or
`NO_COLOR=1`) turns that off, as it does for every `mylang` command.

---

## Settings

Settings come from three places, each overriding the one before:

1. the defaults
2. the `"prettier"` section of `mylang.json` — found by looking in the current directory and
   then upwards, the way `mylang` finds its project everywhere else
3. flags on the command line

```json
{
  "name": "my-project",
  "prettier": {
    "indent": 2,
    "useTabs": false,
    "printWidth": 100,
    "quote": "double",
    "bracketSpacing": true,
    "maxBlankLines": 1,
    "endOfLine": "lf",
    "finalNewline": true,
    "include": ["**/*.ml"],
    "ignore": [
      "node_modules/**",
      "mylang_modules/**",
      ".module/**",
      ".mylang/**",
      "dist/**",
      ".git/**"
    ]
  }
}
```

### Every option

| Option           | Flag                    | Default       | Values                           | What it does                                                                        |
| ---------------- | ----------------------- | ------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `indent`         | `--indent <n>`          | `2`           | 1–16                             | spaces per level of indentation                                                     |
| `useTabs`        | `--use-tabs`            | `false`       | `true` / `false`                 | indent with tabs instead                                                            |
| `printWidth`     | `--print-width <n>`     | `100`         | 0–1000                           | longer lines are broken at their commas where a bracket allows it; `0` never breaks |
| `quote`          | `--quote <style>`       | `"double"`    | `double` / `single` / `preserve` | the quote plain strings use                                                         |
| `bracketSpacing` | `--no-bracket-spacing`  | `true`        | `true` / `false`                 | `{ a: 1 }` rather than `{a: 1}`                                                     |
| `maxBlankLines`  | `--max-blank-lines <n>` | `1`           | 0–10                             | longest run of empty lines kept                                                     |
| `endOfLine`      | `--end-of-line <style>` | `"lf"`        | `lf` / `crlf`                    | the line ending written                                                             |
| `finalNewline`   | `--no-final-newline`    | `true`        | `true` / `false`                 | end a file with exactly one line break                                              |
| `include`        | —                       | `["**/*.ml"]` | globs                            | which files a directory contributes                                                 |
| `ignore`         | —                       | see above     | globs                            | files and directories never touched                                                 |

Globs are relative to the directory of `mylang.json`.

### Choosing the settings file

| Flag              | Effect                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--config <file>` | read settings from this file. If it has a `"prettier"` key, that section is used; otherwise the whole file is the settings |
| `--no-config`     | ignore every file and use the defaults (plus any flags)                                                                    |

```bash
mylang prettier --config style.json --check
mylang prettier --no-config --indent 4 legacy/
```

### Mistakes are errors

A setting the formatter does not know, or a value it cannot use, stops the run with exit
code 2 instead of being ignored — a misspelt option that silently does nothing is the worst
kind of setting:

```
[error] unknown prettier option 'indnet' in /work/app/mylang.json; known options: indent, useTabs, printWidth, quote, bracketSpacing, maxBlankLines, endOfLine, finalNewline, include, ignore
[error] prettier option 'quote' must be one of double, single, preserve, got "curly"
```

---

## Which files

```bash
mylang prettier --check                  # the project: everything include matches
mylang prettier --check src test         # two directories
mylang prettier --write "src/**/*.ml"    # a glob (quote it, so the shell does not expand it)
mylang prettier tools/build.ml           # one file, printed formatted
```

- A **directory** is walked recursively; it contributes the files `include` matches and
  skips everything `ignore` matches, including whole directories, which are not entered.
- A **file** named outright is formatted whatever its extension — unless `ignore` matches it.
- A **glob** is matched against paths relative to the current directory.
- A file named twice (directly and through a directory, say) is formatted once.
- Nothing is listed ahead of time: directories are read as they are walked.

The default `ignore` leaves alone what is not yours: installed modules (`node_modules`,
`mylang_modules`, `.module`), the interpreter's cache (`.mylang`), build output (`dist`) and
`.git`.

---

## Ignore directives

Comments can opt a file, one physical line, or a range of lines out of formatting.
The directive must be a **standalone `//` comment** (optional indentation and spaces
before the marker are accepted).

### Whole file

Put `// @mylang/prettier-ignore` on the first nonblank line of a file:

```ml
    // @mylang/prettier-ignore
func    legacy( ) { return  1 ; }
```

The entire file stays **byte-for-byte unchanged**, including leading blank lines, a
possible UTF-8 BOM, and its original line endings. The marker must precede any
actual code; after code it has no special effect.

### One physical line

```ml
func example() {
  // @mylang/prettier-ignore-next-line
  var    x=  [1, 2 ,3];
  var    y= 4;
}
```

The **immediately following physical line** is preserved exactly, including its
indentation and trailing whitespace. Other lines are formatted normally.

### A block of lines

```ml
func example() {
  // @mylang/prettier-ignore-start
  var   x=  1;
  var     y=2;
  // @mylang/prettier-ignore-end
  var   z=3;
}
```

Everything from the start marker through the end marker is kept as-is. An
unclosed `ignore-start` protects the rest of the file. Directives in string
literals and block comments do not count.

### Diagnostic messages

When formatting files or a directory, ignored regions are reported on **stderr**,
so `--list-different` still prints _only_ unformatted filenames on stdout:

```text
[skip] src/legacy.ml: file ignored
[skip] src/main.ml:12: line ignored
[skip] src/tools.ml:8-15: block ignored
```

This applies to `--write`, `--check`, and `--list-different`. Ignored code is not
rewritten and does not cause `--check` to fail. Files ignored by `mylang.json`
patterns are not opened and have no directive diagnostics.

---

## What it does to code

The examples use the default settings.

### Indentation follows the brackets

A line that leaves brackets open indents what follows by **one** level, however many
brackets it opened, and the line that closes them returns to where the opening line was:

```ml
describe("a group", func() {
test("one", func() {
assert.ok(true);
});
});
```

```ml
describe("a group", func() {
  test("one", func() {
    assert.ok(true);
  });
});
```

### Continuation lines are one level deeper

A line that starts with `.`, `?`, `:` or a binary operator, or follows a line that ended
with one (or with `=`), continues the expression above it:

```ml
var total = first +
  second;

var label = ready
  ? "go"
  : "wait";
```

A line that starts with `-` or `+` after a `,` or an opening bracket is a new item with a
sign, not a continuation, so `f(a,\n-1)` is not indented twice.

### Spacing

| Before                        | After                     |
| ----------------------------- | ------------------------- |
| `var  x=1+2;`                 | `var x = 1 + 2;`          |
| `f( a ,b )`                   | `f(a, b)`                 |
| `if(x){y();}`                 | `if (x) { y(); }`         |
| `{a:1,b:[1,2]}`               | `{ a: 1, b: [1, 2] }`     |
| `x=cond?1:2`                  | `x = cond ? 1 : 2`        |
| `a ?. b`                      | `a?.b`                    |
| `return - x`                  | `return -x`               |
| `o.n ++`                      | `o.n++`                   |
| `func [ symbol.dispose ] ( )` | `func [symbol.dispose]()` |
| `x;   // note`                | `x; // note`              |

Keywords take a space before `(`: `if (`, `for (`, `while (`, `match (`, `catch (`,
`return (`. A function name does not: `func add(`, `add(1)`, `func(`. `import (` and
`export (` keep whatever spacing they were written with, since both forms are used.

Two tokens are never pushed together if that would read back as something else: `- -x`
stays `- -x` rather than becoming `--x`, and `/ /` never becomes a comment.

### Blank lines

- none at the start of the file or at the end;
- none right after an opening bracket or right before a closing one;
- at most `maxBlankLines` in a row anywhere else.

### Quotes

With `"quote": "double"` (the default) a plain string is written with double quotes —
unless that would need more escapes than the quote it has:

| Before         | After                        |
| -------------- | ---------------------------- |
| `'plain'`      | `"plain"`                    |
| `'say "hi"'`   | `'say "hi"'` (fewer escapes) |
| `"say \"hi\""` | `'say "hi"'` (fewer escapes) |
| `'it\'s'`      | `"it's"`                     |

The string's value is identical in every case. `"""` text blocks and `$"..."` interpolated
strings are never touched — not their quotes and not a character inside them. `preserve`
leaves every quote as written.

### Long lines

A line longer than `printWidth` is broken at the top-level commas of the first bracket that
opens and closes on it — one item per line, the closing bracket back at the line's own
indentation — and each piece is laid out again, so a bracket inside a piece breaks in turn
when the piece still does not fit:

```ml
assert.equal(crypto.sha256("hello"), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
```

```ml
assert.equal(
  crypto.sha256("hello"),
  "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
);
```

No comma is added. A line that has no such bracket — a long string, a long chain without
commas — is left long. Apart from this, where lines break is the author's decision:
the formatter does not join lines.

### Comments

A trailing comment keeps one space before it. A comment on a line of its own is indented
like code. The inside of a `/* ... */` comment is never changed.

### Line endings and the end of the file

`\r\n` and `\n` in the input are both understood; the output uses `endOfLine`. A byte-order
mark at the start is dropped. With `finalNewline` the file ends with exactly one line break.

---

## What it refuses

Input the language's lexer would refuse is refused here too, with the position, and the
file is left untouched (exit code 2):

```
[error] src/app.ml: unterminated string at 12:9
[error] src/app.ml: unterminated comment at 40:1
[error] src/app.ml: unterminated """ string at 3:11
```

In a run over many files, the others are still formatted.

---

## In a project

### `mylang init`

`mylang init` asks whether to add formatter settings; `mylang init -y` adds them. Either
way you get every option written out in `mylang.json`, and two scripts:

```json
"scripts": {
  "format": "mylang prettier --write",
  "format:check": "mylang prettier --check"
}
```

```bash
mylang run format
mylang run format:check
```

`mylang init --no-prettier` leaves both out. Re-running `init` on a project keeps the
`"prettier"` section it already has.

### CI

```bash
mylang prettier --check --no-colors
```

Exit code 1 fails the build and the log lists every file that needs formatting.

### Editors and pipes

`--stdin` reads standard input and writes standard output as a stream, which is what an
editor's "format on save" needs:

```bash
mylang prettier --stdin < app.ml > app.formatted.ml
```

Settings still come from the `mylang.json` above the current directory.

---

## How it works

```
file ─▶ read stream ─▶ UTF-8 decoder ─▶ tokenizer ─▶ line formatter ─▶ write stream ─▶ temp file ─▶ rename
         (chunks)       (no split         (only the     (only the
                         characters)       unfinished    current line)
                                           token held)
```

| File           | Role                                                                                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokenizer.ts` | reads text a chunk at a time and returns finished tokens; a token cut by the end of a chunk waits for the next one. It recognises exactly what the interpreter's lexer does — the operator list is taken from the lexer itself — but keeps every token's original text |
| `formatter.ts` | takes tokens and writes a line as soon as its line break arrives: indentation from a stack of open bracket groups, spacing from the pair of tokens on either side, blank lines, quotes, long lines                                                                     |
| `index.ts`     | the streams: `createFormatStream()` (a Node `Transform`), `formatFile()`, `checkFile()`, `formatText()`                                                                                                                                                                |
| `options.ts`   | defaults, `mylang.json`, validation                                                                                                                                                                                                                                    |
| `cli.ts`       | `mylang prettier`: finding files, the modes, reporting, exit codes                                                                                                                                                                                                     |

**Why only whitespace.** A formatter that rebuilds code from a syntax tree can reflow
anything, but it has to hold the whole tree — the whole file — and every rule it applies is
a chance to change what the program does. This one works on the token stream instead: every
decision is about the space between two tokens, so the program the interpreter reads is the
same program, and the file never has to fit in memory. The one structural thing it does,
breaking long lines, still only moves a break between tokens that were already there.

**How that is checked.** `npm run check:prettier` formats every `.ml` file and every code
example in the repository's documentation with the default settings and with a deliberately
unusual set (tabs, single quotes, a 40-column width, no blank lines, CRLF), and for each one
checks that the result lexes to the same tokens, that formatting it again changes nothing,
and that feeding it through the stream one byte at a time gives the same result as all at
once. `npm run check:prettier:suite` then formats a copy of the whole test suite and runs it
— every test still passes. The command line itself is tested from the language, in
`test/tools/prettier.test.ml`.

**Using it from code.**

```js
const { createFormatStream } = require("mylang2/dist/prettier");

fs.createReadStream("app.ml")
  .pipe(
    createFormatStream({
      indent: 2,
      useTabs: false,
      printWidth: 100,
      quote: "double",
      bracketSpacing: true,
      maxBlankLines: 1,
      endOfLine: "lf",
      finalNewline: true,
    }),
  )
  .pipe(process.stdout);
```
