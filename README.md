# 👻 MyLang2 Programming Language

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.3.0-green.svg)]()
[![Build](https://img.shields.io/badge/build-stable-success.svg)]()

---

## 🔓 Overview

**MyLang2** is a powerful, expressive programming language that harmoniously combines simplicity with advanced features. Designed for modern development needs, it offers a rich ecosystem of built-in libraries, flexible syntax patterns, and contemporary programming constructs that enable developers to build robust applications efficiently.

> ✨ **New in v2.1.0**: Complete parser rewrite with industry-standard Pratt algorithm! All operator precedence issues have been fixed, ternary operators now work correctly, and mathematical expressions evaluate as expected.

### ✨ New in v2.3.0

| Area | What changed |
| --- | --- |
| [**`mylang prettier`**](prettier/README.md) | A formatter for the language, settings in `mylang.json`, `--check` for CI, `--write` to fix. Streams every file, so a file larger than memory formats in a few megabytes. It only moves whitespace, and `--verify` proves it. |
| [**`--no-colors`**](#turning-colour-off) | One switch turns colour off everywhere: the CLI, the test runner, warnings, errors, every library, and the program's own output. A colour function returns plain text and says so — once. |
| [**`symbol.dispose` in a struct**](#symbol-members-of-a-struct) | `func [symbol.dispose]() { ... }` declared in the struct body, so `defer Report(file)` releases what the struct owns. `func [symbol.iterator]()` the same way. |
| [**`obj.x++`**](#variables-and-constants) | `++` and `--` on a member, an index or a static: `this.count++`, `items[i]--`, `Counter.created++`. |
| [**`iter`, finished**](library/iter/README.md) | `iter.map`, `filter`, `take`, `skip`, `toArray`, `forEach` — functions, like the rest of the library — and every `iter` function accepts a custom iterable: an object with `[symbol.iterator]`, or a struct. Callbacks may suspend. |
| [**Quiet servers**](library/net/http/README.md#errors) | `http.Server({ onError })` receives every error as a value; by default only the server's own failures are printed, one line each, instead of a stack for every client that hung up. |
| [**Fixes**](CHANGELOG.md#230) | `typeof o.n + "!"`, a struct's `this` captured in `init`, `"x" + bytes`, and `url.URL(url.format(...))`. |

### ✨ New in v2.2.0

| Area | What changed |
| --- | --- |
| [**Permissions**](#-permissions-and-resource-limits) | A program declares what it may touch: `--allow-read`, `--allow-net`, `--deny-process`, `--max-memory`, `--timeout`. Nothing is restricted until you ask for it. |
| [**`core:` imports**](#the-core-namespace) | `import "core:fs"` names a built-in unambiguously; a project dependency can never shadow it. |
| [**Struct members**](#private-and-static-members) | `private` and `static` fields and methods, without inheritance, and [`func [symbol.dispose]()`](#symbol-members-of-a-struct) to join a protocol of the language. |
| [**`defer`**](#defer-and-symboldispose) | Runs in reverse order, runs *every* registration even when one fails, and releases native resources through `symbol.dispose`. |
| [**No blocking**](#nothing-blocks) | `fs`, `crypto`, `os.system` and HTTP compression no longer freeze the program. `spawn fs.readFile(...)` really is concurrent. |
| [**One ecosystem**](library/kernel/README.md) | Every library shares one binary type, one resource protocol, one set of permission checks and one validation vocabulary. |
| [**Eleven new libraries**](#built-in-libraries) | `dns`, `tcp`, `tls`, `udp`, `ws`, `archive`, `compress`, `workers`, `binary`, `validation`, `process`. |
| [**`test` is built in**](#-testing) | The framework moved out of `test/lib` into the `test` library, with a `mylang test` command — and `--jobs` to run files in parallel. |
| [**TLS everywhere**](library/tls/README.md) | `tls` for encrypted sockets, and `wss://` in `ws`, both verified by default. |
| [**Nothing is held whole**](library/compress/README.md) | `compress.file`, `compress.stream`, `archive.extractFile` and `process.pipeline` work on data larger than the memory limit. |
| [**Real parallelism**](library/workers/README.md) | `workers.pool` reuses threads instead of creating one per job, and binary can be handed to a thread without copying it. |
| [**A closed sandbox**](#what-the-sandbox-actually-covers) | Symlinks, `import`, worker policies, `os` and buffer memory are all covered; `mylang.lock` pins remote modules. |
| [**Faster**](docs/PERFORMANCE.md) | 20-30% off tight loops, member reads and calls, by removing per-node work that was repeating for no reason. |
| [**A real reference**](#library-reference) | every library documented with worked examples and the exact command line it needs, [with](#permissions-in-practice) and without permissions. |

---

## Contents

| | |
| --- | --- |
| [Overview](#-overview) and what is new in [2.3](#-new-in-v230) and [2.2](#-new-in-v220) | why this exists, and what changed |
| [Core features](#core-features) | the shape of the language in one page |
| [Built-in libraries](#built-in-libraries) | the index, by area |
| [Installation and the command line](#installation--quick-start) | every flag `mylang` takes |
| [Language syntax guide](#language-syntax-guide) | variables, types, control flow, functions, structs, enums, errors, concurrency, modules |
| **[Library reference](#library-reference)** | every library, with examples and the permissions it needs |
| [Permissions and resource limits](#-permissions-and-resource-limits) | the flags, the two modes, what the sandbox covers |
| **[Permissions in practice](#permissions-in-practice)** | the same program three ways, what a refusal looks like, limits that end a program cleanly |
| [Security features](#security-features) and [advanced features](#advanced-features) | the guarantees, and `defer`/`symbol.dispose` in depth |
| [Practical examples](#practical-examples) | whole programs, from a todo list to a sandboxed log collector |
| **[Cookbook](#cookbook)** | thirteen tasks done end to end, each runnable |
| [Testing](#-testing) | the built-in framework and `mylang test` |
| [Formatting](#-formatting) | `mylang prettier` and its settings in `mylang.json` |
| [What changed](#-what-changed) · [Performance](#-performance) · [Keeping the docs honest](#keeping-the-docs-honest) | the changelog, the profiles, the checks |

Every example in this document is run by `npm run check:docs`, so what is written here is
what the interpreter actually does.

---

## Core Features

### **Rich Standard Library**

Comprehensive built-in modules covering common development tasks from I/O operations to network communications.

### **Flexible Variable System**

Advanced support for constants, readonly variables, and optional chaining with intelligent error prevention.

### **Advanced Control Flow**

Sophisticated pattern matching capabilities, iterator support, and comprehensive loop constructs for complex logic handling.

### **Modern Functions**

Contemporary function features including rest parameters, default arguments, and multiple return values for enhanced code expressiveness.

### **Object-Oriented Features**

Well-designed structs with constructors, enums with methods, and proper encapsulation mechanisms
for clean architecture - including [`private` and `static` members](#private-and-static-members),
without inheritance to reason about.

### **Module System**

Flexible import/export capabilities with intelligent caching and remote loading support for
scalable applications. Built-ins can be named unambiguously through the
[`core:` namespace](#the-core-namespace).

### **Error Handling**

Comprehensive try-catch-finally blocks with detailed error information and graceful failure management.

### **Concurrency with spawn/wait**

Clean concurrent execution with intuitive syntax. The interpreter is single-threaded and uses no
`async`/`await`: every `spawn` is a lightweight task (green thread) driven by a cooperative scheduler,
so tasks run concurrently without ever blocking the thread. See [Concurrency model](#concurrency-model).

### **Memory Management**

[`defer`](#defer-and-symboldispose) for automatic cleanup: it runs in reverse order, runs every
registration even when one of them fails, and releases the resources of every built-in library
through `symbol.dispose`.

### **Permissions and limits**

A program declares what it is allowed to touch -
[files, the network, processes, the environment](#-permissions-and-resource-limits) - and may be
given a memory ceiling and a time limit that it cannot catch its way out of.

### **Nothing blocks**

Every library call that waits for the outside world parks its task instead of stopping the
program, so `spawn fs.readFile(...)` really is concurrent. There are no `*Sync` variants to
reach for by mistake.

### **Correct Operator Precedence**

Mathematical and logical expressions now evaluate correctly following standard precedence rules thanks to Pratt parsing algorithm.

---

## Built-in Libraries

Every library has its own README with a method table that says which calls suspend, and
worked examples. Import any of them with the `core:` namespace (`import "core:fs"`) or by
their bare name (`import "fs"`).

### Data and text

| Library | Purpose | Docs |
| --- | --- | --- |
| `strings` | Text: search, split, pad, case, trim | [README](library/strings/README.md) |
| `arrays` | Map, filter, reduce, sort, slice | [README](library/arrays/README.md) |
| `objects` | Pick, omit, merge, group, clone | [README](library/objects/README.md) |
| `collections` | Set, Map, Counter, DefaultDict, OrderedDict | [README](library/collections/README.md) |
| `iter` | Lazy sequences, ranges, zip, chain | [README](library/iter/README.md) |
| `json` | Parse and stringify | [README](library/json/README.md) |
| `bytes` | Binary data — the type every library shares | [README](library/bytes/README.md) |
| **`binary`** | Typed reading and writing over `bytes` | [README](library/binary/README.md) |
| **`validation`** | Check that a value has the shape you expect | [README](library/validation/README.md) |
| `numbers` | Arithmetic, statistics, interpolation, calculus | [README](library/numbers/README.md) |
| `numbers/bigint` | Integers of unlimited size | [README](library/numbers/bigint/README.md) |
| `uuid` | v1, v3, v4, v5 identifiers | [README](library/uuid/README.md) |
| `random` | Random numbers, sampling, distributions | [README](library/random/README.md) |

### Files and the machine

| Library | Purpose | Docs |
| --- | --- | --- |
| `fs` | The file system — every operation non-blocking | [README](library/fs/README.md) |
| `fs/stream` | Files too large to hold in memory | [README](library/fs/stream/README.md) |
| `path` | Paths as text | [README](library/path/README.md) |
| `os` | Platform, memory, users, environment | [README](library/os/README.md) |
| `os/system` | This process: versions, usage, identity | [README](library/os/system/README.md) |
| **`process`** | Run external programs; ask what you may do | [README](library/process/README.md) |
| **`workers`** | Run MyLang code on another thread | [README](library/workers/README.md) |
| **`archive`** | tar and zip, in memory or on disk | [README](library/archive/README.md) |
| **`compress`** | gzip, deflate, brotli | [README](library/compress/README.md) |
| `crypto` | Hashing, HMAC, encryption, keys, signatures | [README](library/crypto/README.md) |

### Network

| Library | Purpose | Docs |
| --- | --- | --- |
| `net/http` | HTTP clients and servers | [README](library/net/http/README.md) |
| `net/url` | Parse, build and resolve URLs | [README](library/net/url/README.md) |
| **`tcp`** | TCP clients and servers, and unix sockets | [README](library/tcp/README.md) |
| **`tls`** | Encrypted TCP, and the certificates behind `wss://` | [README](library/tls/README.md) |
| **`udp`** | Datagram sockets | [README](library/udp/README.md) |
| **`ws`** | WebSocket clients and servers | [README](library/ws/README.md) |
| **`dns`** | Name resolution | [README](library/dns/README.md) |
| `net/socket` | The socket all of these hand back (shared internals) | [README](library/net/socket/README.md) |

### Running things

| Library | Purpose | Docs |
| --- | --- | --- |
| `coreio` | Printing and reading from the console | [README](library/coreio/README.md) |
| `time` | Dates, durations, sleeping, timers | [README](library/time/README.md) |
| `syncbox` | Channels between tasks | [README](library/syncbox/README.md) |
| `events` | Emitters, buses, signals, observables | [README](library/events/README.md) |
| `runtime` | The scheduler that runs tasks | [README](library/runtime/README.md) |
| **`test`** | The built-in test framework | [README](library/test/README.md) |
| `utils` | `typeOf` | [README](library/utils/README.md) |
| `utils/colors` | Terminal colour | [README](library/utils/colors/README.md) |

Libraries in **bold** are new in 2.2. The shared internals every library is built on are
described in [`library/kernel/README.md`](library/kernel/README.md).

### The `core:` namespace

A built-in can always be imported by its bare name, but `core:` is unambiguous: it names
the module that ships with the interpreter, and a project dependency of the same name can
never shadow it.

```mylang2
import "core:fs";                      // binds `fs`
import "core:net/http";                // binds `http` (the last segment)
import "core:net/http" as httpCore;    // or whatever you like
import "core:test" as { describe, test, assert, finish };
import ("core:arrays", "core:path");   // several at once
```

Importing `core:process` binds the name `process` for that file, replacing the predefined
global of the same name. That is deliberate — asking for a module by name is explicit.

### Nothing blocks

Every library call that waits for the outside world — a file, a socket, a child process,
a key derivation — **parks the calling task** and lets every other task keep running. You
never write `wait` in front of such a call; it reads like any other call:

```mylang2
var data = fs.readFile("big.bin");     // the program keeps serving while this runs
```

`wait` goes with `spawn`, which is how you make work overlap:

```mylang2
var a = spawn fs.readFile("a.bin");
var b = spawn fs.readFile("b.bin");

var files = wait.all([a, b]);          // both read at the same time
```

This is why there are no `*Sync` variants: a synchronous read would stop every task in the
program. Each library's README marks, per method, whether it suspends.

---

## Installation & Quick Start

### **Basic Usage**

Create your first MyLang2 program by saving the following code in a file with the `.ml` extension:

```mylang2
import "coreio";

coreio.print("Hello, MyLang2!");
```

This simple example demonstrates the clean import syntax and straightforward function calling convention that characterizes MyLang2.

### **The command line**

```bash
mylang <file>                    # run a file
mylang run <file|script>         # the same, or a script from mylang.json
mylang test [target]             # run *.test.ml files
mylang prettier [paths...]       # format .ml files (also: mylang fmt)
mylang repl                      # an interactive session
mylang init                      # start a project (with formatter settings)
mylang install [package]         # install a dependency
mylang uninstall <package>       # remove one
mylang info                      # what this project is
mylang cache clear               # drop cached execution data
mylang --version
```

`mylang` and `mylang run` accept:

| Flag | Effect |
| --- | --- |
| `--watch [path]` | re-run when files change |
| `--delay <ms>` | how long to wait before re-running (default 1000) |
| `--no-cache` | disable the execution cache |
| `--verbose` | print full error stacks, and the security policy in use |

`mylang`, `mylang run` and `mylang test` all accept the
[permission flags](#-permissions-and-resource-limits):

```bash
mylang run app.ml --allow-read=./data --allow-net=api.example.com --timeout=30s
mylang test --allow-read=. --allow-net=127.0.0.1
```

Every command accepts `--no-colors` (or `--no-color`), before or after the command — see
[turning colour off](#turning-colour-off).

`mylang test` additionally accepts `--filter <text>`, `--bail`, `--verbose` and `--jobs <n>`:

```bash
mylang test --jobs=4             # four test files at a time
mylang test --jobs=auto          # a number chosen for this machine
```

Each file already runs in its own interpreter, so running several at once needs nothing
from the test files themselves. Every file's output is printed as one block rather than
interleaved, so a parallel run reads like a serial one — the files simply appear in the
order they finish. A worker runs under the same policy as the run that started it.

Two things differ on a thread: `os.chdir` is refused, because the working directory belongs
to the process, and `workers.isWorker()` is `true`. A test that depends on being the main
thread can check the second to skip itself. `--bail` stops the files that have not started
yet; files already running finish.

#### Turning colour off

```bash
mylang --no-colors run app.ml
mylang test --no-colors
mylang prettier --check --no-color
```

`--no-colors` turns colour off for the whole run, wherever it would have come from:

| Where | What happens |
| --- | --- |
| the CLI, the test runner, warnings, errors | printed plain |
| `utils/colors`, `coreio.colorize` | return the text unchanged; `colors.enabled()` is `false` |
| the program's own output | colour codes are removed on the way out, even ones built by hand |
| workers and child processes | inherit the switch through `MYLANG_NO_COLORS` and `NO_COLOR` |

The first time a colour function is asked for colour, one warning explains why it returned
plain text — once per run, so a loop that colours every line does not repeat it:

```
ColorsDisabled: colours are turned off (--no-colors): utils/colors.red and every other colour function return plain text [WARN004]
```

`NO_COLOR=1` on its own keeps its usual meaning: the CLI and the test runner stop colouring
their own output, and colour a program asks for explicitly is left to the program.

---

## Language Syntax Guide

### **Interpolated Strings (`$"..."`)**

Interpolated strings let you embed expressions directly inside strings using `${...}`.
Each expression is evaluated at runtime and replaced with its result.

```mylang2
import "coreio";

var name = "World";

var user = {
  greet: func greet(id) {
    coreio.print("User ID:", id);
    return "Guest";
  }
}

coreio.print($"Hello, {name}! Your status: {user.greet(42)}. Sum: {1 + 2}");
```

### **Text blocks**


**Output:**

```
User ID: 42
Hello, World! Your status: Guest. Sum: 3
```

### **Variables and Constants**

MyLang2 provides sophisticated variable declaration and management capabilities:

```mylang2
import "coreio";

// Basic variable declarations with automatic type inference
var username;
var userAge = nil;

coreio.print(username, userAge); // Output: nil, nil

// Assignment operations with various operators
username = "Alice";
userAge = 25;

// Compound assignment operators for efficient updates
userAge -= 5;   // Now 20
userAge += 10;  // Now 30
userAge /= 10;  // Now 3
userAge *= 10;  // Now 30
userAge **= 2;  // Now 900
userAge %= 8;   // Now 4
userAge++;      // Now 5

// `++` and `--` work on a member, an index and a static as well
var stats = { hits: 0, sizes: [10, 20] };

stats.hits++;       // 1
stats.sizes[1]--;   // [10, 19]

// Bitwise operations for advanced manipulation
var a = 6;
a |= 3;      // Now 7

var b = 6;
b &= 3;      // Now 2

var c = 6;
c ^= 3;      // Now 5

// Bit shifting operations
var n = 3;
n <<= 2;      // Now 12

var m = -16;
m >>= 2;      // Now -4

var l = -16;
l >>>= 2;     // Now 1073741820

// Constant declarations for immutable values
var maxConnections = 100 as const;
// maxConnections = 200; // Error: Assignment to constant variable

// Readonly collections allow content modification but prevent reassignment
var shoppingCart = [] as const;
shoppingCart[0] = "laptop"; // Permitted - modifying contents
// shoppingCart = ["phone"]; // Error: Cannot reassign constant variable

var priceList = [99, 199, 299] as readonly;
// priceList[0] = 50; // Error: Cannot modify readonly array

// Multi-variable declarations for efficient initialization
var (
  firstName,
  lastName = "Doe",
  birthYear = 1990 as readonly,
  userId = firstName as const
);

// Lazy operator variable

// The file is not loaded immediately.
// It will only be loaded when `photo` is actually used.
var photo = import("photo.png") as lazy;

// Ask the user what they want to do.
var input = +coreio.input("Photo or text? 1/2");

if (input == 1) {
  // `photo` is used here, so the lazy import is evaluated.
  fs.writeFile("newFile", photo);
} else {
  // `photo` is never used, so "photo.png" is never loaded.
  coreio.print("Hello World");
}
```

### **Optional Chaining**

Optional chaining provides safe property access without runtime errors:

```mylang2
var userProfile = {
  name: "John",
  settings: {
    theme: "dark"
  }
};

// Safe property access prevents errors when properties don't exist
var profilePicture = userProfile?.avatar?.url; // Returns nil safely
var currentTheme = userProfile?.settings?.theme; // Returns "dark"
```

### **Data Types and Operations**

MyLang2 supports comprehensive data manipulation with intuitive operators and **correct precedence**:

```mylang2
import "coreio";

// Arithmetic operations with CORRECT precedence (v2.1.0+)
coreio.print(2 + 3 * 4);        // 14 (not 20!) - multiplication first
coreio.print(10 - 2 * 3);       // 4 (not 24!) - multiplication first
coreio.print(1 + 2 * 3 ** 2);   // 19 - exponentiation, then multiplication, then addition

// Arithmetic and comparison operations
var price = 50;
var discount = 10;

coreio.print(
  "Calculator demonstration:",
  price + discount,     // 60 (addition)
  price - discount,     // 40 (subtraction)
  price * 2,           // 100 (multiplication)
  price / 2,           // 25 (division)
  price % 7,           // 1 (modulo)
  price == 50,         // true (equality)
  price != discount,   // true (inequality)
  { userId: 123 } == { userId: 123 }, // true (deep comparison)
  price > discount,    // true (greater than)
  price < 100,         // true (less than)
  price >= 50,         // true (greater than or equal)
  price <= 60,         // true (less than or equal)
  6 ^ 3,               // 5 (bitwise XOR)
  3 << 2,              // 12 (left bit shift)
  -16 >> 2,            // -4 (right bit shift)
  -16 >>> 2,           // 1073741820 (unsigned right shift)
  5 & 3,               // 1 (bitwise AND)
  true && "hello",     // "hello" (logical AND)
  5 | 3,               // 7 (bitwise OR)
  false || "default"   // "default" (logical OR)
);

// Unary operators for type conversion and negation
coreio.print(
  "Type conversion examples:",
  !true,        // false (logical NOT)
  !false,       // true (logical NOT)
  +"123",       // 123 (string to number conversion)
  -"456"        // -456 (string to negative number conversion)
);

// Reflector operator (typeof)
import "numbers";

enum TypeOfStatus {}

struct TypeOfAction {}

function typeOfFunc() {}

var typeOfErr = nil;

try {
  throw "Error";
} catch(err) {
  typeOfErr = err;
}

coreio.print(
  typeof TypeOfStatus, // enum
  typeof TypeOfAction, // struct,
  typeof struct Action {}, // struct
  typeof typeOfFunc, // func
  typeof func() {}, // func
  typeof true, // boolean
  typeof nil, // nil
  typeof {}, // object
  typeof [], // array
  typeof 124, // int
  typeof 1.5, // float (note: 123.0 is the same number as 123, so it is an int)
  typeof 123n, // bigint
  typeof "string", // string
  typeof typeOfErr, // error
  typeof symbol.iterator, // symbol
);
```

### **Operator Precedence Guide**

MyLang2 follows standard mathematical operator precedence (v2.1.0+):

```mylang2
// Precedence from highest to lowest:
// 1. Exponentiation (**)
// 2. Multiplication (*), Division (/), Modulo (%)
// 3. Addition (+), Subtraction (-)
// 4. Bitwise shifts (<<, >>, >>>)
// 5. Comparison (<, >, <=, >=)
// 6. Equality (==, !=)
// 7. Bitwise AND (&)
// 8. Bitwise XOR (^)
// 9. Bitwise OR (|)
// 10. Logical AND (&&)
// 11. Logical OR (||)
// 12. Ternary (?:)
// 13. Assignment (=, +=, -=, etc.)

// Examples:
var a = 2 + 3 * 4;           // 14 (multiplication first)
var b = 10 - 2 * 3;          // 4 (multiplication first)
var c = 2 ** 3 + 1;          // 9 (exponentiation first)
var d = (5 + 3) * 2 - 4 / 2; // 14 (parentheses override precedence)
```

### **Arrays and Objects**

Collections with intuitive syntax and powerful manipulation capabilities:

```mylang2
import "coreio";

// Arrays with proper expression parsing (v2.1.0+)
var numbers = [1 + 1, 2 * 2, 3 ** 2]; // [2, 4, 9] - expressions work correctly!
var mixed = ["text", 42, true, nil, [1, 2, 3]];

// Array access and modification
coreio.print(numbers[0]);    // 2
numbers[1] = 100;

// Array destructuring
var [first, second, ...rest] = numbers;

// Objects with method shorthand
var calculator = {
  value: 0,
  add: func(n) {
    this.value += n;
    return this;
  },
  multiply: func(n) {
    this.value *= n;
    return this;
  },
  // Property shorthand
  result() {
    return this.value;
  }
};

// Method chaining
calculator.add(5).multiply(2); // value = 10

// Object destructuring
var { value, add } = calculator;

// Computed property names
var key = "dynamicKey";
var obj = {
  [key]: "value",
  [1 + 2]: "computed"
};
```

### **Control Flow**

#### **Conditional Statements**

```mylang2
import "coreio";

var score = 85;

// If-else with proper expression parsing (v2.1.0+)
if (score >= 90 && score <= 100) {
  coreio.print("Grade: A");
} else if (score >= 80 && score < 90) {
  coreio.print("Grade: B");
} else if (score >= 70) {
  coreio.print("Grade: C");
} else {
  coreio.print("Grade: F");
}

// Ternary operator - NOW WORKS CORRECTLY! (v2.1.0+)
var grade = score >= 90 ? "A" : score >= 80 ? "B" : "C";

// Complex ternary expressions
var y = 5;
var x = 10;
var b = 3;
var result = y > 2 ? x * 2 : 4 + b; // 20 - full expressions work!

// Ternary in arrays
var arr = [1, 2, x > 5 ? 100 : 200]; // [1, 2, 100] - correct evaluation!
```

#### **Match Statement (Pattern Matching)**

```mylang2
import "coreio";

var value = 42;

match (value * 2) { // Expressions work correctly in match (v2.1.0+)
  case 42: {
    coreio.print("The answer");
  }
  case 84: {
    coreio.print("Double the answer");
  }
  default: {
    coreio.print("Something else");
  }
}

// Match with complex patterns
match (user.role) {
  case "admin": {
    grantFullAccess();
  }
  case "moderator": {
    grantModeratorAccess();
  }
  case "user": {
    grantUserAccess();
  }
  default: {
    denyAccess();
  }
}

var object = {
  admin: true,
  moderator: true,
  user: true,
}

// Match wint object value
match (object) {
 case (.admin): {
    grantFullAccess();
  }
  case (.moderator): {
    grantModeratorAccess();
  }
  case (.user): {
    grantUserAccess();
  }
  default: {
    denyAccess();
  }
}
```

#### **Loops**

```mylang2
import "coreio";

// For loop with break/continue - NOW WORKS! (v2.1.0+)
for (var i = 0; i < 10; i++) {
  if (i == 5) {
    break; // No longer causes infinite loop!
  }
  if (i % 2 == 0) {
    continue; // Works correctly!
  }
  coreio.print(i);
}

// While loop
var counter = 0;
while (counter < 5) {
  coreio.print(counter);
  counter++;
}

// For-in loop (iteration)
var items = [10, 20, 30];
for (var item in items) {
  coreio.print(item);
}

// For-in with objects
var person = { name: "Alice", age: 30 };
for (var key in person) {
  coreio.print(key, person[key]);
}
```

### **Functions**

MyLang2 offers flexible function definitions with modern features:

```mylang2
import "coreio";

// Basic function declaration
func greet(name) {
  return $"Hello, {name}!";
}

// Function with default parameters
func createUser(name, age = 18, role = "user") {
  return { name: name, age: age, role: role };
}

// Function with rest parameters
func sum(...numbers) {
  var total = 0;
  for (var num in numbers) {
    total += num;
  }
  return total;
}

coreio.print(sum(1, 2, 3, 4, 5)); // 15

// Multiple return values
func getUserInfo() {
  return ("Alice", 30, "admin");
}

var (username, age, role) = getUserInfo();

// Higher-order functions
func applyOperation(a, b, operation) {
  return operation(a, b);
}

var result = applyOperation(10, 5, func(x, y) {
  return x + y;
});

// Arrow-like anonymous functions
var multiply = func(a, b) {
  return a * b;
};

// Return with full expressions (v2.1.0+)
func calculate(x, y) {
  return x * 2 + y * 3; // Full expression returned correctly!
}
```

### **Structs (Classes)**

Structs provide object-oriented programming capabilities with optional constructors:

```mylang2
import "coreio";

// Struct with constructor
struct User {
  var name;
  var email;
  var age;

  // Constructor (optional but recommended)
  func init(name, email, age = 18) {
    this.name = name;
    this.email = email;
    this.age = age;
  }

  // Method
  func greet() {
    return $"Hello, I'm {this.name}!";
  }

  // Method with logic
  func isAdult() {
    return this.age >= 18;
  }
}

// Creating instance with constructor
var user1 = User("Alice", "alice@example.com", 25);
coreio.print(user1.greet()); // "Hello, I'm Alice!"
coreio.print(user1.isAdult()); // true

// Struct without constructor (direct field assignment)
struct Point {
  var x;
  var y;

  func distance() {
    return (this.x ** 2 + this.y ** 2) ** 0.5;
  }
}

var point = Point();
point.x = 3;
point.y = 4;
coreio.print(point.distance()); // 5

// Struct with complex initialization
struct BankAccount {
  var accountNumber;
  var balance;
  var owner;

  func init(owner, initialDeposit = 0) {
    this.accountNumber = generateAccountNumber();
    this.balance = initialDeposit;
    this.owner = owner;
  }

  func deposit(amount) {
    if (amount > 0) {
      this.balance += amount;
      return true;
    }
    return false;
  }

  func withdraw(amount) {
    if (amount > 0 && amount <= this.balance) {
      this.balance -= amount;
      return true;
    }
    return false;
  }

  func getBalance() {
    return this.balance;
  }
}

var account = BankAccount("John Doe", 1000);
account.deposit(500);
account.withdraw(200);
coreio.print(account.getBalance()); // 1300
```

#### **private and static members**

A struct member can be marked `private` or `static`, in either order. There is no
inheritance, so visibility is a flat question:

- **`private`** — the member exists only for code running inside a method of the same
  struct. From outside it cannot be read, written, called, found with `in`, or seen when
  iterating.
- **`static`** — the member belongs to the *type*, not to an instance. It is created once,
  when the `struct` declaration is evaluated, and is reached through the type name.

```mylang2
import "coreio";

struct Counter {
  static var created = 0;     // one value, shared by every instance
  private var count;          // internal state
  var label;                  // ordinary public field

  func init(label) {
    this.label = label;
    this.count = 0;
    Counter.created += 1;     // statics are reached through the type
  }

  private func step(by) {     // only this struct may call it
    this.count += by;
    return this.count;
  }

  func increment() { return this.step(1); }

  func value() { return this.count; }

  static func total() { return Counter.created; }
}

var a = Counter("first");
var b = Counter("second");

coreio.print(a.increment());     // 1
coreio.print(a.increment());     // 2
coreio.print(b.value());         // 0 - separate state
coreio.print(Counter.total());   // 2

coreio.print(a.label);           // first
coreio.print(a.count);           // error: cannot read private member 'count'
coreio.print(a.step(1));         // error: cannot call private member 'step'
coreio.print("count" in a);      // false - it is not there, as far as outside code goes
coreio.print("created" in a);    // false - statics live on the type, not the instance
```

`private` and `static` are **contextual**: they only act as modifiers directly inside a
struct body, and remain ordinary identifiers everywhere else.

```mylang2
var private = 1;                 // still perfectly valid
var obj = { static: "fine" };
```

A struct *expression* supports the same modifiers:

```mylang2
var Point = struct {
  static var origin = "0,0";
  private var squared;
  var x;

  func init(x) { this.x = x; this.squared = x * x; }
  func area() { return this.squared; }
};
```

### **Enums**

Enumerations with associated methods and values:

```mylang2
import "coreio";

// Basic enum
enum Status {
  Pending,
  Active,
  Completed,
  Failed
}

var currentStatus = Status.Active;

// Enum with custom values
enum HttpStatus {
  Ok = 200,
  Created = 201,
  BadRequest = 400,
  Unauthorized = 401,
  NotFound = 404,
  ServerError = 500
}

// Enum with methods
enum Color {
  Red,
  Green,
  Blue,

  func toHex() {
    match (this) {
      case Color.Red: return "#FF0000";
      case Color.Green: return "#00FF00";
      case Color.Blue: return "#0000FF";
    }
  }
}

var favoriteColor = Color.Blue;
coreio.print(favoriteColor.toHex()); // "#0000FF"

// Enum in match statement
match (currentStatus) {
  case Status.Pending: {
    coreio.print("Waiting...");
  }
  case Status.Active: {
    coreio.print("In progress");
  }
  case Status.Completed: {
    coreio.print("Done!");
  }
  case Status.Failed: {
    coreio.print("Error occurred");
  }
}
```

### **Error Handling**

Comprehensive try-catch-finally blocks with detailed error information:

```mylang2
import "coreio";
import "strings";
import "fs";

// Basic error handling
func readConfig(filename) {
  try {
    var content = fs.readFile(filename, "utf8");
    return content;
  } catch(error) {
    coreio.print("Error reading file:", error);
    return nil;
  } finally {
    coreio.print("File operation completed");
  }
}

// Error expression
var readConfig = try fs.readFile("path", "utf8") else {
  coreio.print("Error reading file:", this.error);
  return nil;
}

var readConfig = try fs.readFile("path", "utf8") catch(error) {
  coreio.print("Error reading file:", error);
  return nil;
}

// finally not used


// Throwing errors
func validateAge(age) {
  if (age < 0) {
    throw "Age cannot be negative" as {
      name: "ValidatedError",
      code: 409,
      cause: { age },
    };
  }
  if (age > 150) {
    throw "Age seems unrealistic" as {
      name: "ValidatedError",
      code: 409,
      cause: { age },
    }
  }
  return true;
}

struct ValidatedError {
  var code = 409;
  var cause = { "name": "unknown error" };
  var name = "ValidatedError";
}

func validateName(name) {
  if (typeof(name) != "string") {
    throw "Name must be a string" as ValidatedError(400, { name });
  }

  if (!strings.trim(name)) {
    throw "Name cannot be empty" as ValidatedError;
  }

  if (length(name) > 64) {
    throw "Name is too long" as {
      name: "ValidatedError",
      code: 409,
      cause: { name },
    };
  }

  return true;
}

// Nested error handling
func processData(data) {
  try {
    try {
      validateAge(data.age);
    } catch(validationError) {
      coreio.print("Validation failed:", validationError);
      throw "Data processing aborted";
    }
  } catch(error) {
    coreio.print("Processing error:", error);
    return nil;
  }
}

// Error with full expressions (v2.1.0+)
try {
  var result = riskyOperation();
  throw "Failed with value: " + result * 2; // Full expression works!
} catch(err) {
  coreio.print(err);
}
```

### **Concurrency model**

The interpreter itself is plain, single-threaded code (no `async`/`await`, no Promises). `spawn` and
`wait` behave like asynchronous calls, but are implemented as cooperative multitasking:

- **`spawn` starts a task immediately** and runs it until it first has to wait (like calling an async
  function), then the caller continues. It returns a handle (`done`, `result`, `error`, `status`,
  `elapsed`, `cancel()`, `isCancelled()`, `isFinished()`, `output(onValue, onError)`).
- **`wait handle` suspends only the calling task.** Every other task keeps running; sleeping
  (`time.Sleep`), channels (`syncbox`), and network I/O never block the thread either.
- **A `spawn` of an expression carries its value; a `spawn { ... }` block needs `return`.**
  `spawn give(4)` puts `give`'s answer in `result`. A block does **not** hand back its last
  expression: `spawn { give(4) }` finishes with `result` of `nil`, and
  `spawn { return give(4); }` is the form that carries the value. A block without a `return`
  is for the side effects.
- **Tasks are preempted.** A task that runs a long CPU-bound loop is switched out every few hundred
  statements, so spawned loops really interleave instead of one starving the rest.
- **Each task has its own execution state** (call stack, `return`/`break`/`continue` flags), so
  concurrent tasks can never corrupt each other.
- **Failures are isolated.** An error in a spawned task is stored in its handle (`status` is
  `"rejected"`, `error` holds the error) and never crashes the spawner. An error in the main program
  is reported while background tasks keep running.
- **`cancel()` is real.** The task stops at its next suspension point and unwinds, running every
  pending `defer` from the innermost call outwards.
- **Deadlocks are reported.** If every task is blocked and nothing can wake them, the run fails with a
  `Deadlock` error instead of the process silently exiting.
- **Recursion depth is limited by memory, not by the JavaScript call stack.**

`wait.all`, `wait.race`, `wait.any`, `wait.allSettled`, `runtime.Scheduler(n)` (a pool that runs at most
`n` jobs at once; its methods return waitable task handles), `runtime.Spawn(fn)` (create now,
`run()` later), `time.Delay`, `time.Interval`, `time.Timeout` and the `syncbox` channels are all
built on the same scheduler.

Internals (`src/runtime/`): `coroutine.ts` (generators + `park`/`tick` signals), `Trampoline.ts`
(heap-allocated call stack of coroutines), `Scheduler.ts` (run queue, timers, preemption, cancellation),
`Spawn.ts` (a task), `TaskPool.ts` (limited pool), `TaskContext.ts` (per-task state).
Interpreter code calls other coroutines with `yield`, never `yield*`.

For embedders: `run(code, options)` still returns a Promise, because it has to hand control back to
the Node.js event loop; `new Interpreter(...).start(callback)` is the callback form.

### **Concurrency**

Asynchronous programming with spawn and wait:

```mylang2
import "coreio";
import "time";

// Spawn asynchronous task
func fetchData(url) {
  return spawn {
    time.Sleep(1000); // Simulate delay
    return $"Data from {url}";
  };
}

// Wait for result
var promise = fetchData("https://api.example.com");
var data = wait promise; // wait returns the settled task: { done, result, error, status, elapsed }
coreio.print(data.result);

// Multiple concurrent operations
func parallelFetch() {
  var promise1 = spawn { return "Task 1 completed"; };
  var promise2 = spawn { return "Task 2 completed"; };
  var promise3 = spawn { return "Task 3 completed"; };

  var result1 = wait promise1;
  var result2 = wait promise2;
  var result3 = wait promise3;

  coreio.print(result1.result, result2.result, result3.result);
}

// Async function pattern
func asyncCalculation() {
  return spawn {
    var result = 0;
    for (var i = 0; i < 1000; i++) {
      result += i;
    }
    return result;
  };
}

var calculationPromise = asyncCalculation();
coreio.print("Calculating...");
var finalResult = wait calculationPromise;
coreio.print("Result:", finalResult.result);
```

### **Module System**

#### **Importing Modules**

```mylang2
import "coreio";

// Single import
import "fs";

// Multiple imports
import (
  "strings",
  "arrays",
  "objects"
);

// Imports destructuring
import "coreio" as { print, input };

// Named imports with aliases
import (
  utilName: "./utils.ml"
);

// Relative imports
import "./utils/helpers.ml";
import "../config.ml";

// Remote import from URL
import "https://example.com/library.ml";

// Import metadata and utilities
coreio.print(import.base);    // Main directory path
coreio.print(import.main);    // Main file path
coreio.print(import.cache);   // Import cache information
coreio.print(import.paths);   // All imported paths

// Import path resolution
coreio.print(import.resolve("./file.ml"));

// Import with type specification
coreio.print(import.as("data.txt", "json"));
coreio.print(import.as("binary.dat", "buffer"));
```

### **Exporting from Modules**

```mylang2
// math.ml - Example module with exports
func add(a, b) {
  return a + b;
}

func subtract(a, b) {
  return a - b;
}

var PI = 3.14159;

// Export specified functions and variables
export(add, subtract, PI);
```

### **Creating Custom Extensions**

MyLang2 allows extending the language with JavaScript for enhanced functionality:

```javascript
// index.js - JavaScript extension
import { FunctionBuilder } from "mylang2";

abstract class CoreIOMethodBuilder extends FunctionBuilder {
  constructor(args, astArgs, environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return {
      name: "custom",
      path: __dirname,
    };
  }

  call() {
    throw new Error("Call is not implemented");
  }
}

class Print extends CoreIOMethodBuilder {
  override call() {
    console.log(...this.args);
  }
}

module.exports = { print: Print };
```

```mylang2
// index.ml - Using the custom extension
import "./index.js";

index.print("Hello from custom function!");
```

### **Create global functions**
#### **mylang.json**
```json
{
  "main": "index.ml",
  "initScript": "initFunction.js",
  "devDependencies": {
    "console": "Sempai-07/console"
  },
  "dependencies": {
    "console": "Sempai-07:console"
  }
}
```

### **initFunction.js**
```javascript
const { FunctionBuilder } = require("mylang2");

class CoreIOMethodBuilder extends FunctionBuilder {
  constructor(args, astArgs, environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return {
      name: "custom",
      path: __dirname,
    };
  }

  call() {
    throw new Error("Call is not implemented");
  }
}

class Print extends CoreIOMethodBuilder {
  call() {
    console.log(...this.args);
  }
}

module.exports.init = { print: Print };
```

---

## Library reference

The tables above are an index; this is the reference. Each library gets what it is for, the
calls you will actually reach for, a worked example, and — where it touches the outside
world — the command line that lets it.

A library that only works on values you already have needs **no permissions at all**:
`strings`, `arrays`, `objects`, `collections`, `iter`, `json`, `bytes`, `binary`,
`validation`, `numbers`, `uuid`, `random`, `path`, `utils` and `syncbox` never ask for a
flag, because there is nothing outside the program for them to reach.

---

### Data and text

#### `strings` — text

```mylang2
import "core:strings";
```

Search (`includes`, `indexOf`, `lastIndexOf`, `startsWith`, `endsWith`, `count`), change
(`replace`, `replaceAll`, `insert`, `remove`, `slice`, `substring`), shape (`padStart`,
`padEnd`, `trim`, `trimStart`, `trimEnd`, `truncate`, `repeat`, `reverse`), case
(`toLowerCase`, `toUpperCase`, `toTitleCase`, `capitalize`), split (`split`, `lines`,
`words`, `join`), and `wrapWith` / `wrapBetween` for surrounding text.

```mylang2
import "core:coreio";
import "core:strings";

var title = "  the long and winding road  ";

coreio.print(strings.toTitleCase(strings.trim(title)));
coreio.print(strings.truncate("a sentence that will not fit", 12));
coreio.print(strings.padStart("7", 3, "0"));
coreio.print(strings.words("one two  three"));
coreio.print(strings.count("banana", "an"));
```

```
The Long And Winding Road
a sentence…
007
[one, two, three]
2
```

There are no regular expressions in this language. `split`, `includes`, `indexOf`,
`replaceAll` and `count` take plain text, which covers most of what a pattern is reached
for, and a loop over `lines` covers the rest.

#### `arrays` — lists

```mylang2
import "core:arrays";
```

The whole set: `map`, `filter`, `reduce`, `reduceRight`, `find`, `findIndex`, `findLast`,
`some`, `every`, `sort`, `reverse`, `slice`, `concat`, `flat`, `flatMap`, `includes`,
`indexOf`, `join`, `keys`, `values`, `entries`, `at`, and the mutating `push`, `pop`,
`shift`, `unshift`, `splice`. The non-mutating pairs are `toReversed`, `toSorted`,
`toSpliced` and `with`.

```mylang2
import "core:coreio";
import "core:arrays";

var sales = [
  { region: "north", amount: 120 },
  { region: "south", amount: 80 },
  { region: "north", amount: 60 }
];

var north = arrays.filter(sales, func(row) { return row.region == "north"; });
var total = arrays.reduce(north, func(sum, row) { return sum + row.amount; }, 0);

coreio.print("north:", arrays.map(north, func(r) { return r.amount; }), "total:", total);
coreio.print("biggest first:", arrays.toSorted(sales, func(a, b) { return b.amount - a.amount; })[0]);
```

A callback runs as ordinary code, so it can suspend: `arrays.map` over a list of paths may
read every file, and the task parks for each read while other tasks keep running.

#### `objects` — records

```mylang2
import "core:objects";
```

`keys`, `values`, `entries`, `fromEntries`, `pick` and `omit` (whose keys are separate
arguments, not a list), `merge`, `defaults`,
`mapValues`, `mapKeys`, `invert`, `groupBy`, `filter`, `find`, `findKey`, `compact`,
`deepClone`, `shallowClone`, `assign`, `transform`, and the predicates `every`, `some`,
`is`, `hasOwnProperty`.

```mylang2
import "core:coreio";
import "core:objects";

var user = { id: 7, name: "Ada", password: "secret", role: "admin" };

coreio.print(objects.omit(user, "password"));
coreio.print(objects.pick(user, "id", "name"));

var config = objects.defaults({ port: 8080 }, { port: 3000, host: "0.0.0.0" });

coreio.print(config);

// groupBy takes an object and groups its values
var scores = { ada: 91, alan: 64, barbara: 88 };

coreio.print(objects.groupBy(scores, func(s) { return s >= 80 ? "high" : "low"; }));
```

`deepClone` copies nested structures; `shallowClone` copies one level, which is what you
want when the nested values are meant to stay shared.

`groupBy` here groups an object's values. To group a **list**, fold it — what the groups
should hold differs every time, so there is no single call for it:

```mylang2
import "core:coreio";
import "core:arrays";
import "core:objects";

var people = [{ city: "Kyiv", n: "A" }, { city: "Lviv", n: "B" }, { city: "Kyiv", n: "C" }];

var byCity = arrays.reduce(people, func(acc, person) {
  // reading a key an object does not have is an error, so ask first
  if (!objects.hasOwnProperty(acc, person.city)) { acc[person.city] = []; }

  acc[person.city] = arrays.concat(acc[person.city], [person.n]);

  return acc;
}, {});

coreio.print(byCity);
```

#### `collections` — Set, Map, Counter, DefaultDict, OrderedDict

```mylang2
import "core:collections";
```

```mylang2
import "core:coreio";
import "core:collections";
import "core:strings";
import "core:arrays";

var seen = collections.Set();

seen.add("a");
seen.add("b");
seen.add("a");

coreio.print("size:", seen.size(), "has b:", seen.has("b"));

var counts = collections.Counter(["to", "be", "or", "not", "to", "be"]);

coreio.print("most common:", counts.mostCommon(2), "total:", counts.total());

counts.update(["be"]);

coreio.print("how many 'be':", counts.get("be"));

var byLetter = collections.DefaultDict(func() { return []; });

for (var name in ["ada", "alan", "barbara"]) {
  var first = strings.at(name, 0);

  byLetter.set(first, arrays.concat(byLetter.get(first), [name]));
}

coreio.print(byLetter.get("a"));
```

A `Map` here takes any value as a key, not only text — an object or an array works, matched
by identity.

#### `iter` — lazy sequences

```mylang2
import "core:iter";
```

`range`, `enumerate`, `zip`, `zipLongest`, `chain`, `count`, `cycle`, `repeat`,
`takeWhile`, `dropWhile`, `filterFalse`, `compress`, `groupBy`, `accumulate`, `pairwise`,
`flatten`, `map`, `filter`, `take`, `skip`, `toArray`, `forEach`.

Every one of them takes the sequence as its first argument — `iter.take(iter.count(), 3)` —
and accepts any iterable: an array, a string, an object, an iterator from `iter`, or a value
that implements `symbol.iterator` (including a struct that declares it).

Nothing is computed until something asks for the next value, which is what makes an endless
sequence usable:

```mylang2
import "core:coreio";
import "core:iter";

for (var n in iter.range(0, 10, 2)) { coreio.print(n); }

for (var pair in iter.enumerate(["a", "b", "c"])) {
  coreio.print(pair.index, pair.value);
}

for (var n in iter.takeWhile(iter.count(1), func(n) { return n <= 5; })) {
  coreio.print("counted:", n);
}

// every one of these hands back a lazy sequence, so walk it rather than printing it:
// printing shows the iterator, not its contents
for (var n in iter.flatten([[1, 2], [3], [4, 5]])) { coreio.print("flat:", n); }
```

`iter.count(1)` counts up for ever; `takeWhile` stops it. Writing that with an array would
not finish. The same, built from the general functions:

```mylang2
import "core:coreio";
import "core:iter";

var odd = iter.filter(iter.count(1), func(n) { return n % 2 == 1; });
var squares = iter.map(odd, func(n) { return n * n; });

coreio.print(iter.toArray(iter.take(squares, 4)));   // [1, 9, 25, 49]
```

#### `json` — parse and stringify

```mylang2
import "core:json";
```

```mylang2
import "core:coreio";
import "core:json";

var text = json.stringify({ name: "Ada", tags: ["math", "engines"] }, 2);

coreio.print(text);

var back = json.parse(text);

coreio.print(back.tags[0]);
```

`stringify(value, indent)` without an indent produces one line. `parse` on malformed input
raises an error naming the position, so wrap it in `try` when the text came from outside.

#### `bytes` — binary data

```mylang2
import "core:bytes";
```

This is the type every library shares. `fs.readFile`, `socket.read`, `compress.gzip`,
`crypto.randomBytes` and the rest all hand back one of these, and all of them accept one.

| Call | Description |
| --- | --- |
| `bytes.Bytes(value, encoding)` | from text or a list of numbers |
| `bytes.alloc(size, fill)` | a block of a given size |
| `bytes.byteLength(text, encoding)` | how many bytes some text would take |
| `bytes.concat(list)` | join several |
| `bytes.compare(a, b)` / `bytes.equal(a, b)` | order and equality |
| `bytes.is(value)` | is this binary? |
| `bytes.trim` / `trimLeft` / `trimRight` | strip padding |

A value has `.length`, `.get(i)`, `.toString(encoding)`, `.slice(a, b)` and the rest; its
README has the full list.

```mylang2
import "core:coreio";
import "core:bytes";

var hello = bytes.Bytes("hello");

coreio.print(hello.length, hello.get(0), hello.toString("hex"));
coreio.print(length(hello));                        // the global works too

var block = bytes.alloc(4, 255);

coreio.print(block.toString("hex"));
coreio.print(bytes.equal(bytes.Bytes("a"), bytes.Bytes("a")));
```

`length(value)` on binary is the number of bytes, the same as `.length`.

#### `binary` — typed reading and writing

```mylang2
import "core:binary";
```

`bytes` holds the data; `binary` gives it structure. A reader walks forward through a
buffer; a writer builds one. That is what a file header or a wire protocol needs.

| Call | Description |
| --- | --- |
| `binary.reader(data, endian)` | read values in order; `"le"` or `"be"` |
| `binary.writer(endian)` | build a buffer; every write returns it, so calls chain |
| `binary.sizeOf(value)` | how many bytes a value takes |
| `binary.concat(list)` | join buffers |
| `binary.hex(data)` / `binary.fromHex(text)` | to and from hex text |

```mylang2
import "core:coreio";
import "core:binary";

var w = binary.writer();

w.u16(1);                          // a version
w.u32(4096);                       // a length
w.string("payload");

var packet = w.build();

var r = binary.reader(packet);

coreio.print("version:", r.u16());
coreio.print("length:", r.u32());
coreio.print("payload:", r.string(7));
coreio.print("as hex:", binary.hex(packet));
```

Reading a framed protocol off a socket is this plus `readExactly`: read the fixed header,
decode the length from it, then read exactly that many bytes.

#### `validation` — check a value's shape

```mylang2
import "core:validation" as v;
```

A schema built from `v.string`, `v.number`, `v.integer`, `v.boolean`, `v.array`,
`v.object`, `v.enumOf`, `v.any` and `v.custom`, then `v.check(schema, value)` for a report
or `v.parse(schema, value)` to get the value or an error.

```mylang2
import "core:coreio";
import "core:validation" as v;

var newUser = v.object({
  name: v.string({ min: 1, max: 60 }),
  age: v.integer({ min: 0, max: 130 }),
  role: v.enumOf(["admin", "user"]),
  tags: v.array(v.string(), { max: 10 })
});

var result = v.check(newUser, { name: "Ada", age: 36, role: "admin", tags: ["math"] });

coreio.print("valid:", result.valid);

var bad = v.check(newUser, { name: "", age: 200, role: "root", tags: [] });

coreio.print("errors:", bad.errors);
coreio.print("is it valid at all:", v.isValid(newUser, { name: "x", age: 1, role: "user", tags: [] }));
```

This is what a request body goes through before anything else looks at it, which is why the
`net/http` server example reaches for it.

#### `numbers` — arithmetic and statistics

```mylang2
import "core:numbers";
```

Arithmetic and rounding, `gcd`/`lcm`/`isPrime`/`primeFactors`/`factorial`/`fibonacci`,
trigonometry, logarithms, and a full statistics set: `mean`, `median`, `mode`, `variance`,
`std`, `quantile`, `percentile`, `iqr`, `covariance`, `correlation`, `zscore`, `skewness`,
`kurtosis`, `harmonicMean`, `geometricMean`, `trimmedMean`. Array helpers (`linspace`,
`arange`, `cumsum`, `diff`, `gradient`, `unique`, `argmax`, `clip`, `reshape`) and
numerical methods (`linearInterp`, `splineInterp`, `polynomialFit`, `derivative`,
`integral`, `trapezoidalRule`, `simpsonsRule`, `bisection`, `newtonRaphson`).

```mylang2
import "core:coreio";
import "core:numbers";

var samples = [12, 15, 11, 19, 14, 13, 40];

coreio.print("mean:", numbers.mean(samples));
coreio.print("median:", numbers.median(samples));
coreio.print("std:", numbers.std(samples));
coreio.print("p90:", numbers.percentile(samples, 90));
coreio.print("without the outlier:", numbers.trimmedMean(samples, 0.15));
coreio.print("primes under 20:", numbers.primeFactors(18));
coreio.print("PI:", numbers.PI);
```

#### `numbers/bigint` — integers of unlimited size

```mylang2
import "core:numbers/bigint" as big;
```

Everything arithmetic, bitwise, and number-theoretic: `add` through `power`, `modPow`,
`modInverse`, `isPrime`, `nextPrime`, `factorial`, `gcd`, `lcm`, `fibonacci`, `sqrt`,
`binomial`, conversions to and from text, hex, binary and `bytes`.

```mylang2
import "core:coreio";
import "core:numbers/bigint" as big;

var huge = big.factorial(40);

coreio.print(big.toString(huge));
coreio.print("bits:", big.bitLength(huge));
coreio.print("2^521 - 1 prime?", big.isPrime(big.subtract(big.power(2, 521), 1)));
```

#### `uuid` — identifiers

```mylang2
import "core:uuid";
```

```mylang2
import "core:coreio";
import "core:uuid";

coreio.print(uuid.v4());
coreio.print(uuid.v5(uuid.namespaceURL(), "https://example.com/page/about"));
coreio.print("valid:", uuid.isValid("not-a-uuid"));
coreio.print(uuid.batch(3));
```

`v4` is random and what you want by default. `v5` is derived from a name, so the same name
always gives the same identifier — useful for an id you must be able to recompute.

#### `random` — random numbers and sampling

```mylang2
import "core:random";
```

```mylang2
import "core:coreio";
import "core:random";

random.seed(42);                   // reproducible, for a test

coreio.print(random.randint(1, 6));
coreio.print(random.choice(["rock", "paper", "scissors"]));
coreio.print(random.sample([1, 2, 3, 4, 5, 6, 7, 8], 3));
coreio.print(random.shuffle(["a", "b", "c"]));
coreio.print(random.gauss(0, 1));
```

Seeding makes a run repeatable, which is what a test wants. For anything that protects
something — a token, a password, a key — use `crypto.randomBytes` or
`crypto.randomPassword` instead: these are not meant to be unguessable.

---

### Files and the machine

From here on the libraries reach outside the program, so each one shows both forms: the
program, and the command line that lets it do what it does.

#### `fs` — the file system

```mylang2
import "core:fs";
```

Every call is non-blocking: the task parks and the rest of the program keeps running. There
are no `*Sync` variants, because a synchronous read would stop every task at once.

| Call | Needs | Description |
| --- | --- | --- |
| `fs.readFile(path, encoding)` | read | the whole file; `bytes` unless an encoding is given |
| `fs.writeFile(path, data)` | write | replace a file |
| `fs.appendFile(path, data)` | write | add to the end |
| `fs.readdir(path)` | read | the names in a directory |
| `fs.stat(path)` / `fs.lstat(path)` | read | size, times, kind |
| `fs.exists(path)` | read | is it there? |
| `fs.makedir(path, recursive)` / `fs.removedir(path)` | write | directories |
| `fs.unlink(path)` / `fs.rename(a, b)` / `fs.copyFile(a, b)` | write | move things about |
| `fs.file(path, mode)` | read/write | an open handle, for working in pieces |
| `fs.Watcher(path, fn)` / `fs.WatchFile(path, fn)` | read | react to changes |
| `fs.FSUtils()` | read/write | `ensureDir`, `removeDir`, `copyDir`, `emptyDir` and friends |

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:os";

var dir = path.join(os.tmpdir(), "mylang-fs-demo");

fs.FSUtils().ensureDir(dir);

var file = path.join(dir, "notes.txt");

fs.writeFile(file, "first line\n");
fs.appendFile(file, "second line\n");

coreio.print(fs.readFile(file).toString());
coreio.print("size:", fs.stat(file).size());
coreio.print("names here:", fs.readdir(dir));

fs.FSUtils().removeDir(dir);
```

Unrestricted, that runs as it stands:

```bash
mylang run notes.ml
```

Scoped to the one directory it touches:

```bash
mylang run notes.ml --allow-read=/tmp --allow-write=/tmp
```

With write taken away, the first write is refused by name, and nothing is half-done:

```bash
mylang run notes.ml --allow-read=/tmp --deny-write
```

```
Permission denied: write access to "/tmp/mylang-fs-demo". Run with --allow-write=/tmp/mylang-fs-demo
```

An open handle holds a slot counted against `--max-open-files`, given back when it closes —
which is the other reason to reach for `defer`:

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:os";

var file = path.join(os.tmpdir(), "mylang-handle-demo.txt");

fs.writeFile(file, "the quick brown fox");

func firstBytes(n) {
  var handle = defer fs.file(file, "r");

  return handle.read(n).toString();
  // the handle is released here, whichever way this returns
}

coreio.print(firstBytes(9));

fs.unlink(file);
```

#### `fs/stream` — files too large to hold

```mylang2
import "core:fs/stream";
```

`ReadableStream`, `WritableStream` and `TransformStream` work in pieces, so the memory a
program uses does not depend on the size of the file.

```mylang2
import "core:coreio";
import "core:fs";
import "core:fs/stream";
import "core:path";
import "core:os";

var source = path.join(os.tmpdir(), "mylang-stream-in.txt");
var target = path.join(os.tmpdir(), "mylang-stream-out.txt");

fs.writeFile(source, "one\ntwo\nthree\n");

// A stream hands you pieces as they arrive, so a listener is how you read it.
var seen = 0;
var input = defer stream.ReadableStream(source);

input.on("data", func(chunk) { seen += length(chunk); });

input.on("end", func() { coreio.print("read", seen, "bytes in pieces"); });

// and a copy is a pipe: nothing holds the file
var output = defer stream.WritableStream(target);

stream.ReadableStream(source).pipe(output);

coreio.print("source was", fs.stat(source).size(), "bytes");

fs.unlink(source);
```

```bash
mylang run copy.ml --allow-read=/tmp --allow-write=/tmp --max-memory=32MB
```

The limit holds however large the file is, which is the point: the whole-file
`fs.readFile` would need room for all of it at once.

#### `path` — paths as text

```mylang2
import "core:path";
```

Pure text work, so it needs no permissions at all. `join`, `resolve`, `dirname`,
`basename`, `extname`, `parse`, `format`, `normalize`, `relative`, `isAbsolute`, plus `sep`
and `delimiter`, and the `win32` and `posix` variants for handling the other platform's
paths.

```mylang2
import "core:coreio";
import "core:path";

coreio.print(path.join("usr", "local", "bin", "mylang"));
coreio.print(path.resolve("src", "..", "lib"));
coreio.print(path.basename("/var/log/app.log", ".log"));
coreio.print(path.extname("archive.tar.gz"));
coreio.print(path.parse("/home/ada/notes.txt"));
coreio.print(path.relative("/home/ada/src", "/home/ada/docs/a.md"));
```

#### `os` — the platform and the environment

```mylang2
import "core:os";
```

| Call | Needs | Description |
| --- | --- | --- |
| `os.platform()` / `arch()` / `type()` / `release()` | — | which machine this is |
| `os.hostname()` / `homedir()` / `tmpdir()` | — | names and locations |
| `os.cpus()` / `totalmem()` / `freemem()` / `loadavg()` / `uptime()` | sys | what it has |
| `os.userinfo()` / `networkInterfaces()` | sys | who and where |
| `os.environ()` / `getenv(k)` / `setenv(k, v)` / `unsetenv(k)` | env | the environment |
| `os.getcwd()` / `chdir(p)` | sys | the working directory |
| `os.memoryUsage()` / `cpuUsage()` | sys | this process |
| `os.args()` / `executable()` | — | how it was started |
| `os.kill(pid, signal)` / `os.exit(code)` | sys | ending things |

```mylang2
import "core:coreio";
import "core:os";

coreio.print("platform:", os.platform(), os.arch());
coreio.print("tmp:", os.tmpdir());
coreio.print("cores:", length(os.cpus()));
coreio.print("home:", os.getenv("HOME"));
```

Unrestricted it just works. Scoped, each variable and each query is checked as it is asked
for, so a grant can name exactly what a program may see:

```bash
mylang run info.ml --allow-sys --allow-env=HOME,PATH
```

```bash
mylang run info.ml --allow-sys --deny-env
```

```
Permission denied: env access to "HOME". Run with --allow-env
```

A variable the grant does not name is refused by name rather than coming back as `nil`,
so a program cannot quietly carry on with a wrong default.

`os.chdir` cannot work on a worker thread — the working directory belongs to the whole
process, not to one thread — and says so. Absolute paths and `path.resolve` work
everywhere.

#### `os/system` — this process

```mylang2
import "core:os/system";
```

`version`, `versions`, `arch`, `platform`, `getpid`, `getppid`, `argv`, `cwd`,
`getUptime`, `getMemoryUsage`, `getCpuUsage`, `getResourceUsage`, `uid`, `gid`, `groups`,
`hrTime`, `hrTimeBigInt`, and the identity setters `setUid`, `setGid`, `setGroups`.

Everything here needs `--allow-sys`, and the setters are refused outright under
`--deny-sys`.

```mylang2
import "core:coreio";
import "core:os/system";

coreio.print("pid:", system.getpid());
coreio.print("uptime:", system.getUptime());
coreio.print("memory:", system.getMemoryUsage());
```

```bash
mylang run usage.ml --allow-sys
```

#### `process` — running other programs

```mylang2
import "core:process";
```

The import matters more here than elsewhere: `process` is also a predefined global, so
without the import these calls reach that instead and report an unknown function.

| Call | Suspends | Description |
| --- | --- | --- |
| `process.run(cmd, args, options)` | yes | run it, wait, get everything it printed |
| `process.pipeline(stages, options)` | yes | several programs, each feeding the next |
| `process.spawn(cmd, args, options)` | — | start one you talk to while it runs |
| `process.can(what, target)` | — | would this be allowed? |
| `process.permissions()` | — | the whole policy |
| `process.pid()` / `process.exit(code)` | — | this process |

```mylang2
import "core:coreio";
import "core:process";

var out = process.run("echo", ["hello from a child"]);

coreio.print("code:", out.code);
coreio.print("said:", out.stdout.toString());
```

```bash
mylang run child.ml --allow-process=echo
```

Naming the commands is the useful form: a grant of `echo` does not let a program run
anything else, and a refusal says which command was wanted.

```bash
mylang run child.ml --allow-process=ls
```

```
Permission denied: process access to "echo". Run with --allow-process
```

A pipeline is the shell's `a | b | c`, with each stage's output going straight into the
next one's input — so a stream far larger than memory passes through without anything
collecting it:

```mylang2
import "core:coreio";
import "core:process";

var counted = process.pipeline([
  ["printf", ["banana\napple\ncherry\napple\nbanana\napple\n"]],
  ["sort"],
  ["uniq", ["-c"]],
  ["sort", ["-rn"]]
]);

coreio.print(counted.stdout.toString());
coreio.print("per-stage codes:", counted.stages);
```

```bash
mylang run count.ml --allow-process=printf,sort,uniq
```

Every stage is checked before anything starts, so a grant covers a pipeline only if it
names all of them, and a refused pipeline starts nothing at all. The result carries the
last stage's output and a code per stage — a pipeline where an early stage failed still
produces output, so the codes are worth looking at.

`process.can` lets a program adapt instead of failing:

```mylang2
import "core:coreio";
import "core:process";

if (process.can("process", "git")) {
  coreio.print("version:", process.run("git", ["--version"]).stdout.toString());
} else {
  coreio.print("no permission to run git; skipping the version check");
}
```

#### `workers` — another thread

```mylang2
import "core:workers";
```

`spawn` gives concurrency on one thread, which is what you want when tasks wait on files or
sockets. `workers` gives genuine parallelism, which is what you want when they compute.

| Call | Suspends | Description |
| --- | --- | --- |
| `workers.start(file, options)` | — | run a file on its own thread |
| `workers.pool(file, size)` | — | a fixed set of threads sharing a queue |
| `workers.cpus()` | — | how many cores there are |
| `workers.isWorker()` | — | is this code on a worker thread? |

A worker file talks through `worker.receive()` and `worker.post(value)`:

The worker file is a loop — one answer posted for every value received. `worker` is
defined only inside a worker, which is why this file is not something you run directly:

```mylang2
// double.ml
for (;;) {
  var job = worker.receive();

  if (job == nil) { break; }

  worker.post({ seen: job, doubled: job * 2 });
}
```

```mylang2
import "core:coreio";
import "core:workers";
import "core:fs";
import "core:path";
import "core:os";

// written here so this example stands alone; normally double.ml is just a file in the project
var dir = path.join(os.tmpdir(), "mylang-pool-demo");

fs.FSUtils().ensureDir(dir);
fs.writeFile(path.join(dir, "double.ml"), "for (;;) { var job = worker.receive(); if (job == nil) { break; } worker.post({ seen: job, doubled: job * 2 }); }");

var pool = defer workers.pool(path.join(dir, "double.ml"), 2);

var tasks = [];

for (var i = 1; i <= 6; i++) { tasks[length(tasks)] = spawn pool.run(i) }

var answers = wait.all(tasks);

coreio.print("threads:", pool.size, "answers:", length(answers));
coreio.print("first:", answers[0], "last:", answers[5]);

fs.FSUtils().removeDir(dir);
```

```bash
mylang run parallel.ml --allow-worker --allow-read=.
```

A thread reads the file it runs, so it needs `--allow-read` for that path as well as
`--allow-worker`. A thread inherits the policy **with its scoping intact**: started under
`--allow-read=./data`, it can read inside `./data` and nowhere else.

Each thread takes a slot counted against `--max-workers`, so the limit counts threads
rather than pools, and a pool that cannot have all of its threads ends the ones it did
start before reporting — a refusal leaves nothing running:

```bash
mylang run parallel.ml --allow-worker --allow-read=. --max-workers=1
```

```
Too many worker threads: the limit is 1. Raise it with --max-workers
```

Binary can be handed to a thread rather than copied, which costs nothing however large it
is — and leaves this side without the bytes, which it says plainly if you touch them again:

```mylang2
import "core:coreio";
import "core:bytes";

var frame = bytes.alloc(4 * 1024 * 1024, 7);

// w.post(frame);                       // copied: both sides have it
// w.post(frame, { transfer: true });   // handed over: this side no longer does

coreio.print("prepared", length(frame), "bytes");
```

#### `archive` — tar and zip

```mylang2
import "core:archive";
```

| Call | Suspends | Needs | Description |
| --- | --- | --- | --- |
| `archive.tar(entries)` / `untar(data)` | — | — | tar, in memory |
| `archive.zip(entries, o)` / `unzip(data)` | yes | — | zip, in memory |
| `archive.read(data)` | yes | — | either, detected |
| `archive.create(dir, format)` | yes | read | pack a directory into a value |
| `archive.extract(data, dest)` | yes | write | unpack a value onto disk |
| `archive.createFile(dir, archive, format)` | yes | read + write | pack **onto disk**, streaming |
| `archive.extractFile(archive, dest)` | yes | read + write | unpack **from disk**, one entry at a time |
| `archive.format(data)` | — | — | `"zip"`, `"tar"`, `"gzip"` or `"unknown"` |

In memory, for something small:

```mylang2
import "core:coreio";
import "core:archive";

var packed = archive.tar([
  { name: "readme.txt", data: "hello" },
  { name: "src/main.ml", data: "coreio.print(1);" }
]);

coreio.print("format:", archive.format(packed), "size:", length(packed));

for (var entry in archive.untar(packed)) {
  coreio.print(entry.name, "->", entry.data.toString());
}
```

No permissions at all: nothing touched the disk.

On disk, for something large — the memory used depends on the biggest single entry, not on
the archive:

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:os";
import "core:archive";

var work = path.join(os.tmpdir(), "mylang-archive-demo");
var source = path.join(work, "src");

fs.FSUtils().ensureDir(source);
fs.writeFile(path.join(source, "a.txt"), "first");
fs.writeFile(path.join(source, "b.txt"), "second");

var made = archive.createFile(source, path.join(work, "out.tar"), "tar");
var names = archive.extractFile(made, path.join(work, "back"));

coreio.print("packed to:", made);
coreio.print("unpacked:", names);
coreio.print("a.txt says:", fs.readFile(path.join(work, "back", "a.txt")).toString());

fs.FSUtils().removeDir(work);
```

```bash
mylang run backup.ml --allow-read=/tmp --allow-write=/tmp --max-memory=64MB
```

Entry names are checked, so an archive from somewhere else cannot write outside the
destination:

```
refusing to extract "../../etc/passwd": it escapes the destination
```

A tar long name travels in a PAX extended header and a zip past 65,535 entries or 4 GB
carries a zip64 end record — in both cases only when needed, so a small archive stays
readable by anything. The system `tar` and `unzip` read what comes out, byte for byte.

#### `compress` — gzip, deflate, brotli

```mylang2
import "core:compress";
```

| Call | Suspends | Needs | Description |
| --- | --- | --- | --- |
| `compress.gzip(data, o)` / `gunzip(data)` | yes | — | the whole value |
| `compress.deflate` / `inflate` / `deflateRaw` / `inflateRaw` | yes | — | the same, raw |
| `compress.brotli(data, o)` / `unbrotli(data)` | yes | — | usually smaller, slower |
| `compress.decompress(data)` | yes | — | unpack whatever it is |
| `compress.detect(data)` / `ratio(a, b)` | — | — | what it is, how well it packed |
| `compress.file(kind, src, dest)` | yes | read + write | a file, in pieces |
| `compress.stream(kind)` | — | — | data that arrives in pieces |
| `compress.transforms` | — | — | the names `kind` accepts |

```mylang2
import "core:coreio";
import "core:compress";

var text = "";

for (var i = 0; i < 200; i++) { text += "the same sentence over and over. "; }

var packed = compress.gzip(text);

coreio.print("from", length(text), "to", length(packed), "bytes");
coreio.print("ratio:", compress.ratio(text, packed));
coreio.print("detected:", compress.detect(packed));
coreio.print("back:", length(compress.gunzip(packed).toString()));
```

That holds the input and the output at once, which a 10 GB log cannot satisfy.
`compress.file` does not:

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:os";
import "core:compress";

var dir = path.join(os.tmpdir(), "mylang-compress-demo");

fs.FSUtils().ensureDir(dir);

var source = path.join(dir, "log.txt");
var packed = path.join(dir, "log.txt.gz");
var back = path.join(dir, "log.back");

var line = "a line of log output that repeats\n";
var body = "";

for (var i = 0; i < 2000; i++) { body += line; }

fs.writeFile(source, body);

var written = compress.file("gzip", source, packed);

coreio.print("packed to", written, "bytes from", fs.stat(source).size());

compress.file("gunzip", packed, back);

coreio.print("round trip identical:", fs.readFile(back).toString() == body);

fs.FSUtils().removeDir(dir);
```

```bash
mylang run pack.ml --allow-read=/tmp --allow-write=/tmp --max-memory=32MB
```

A stream is for data arriving from somewhere else — a socket, rows you build:

```mylang2
import "core:coreio";
import "core:compress";

var packer = defer compress.stream("gzip");

for (var i = 0; i < 100; i++) { packer.write($"row {i}\n"); }

var packed = packer.finish();

coreio.print("packed", length(packed), "bytes");
coreio.print("first row back:", compress.gunzip(packed).toString("utf8", 0, 6));
```

#### `crypto` — hashing, keys, encryption

```mylang2
import "core:crypto";
```

| Call | Suspends | Needs | Description |
| --- | --- | --- | --- |
| `crypto.hash(algorithm, data, encoding)` | — | — | one of `getHashes()` |
| `crypto.md5` / `sha1` / `sha256` / `sha384` / `sha512` | — | — | named shortcuts |
| `crypto.hashFile(path, algorithm)` | yes | read | a file, read in pieces |
| `crypto.hmac(algorithm, key, data)` | — | — | keyed hashing |
| `crypto.randomBytes(n)` / `randomInt(a, b)` / `randomUUID()` | — | — | unguessable values |
| `crypto.randomString(n)` / `randomPassword(n)` | — | — | tokens and passwords |
| `crypto.hashPassword(p)` / `verifyPassword(p, h)` | yes | — | for storing a password |
| `crypto.pbkdf2` / `scrypt` / `hkdf` / `deriveKey` | yes | — | a key from a password |
| `crypto.encrypt(data, key)` / `decrypt(data, key)` | yes | — | symmetric encryption |
| `crypto.sign` / `verify` / `generateKeyPair` | yes | — | signatures |
| `crypto.timingSafeEqual(a, b)` | — | — | comparison that leaks no timing |
| `crypto.base64Encode` / `hexEncode` / `urlEncode` and their decoders | — | — | encodings |
| `crypto.crc32(data)` | — | — | a checksum, not a hash |

```mylang2
import "core:coreio";
import "core:crypto";

coreio.print("sha256:", crypto.sha256("hello"));
coreio.print("hmac:", crypto.hmac("sha256", "a-key", "a message"));
coreio.print("token:", crypto.randomString(16));
coreio.print("base64:", crypto.base64Encode("hello"));

var stored = crypto.hashPassword("correct horse battery staple");

coreio.print("password checks out:", crypto.verifyPassword("correct horse battery staple", stored));
coreio.print("and a wrong one does not:", crypto.verifyPassword("hunter2", stored));
```

No permissions: none of that reads anything. Hashing a **file** does, and it reads the file
in pieces, so a file far larger than the memory limit works — which is the reason to hash
by path rather than by value:

```mylang2
import "core:coreio";
import "core:crypto";
import "core:fs";
import "core:path";
import "core:os";

var file = path.join(os.tmpdir(), "mylang-hash-demo.bin");

fs.writeFile(file, "some contents to hash");

coreio.print("by path:", crypto.hashFile(file, "sha256"));
coreio.print("by value:", crypto.hash("sha256", fs.readFile(file)));

fs.unlink(file);
```

```bash
mylang run hash.ml --allow-read=/tmp --allow-write=/tmp --max-memory=64MB
```

Use `crypto.randomBytes` and `crypto.randomPassword` for anything that protects something.
`random` is for sampling and simulation, and is not meant to be unguessable.

---

### Network

Everything here needs `--allow-net`, which can name hosts and ports. Unix sockets are the
exception: they are files, so they go through `--allow-read` and `--allow-write` instead.

Each example below is a server and a client in one program, talking over the loopback
interface, so you can run it as it stands.

#### `net/http` — HTTP clients and servers

```mylang2
import "core:net/http";
```

A handler takes **one** argument, the context, which carries both the request and the ways
to answer it. `listen` parks until the port is bound and returns where it ended up.

```mylang2
import "core:coreio";
import "core:net/http";

var server = defer http.Server();

server.get("/health", func(ctx) { ctx.json({ ok: true }); });
server.get("/users/:id", func(ctx) { ctx.json({ id: ctx.params.id, sort: ctx.query.sort }); });
server.post("/users", func(ctx) {
  if (ctx.body == nil) { return ctx.status(400).json({ error: "a body is required" }); }

  ctx.status(201).json({ created: ctx.body.name });
});

var where = server.listen(0, "127.0.0.1");

coreio.print($"listening on {where.protocol}://{where.host}:{where.port}");

var client = http.Client({ baseURL: $"http://127.0.0.1:{where.port}" });

coreio.print("health:", client.get("/health").json());
coreio.print("one user:", client.get("/users/7?sort=name").json());
coreio.print("created:", client.post("/users", { name: "Ada" }).json());

var bad = client.post("/users");

coreio.print("without a body:", bad.status(), bad.json());
```

```bash
mylang run api.ml --allow-net=127.0.0.1
```

Deny it and the bind is refused before anything is listening:

```bash
mylang run api.ml --deny-net
```

```
Permission denied: net access to "127.0.0.1:0". Run with --allow-net=127.0.0.1
```

Errors a running server meets — a client that hangs up, a body over the limit, a handler
that throws — print one line each, and only when they are the server's fault. `onError`
receives every one of them as a value instead, and `logErrors: true` / `false` prints all or
none; see [errors](library/net/http/README.md#errors).

A client response answers through methods, because the body is only decoded if you ask:
`status()`, `text()`, `json()`, `buffer()`, `getHeader(name)`, and the fields `ok`,
`statusText`, `url`, `redirected`.

Requests overlap with `spawn`, which is what makes a slow upstream cheap:

```mylang2
import "core:coreio";
import "core:net/http";
import "core:time";

var server = defer http.Server();

server.get("/slow/:n", func(ctx) {
  time.Sleep(200);
  ctx.json({ n: ctx.params.n });
});

var where = server.listen(0, "127.0.0.1");
var client = http.Client({ baseURL: $"http://127.0.0.1:{where.port}" });

var watch = time.Stopwatch();

watch.start();

var jobs = [];

for (var i = 1; i <= 4; i++) { jobs[length(jobs)] = spawn client.get($"/slow/{i}") }

var answers = wait.all(jobs);

watch.stop();

coreio.print(length(answers), "requests of 200ms each took", watch.elapsed(), "ms");
```

Four requests that each wait 200 ms finish in a little over 200 ms, not 800: the task
parks and the others run.

Middleware takes the context and a `next`:

```mylang2
import "core:coreio";
import "core:net/http";
import "core:crypto";

var server = defer http.Server();
var log = [];

server.use(func(ctx, next) {
  ctx.state.requestId = crypto.randomString(6);
  log[length(log)] = ctx.method + " " + ctx.path;
  next();
});

server.get("/whoami", func(ctx) { ctx.json({ request: ctx.state.requestId }); });

var where = server.listen(0, "127.0.0.1");
var client = http.Client();

coreio.print(client.get($"http://127.0.0.1:{where.port}/whoami").json());
coreio.print("the middleware saw:", log);
```

#### `net/url` — parsing and building URLs

```mylang2
import "core:net/url";
```

Pure text work, so no permissions. `URL`, `URLSearchParams`, `URLPattern`, `resolve`,
`join`, `format`, `isAbsolute`, `fileURLToPath`, and the encode/decode pairs.

```mylang2
import "core:coreio";
import "core:net/url";

var parsed = url.URL("https://example.com:8443/api/users?sort=name&page=2#top");

// every member of a parsed URL is a call, not a field
coreio.print("host:", parsed.hostname(), "port:", parsed.port());
coreio.print("path:", parsed.pathname(), "hash:", parsed.hash());
coreio.print("one parameter:", parsed.searchParams().get("sort"));
coreio.print("resolved:", url.resolve("https://example.com/a/b", "../c"));
coreio.print("encoded:", url.encodeURIComponent("a b&c"));
```

#### `tcp` — TCP, and unix sockets

```mylang2
import "core:tcp";
```

| Call | Suspends | Needs | Description |
| --- | --- | --- | --- |
| `tcp.connect(host, port, options)` | yes | net | connect |
| `tcp.listen(port, host, options)` | yes | net | serve; port `0` picks a free one |
| `tcp.connectUnix(path, options)` | yes | read | connect to a unix socket |
| `tcp.listenUnix(path, options)` | yes | write | serve on one; `{force: true}` clears a stale path |
| `tcp.isPortFree(port, host)` | yes | net | could something bind there? |

A socket has `read(n)`, `readExactly(n)`, `readAll()`, `write(data)`, `end()`, `close()`,
`buffered()`, `ended()`, `setTimeout(ms)`, `setNoDelay(on)`, `setKeepAlive(on, delay)` and
`address()`. The same socket comes back from `tcp`, `tls` and a unix connection, so code
that takes one works with all of them.

```mylang2
import "core:coreio";
import "core:tcp";

var server = defer tcp.listen(0, "127.0.0.1");

coreio.print("listening on port", server.port);

var serving = spawn {
  var client = server.accept();
  var asked = client.read();

  client.write("you said: " + asked.toString());
  client.end()
}

var socket = defer tcp.connect("127.0.0.1", server.port);

socket.setKeepAlive(true, 30000);
socket.write("hello");

coreio.print(socket.readAll().toString());
coreio.print("connected to:", socket.address());

wait serving;
```

```bash
mylang run echo.ml --allow-net=127.0.0.1
```

A unix socket is a file rather than a host and port — nothing is routed, and two processes
on one machine talk through the filesystem. That is what most database servers offer
locally, and it is faster than a loopback connection:

```mylang2
import "core:coreio";
import "core:tcp";
import "core:path";
import "core:os";

var sock = path.join(os.tmpdir(), "mylang-demo.sock");

var server = defer tcp.listenUnix(sock, { force: true });

coreio.print("listening on", server.path);

var serving = spawn {
  var client = server.accept();

  client.write("over a file, not a port");
  client.end()
}

var socket = defer tcp.connectUnix(sock);

coreio.print(socket.readAll().toString());

wait serving;
```

```bash
mylang run unix.ml --allow-read=/tmp --allow-write=/tmp
```

Because the socket is a file, `--allow-net` has nothing to do with it:

```bash
mylang run unix.ml --allow-net --deny-write
```

```
Permission denied: write access to "/tmp/mylang-demo.sock". Run with --allow-write=/tmp/mylang-demo.sock
```

Without `{force: true}`, an existing path is an error rather than something to take over —
which stops one server from quietly stealing another's socket. Closing the server removes
the path, and it waits until the path is actually gone.

`setKeepAlive` is what notices a peer that disappeared without closing — a cable pulled, a
machine that lost power. Without it such a socket looks open and never produces anything.

#### `tls` — encrypted TCP

```mylang2
import "core:tls";
```

`tls.connect(host, port, options)`, `tls.listen(port, host, options)` and
`tls.rootCertificates()`. Certificates verify by default, and the handshake result is
checked again afterwards, so a connection that completes has been verified.

```mylang2
import "core:coreio";
import "core:tls";

coreio.print("trusted roots on this machine:", length(tls.rootCertificates()));
```

A socket from `tls` is the socket `tcp` returns, with the connection's details added:
`protocol()`, `cipher()`, `alpn()`, `peerCertificate()` and `authorized()`.

This one needs a real host to talk to, so it is the one example here you cannot run
offline:

```mylang2
import "core:coreio";
import "core:tls";

var socket = defer tls.connect("example.com", 443, { alpn: ["http/1.1"] });

socket.write("GET / HTTP/1.0\r\nHost: example.com\r\n\r\n");

coreio.print("agreed:", socket.protocol(), socket.cipher().name);
coreio.print("verified:", socket.authorized());
coreio.print("issued to:", socket.peerCertificate().subject.CN);
```

```bash
mylang run fetch.ml --allow-net=example.com:443
```

Certificate and key files may be given inline or as `{file: "path"}`, and the file form is
checked against `--allow-read`:

```bash
mylang run server.ml --allow-net --allow-read=./certs
```

Turning verification off is a deliberate act, for a self-signed certificate in a test
environment and never for anything carrying real traffic — this one needs such a server to
be running:

```mylang2
import "core:coreio";
import "core:tls";

var socket = defer tls.connect("localhost", 8443, { rejectUnauthorized: false });

coreio.print("connected without verifying:", socket.protocol());
```

#### `udp` — datagrams

```mylang2
import "core:udp";
```

`udp.open(port, options)` binds a socket you can `send` from and `receive` on — port `0`
picks a free one. There is no connection, so nothing guarantees a datagram arrives or
arrives once, which is the trade for its being cheap.

| Call | Suspends | Description |
| --- | --- | --- |
| `udp.open(port, options)` | yes | bind; `0` picks a free port |
| `socket.send(data, host, port)` | yes | send one datagram; returns the byte count |
| `socket.receive()` / `receive(ms)` | yes | the next datagram, or `nil` on a timeout |
| `socket.pending()` | — | datagrams that arrived and are not taken yet |
| `socket.setBroadcast(on)` / `joinGroup(a)` / `leaveGroup(a)` | — | the rest |
| `socket.port` / `address` / `family` / `closed` | — | fields |

```mylang2
import "core:coreio";
import "core:udp";

var receiver = defer udp.open(0, { host: "127.0.0.1" });

coreio.print("bound to", receiver.port);

var listening = spawn {
  var message = receiver.receive();

  coreio.print("got:", message.text, "from", message.address, message.port)
}

var sender = defer udp.open(0, { host: "127.0.0.1" });

sender.send("a datagram", "127.0.0.1", receiver.port);

wait listening;
```

```bash
mylang run datagram.ml --allow-net=127.0.0.1
```

#### `ws` — WebSockets

```mylang2
import "core:ws";
```

`ws.connect(url, options)` and `ws.listen(port, host, options)`. A `wss://` url goes
through `tls`, so it gets the same verification by default; a server serves `wss://` when
given a certificate and a key.

A message carries `kind` (`"text"` or `"binary"`), `data` as `bytes` and `text` for a text
message. A peer is read the same way a client is: `receive()` until it returns `nil`.

```mylang2
import "core:coreio";
import "core:ws";

var server = defer ws.listen(0, "127.0.0.1");

coreio.print("listening on port", server.port);

server.accept(func(peer) {
  peer.send("welcome");

  for (;;) {
    var message = peer.receive();

    if (message == nil) { break; }

    peer.send("you said: " + message.text);
  }
});

var socket = defer ws.connect($"ws://127.0.0.1:{server.port}");

coreio.print("first:", socket.receive().text);

socket.send("hello");

coreio.print("second:", socket.receive().text);
```

```bash
mylang run chat.ml --allow-net=127.0.0.1
```

#### `dns` — name resolution

```mylang2
import "core:dns";
```

`lookup`, `lookupAll`, `resolve`, `reverse`, `servers`, `setServers`, `isIP`, `types`.

```mylang2
import "core:coreio";
import "core:dns";

coreio.print("is that an address:", dns.isIP("127.0.0.1"), dns.isIP("example.com"));
coreio.print("record types:", dns.types);
coreio.print("resolvers this machine uses:", dns.servers());
```

Those three need nothing from the network — they report what this machine is configured
with. An actual lookup does, so it needs a resolver to answer and cannot run offline:

```mylang2
import "core:coreio";
import "core:dns";

coreio.print("example.com is:", dns.lookup("example.com"));
coreio.print("all of its addresses:", dns.lookupAll("example.com"));
coreio.print("its mail servers:", dns.resolve("example.com", "MX"));
```

```bash
mylang run resolve.ml --allow-net=example.com
```

A lookup is a network operation, so it is checked like any other — which is worth knowing,
because a program that resolves a name it is not allowed to reach is refused at the lookup
rather than at the connection.

#### `net/socket` — the socket all of them share

Not a library to import: the implementation behind every socket above, written once so a
value from `tcp`, `tls` or a unix connection reads and writes the same way. Its
[README](library/net/socket/README.md) documents every method those sockets have, which is
the one page worth reading if you work with sockets at all.

---

### Running things

#### `coreio` — the console

```mylang2
import "core:coreio";
```

`print` and `println`, the levelled `printError`, `printWarning`, `printInfo`,
`printSuccess`, `printDebug`, the structured `table`, `printJSON`, `dir`, `group` /
`groupEnd`, the timers `time` / `timeLog` / `timeEnd`, the counters `count` /
`countReset`, plus `clear`, `trace`, `assert`, `colorize`, and `input` / `scan` for
reading from the console.

```mylang2
import "core:coreio";

coreio.print("plain output", 42, [1, 2], { a: 1 });
coreio.printSuccess("that worked");
coreio.printWarning("something to look at");
coreio.printError("that did not work");

coreio.table([
  { name: "ada", role: "admin" },
  { name: "alan", role: "user" }
]);

coreio.group("details");
coreio.print("inside the group");
coreio.groupEnd();

coreio.time("work");
coreio.timeEnd("work");
```

`coreio.input(prompt)` reads a line and **does not block the program** — other tasks keep
running while it waits, which is why a prompt can sit there while a server goes on serving:

```mylang2
import "core:coreio";
import "core:time";

var ticking = spawn {
  for (var i = 0; i < 3; i++) {
    coreio.print("still working:", i);
    wait spawn time.Sleep(300);
  }
  "done"
}

// uncomment to try it interactively; it parks this task, not the program
// var name = coreio.input("your name? ");
// coreio.print("hello,", name);

wait ticking;
```

#### `time` — dates, durations, timers

```mylang2
import "core:time";
```

| Call | Suspends | Description |
| --- | --- | --- |
| `time.now()` | — | the moment now |
| `time.DateTime(...)` | — | a point in time, with arithmetic and formatting |
| `time.Duration(...)` | — | a length of time |
| `time.Stopwatch()` | — | `start`, `stop`, `elapsed` |
| `time.Sleep(ms)` | yes | park this task; everything else keeps running |
| `time.Delay` / `Interval` / `Timeout` | — | run something later or repeatedly |
| `time.Debounce` / `Throttle` | — | rate-limit a function |
| `time.TimeZone` / `TimeZones` / `TimeUtils` | — | zones and helpers |

```mylang2
import "core:coreio";
import "core:time";

var watch = time.Stopwatch();

watch.start();

time.Sleep(120);

watch.stop();

coreio.print("slept about", watch.elapsed(), "ms");

var now = time.now();

coreio.print("now:", now);
```

`time.Sleep` parks the calling task only. Two sleeps in `spawn` overlap:

```mylang2
import "core:coreio";
import "core:time";

var watch = time.Stopwatch();

watch.start();

var a = spawn time.Sleep(200);
var b = spawn time.Sleep(200);

wait.all([a, b]);

watch.stop();

coreio.print("two 200ms sleeps took", watch.elapsed(), "ms, not 400");
```

#### `syncbox` — channels between tasks

```mylang2
import "core:syncbox";
```

A channel hands values from one task to another. `syncbox.Chan(capacity)` — `0` is
unbuffered, so a sender waits until a receiver takes the value.

| Call | Suspends | Description |
| --- | --- | --- |
| `chan.send(value)` | yes | hand over, parking while full |
| `chan.recv()` | yes | take one, parking while empty |
| `chan.tryRecv()` | — | take one or `nil`, never parking |
| `chan.trySend(value)` | — | send if there is room; `false` if not |
| `chan.close()` | — | no more values will be sent |
| `chan.len()` / `cap()` / `isClosed()` | — | current state |

```mylang2
import "core:coreio";
import "core:syncbox";

var jobs = syncbox.Chan(4);

var producer = spawn {
  for (var i = 1; i <= 5; i++) { jobs.send(i * 10); }
  jobs.close();
  "produced"
}

var consumer = spawn {
  var total = 0;

  for (;;) {
    var job = jobs.recv();

    if (job == nil) { break; }

    total += job;
  }

  total
}

wait producer;

var sum = wait consumer;

coreio.print("the consumer added up to", sum.result);
```

`recv()` on a closed, empty channel returns `nil`, which is the usual way to end a
consumer loop. No permissions: this is entirely inside the program.

#### `events` — emitters and buses

```mylang2
import "core:events";
```

`EventEmitter`, `EventBus`, `Signal`, `Observable`, `EventDispatcher`.

```mylang2
import "core:coreio";
import "core:events";

var emitter = events.EventEmitter();

emitter.on("saved", func(name) { coreio.print("saved:", name); });
emitter.once("ready", func() { coreio.print("ready, once only"); });

emitter.emit("ready");
emitter.emit("ready");
emitter.emit("saved", "notes.txt");

coreio.print("listeners for saved:", emitter.listenerCount("saved"));
```

#### `runtime` — the scheduler

```mylang2
import "core:runtime";
```

`go`, `schedule`, `scheduleFirst`, `scheduleDelayed`, `scheduleRepeating`, `waitForIdle`,
`Spawn`, `Scheduler`. Most programs never need this: `spawn` and `wait` are the way to
start work, and this is for the cases where you want to say *when*.

```mylang2
import "core:coreio";
import "core:runtime";

runtime.schedule(func() { coreio.print("second"); });
runtime.scheduleFirst(func() { coreio.print("first"); });

runtime.waitForIdle();

coreio.print("everything queued has run");
```

#### `test` — the test framework

```mylang2
import "core:test" as { describe, test, beforeEach, assert, finish };
```

`describe`, `test` (and `it`), `skip`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll`,
`finish`, `summary`, `stats`, `reset`, `configure`, `show`, `deepEq`, `fail`, `assert`.

```mylang2
import "core:test" as { describe, test, assert, finish };
import "core:strings";

describe("strings", func() {
  test("trims both ends", func() {
    assert.equal(strings.trim("  hi  "), "hi");
  });

  test("counts overlapping needles", func() {
    assert.equal(strings.count("banana", "an"), 2);
  });

  test("refuses what it cannot do", func() {
    assert.throws(func() { strings.repeat("x", -1); });
  });
});

finish("strings");
```

```bash
mylang test                      # every *.test.ml below the current directory
mylang test test/library         # a directory
mylang test --filter trims       # only tests whose name matches
mylang test --jobs=4             # four files at a time, on separate threads
mylang test --bail               # stop at the first failure
```

A test file is an ordinary program, so it gets permissions the same way:

```bash
mylang test --allow-read=. --allow-net=127.0.0.1
```

Which means a test can prove a refusal happens, not merely that the happy path works:

```mylang2
import "core:test" as { test, assert, finish };
import "core:process";

test("a command outside the grant is refused", func() {
  if (!process.can("process", "echo")) {
    assert.throws(func() { process.run("echo", ["hi"]); }, "Permission denied");
  }
});

finish("permissions");
```

#### `utils` and `utils/colors`

```mylang2
import "core:utils";
import "core:utils/colors";
```

`utils.typeOf(value)` names a value's type. `colors` has the foreground and background
colours, the styles (`bold`, `dim`, `italic`, `underline`, `strikethrough`, `reverse`),
`rgb`, `hex`, `hsl`, `rainbow`, `combine`, `strip` and `enabled`.

```mylang2
import "core:coreio";
import "core:utils";
import "core:utils/colors";

coreio.print(utils.typeOf(1), utils.typeOf("a"), utils.typeOf([1]), utils.typeOf({}));
coreio.print(colors.green("that worked"), colors.bold(colors.red("that did not")));
coreio.print(colors.hex("a colour by hex", "#ff8800"));
coreio.print("without the codes:", colors.strip(colors.green("plain again")));
```

`colors.enabled` is false when output is not a terminal, so piping a program's output
somewhere does not fill it with escape codes.

---

## 🔐 Permissions and resource limits

A MyLang2 program says what it is allowed to touch on the command line. Nothing is
restricted until you ask for it, so existing programs keep working unchanged — but the
moment a program is given a sandbox, everything outside it is refused.

```bash
mylang run app.ml \
  --allow-read=./data \
  --allow-net=api.telegram.org \
  --deny-process \
  --max-memory=256MB \
  --timeout=30s
```

### How the two modes work

| Flags given | What happens |
| --- | --- |
| none | **unrestricted** — everything is permitted |
| only `--deny-*` | permissive, minus the kinds you denied |
| any `--allow-*` | **sandbox** — every kind not explicitly allowed is denied |

`--deny-*` always beats `--allow-*`. `--allow-all` (or `-A`) grants everything.

### The kinds

| Kind | Covers | Flags |
| --- | --- | --- |
| `read` | reading files and directories | `--allow-read[=paths]`, `--deny-read` |
| `write` | creating, changing and deleting files | `--allow-write[=paths]`, `--deny-write` |
| `net` | `tcp`, `udp`, `ws`, `dns`, `net/http`, listening and connecting | `--allow-net[=hosts]`, `--deny-net` |
| `env` | reading and writing environment variables | `--allow-env[=names]`, `--deny-env` |
| `process` | starting external programs | `--allow-process[=commands]`, `--deny-process` |
| `sys` | cpus, memory, users, `exit`, `chdir`, DNS servers | `--allow-sys`, `--deny-sys` |
| `worker` | starting worker threads | `--allow-worker`, `--deny-worker` |

A grant may be a whole kind or a list:

```bash
--allow-read=./data,./config        # these directories and what is under them
--allow-net=api.example.com         # this host, any port
--allow-net=api.example.com:443     # this host, this port only
--allow-process=git,npm             # these commands only
```

A refusal names what was wanted and what would permit it:

```
Permission denied: read access to "/etc/passwd". Run with --allow-read=/etc/passwd
```

### Resource limits

| Flag | Effect |
| --- | --- |
| `--max-memory=<size>` | end the program above this memory usage (`256MB`, `1g`, `512kb`) |
| `--timeout=<duration>` | end the program after this long (`30s`, `500ms`, `2m`) |
| `--max-open-files=<n>` | how many files may be open at once |
| `--max-connections=<n>` | how many sockets and servers may be open at once |
| `--max-tasks=<n>` | how many tasks may be alive at once |
| `--max-workers=<n>` | how many worker threads may run at once |

`--max-memory` counts the memory a program actually holds, including binary buffers, which
live outside the heap — a program holding 400 MB of `bytes` is over a 256 MB limit, as it
should be. An allocation large enough to cross the limit is refused before it is made,
rather than after the memory is already taken.

The four counting limits are about exhaustion rather than size: a program can open ten
thousand files, or ten thousand sockets, while using almost no memory, and each of those
runs the machine out of something. A slot is taken when a resource is opened and given back
when it is closed, so the limit counts what the program is *holding*, and a refusal names
the flag that would allow more:

```
Resource limit exceeded: too many open connections (5); raise --max-connections
```

Both are enforced from outside the program, at every scheduling point *and* on a timer, so
they work whether the program is spinning in a loop or blocked on the network — and a
`try/catch` inside the program cannot swallow them:

```mylang2
try {
  while (true) { }        // --timeout=1s
} catch (e) {
  coreio.print("caught");  // never printed; the program is already over
}
```

Ending a program is not the same as dropping it. When a limit is reached, every live task
is unwound, so `defer` and `symbol.dispose` run: a buffered file is flushed, a socket is
closed, a child process is killed. Cleanup that itself suspends is given a short grace
period to finish; cleanup that will not finish — a `defer` with a loop in it — is cut off
rather than allowed to hold the program open.

### What the sandbox actually covers

A sandbox that can be stepped around is worse than none, so these paths are closed:

- **Symlinks.** A grant and a target are both resolved through their links before being
  compared, so a link inside `./data` pointing at `/etc/passwd` is refused. A grant that is
  itself a symlink still works.
- **`import`.** Importing a file or a `.json` reads it and then runs it, so it is checked
  against `--allow-read` like any other read. A remote `import` is checked against
  `--allow-net`.
- **Workers.** A thread inherits the policy *with its scoping intact*: a program under
  `--allow-read=./data` starts a thread that can read inside `./data` and nowhere else.
- **`os` and `os/system`.** Every environment variable read and every machine query is
  checked as it happens, against `--allow-env` and `--allow-sys`.
- **Memory.** Binary buffers count toward `--max-memory`, and the limit is checked on a
  timer as well as at scheduling points, so it applies to a program parked on host I/O.

### Remote modules: `mylang.lock`

A remote `import` records the hash of what it fetched in `mylang.lock` at the project root.
From then on the same url must return the same bytes, or the import is refused — so a
dependency cannot be changed underneath a program that already ran once.

```bash
mylang run app.ml --allow-net           # records each url the first time
mylang run app.ml --allow-net --frozen  # refuses any url not already recorded
```

`--frozen` is for a build or a deployment, where a new dependency appearing is a problem
rather than a convenience.

### Asking what is allowed

A program can check its own policy, which never needs a permission itself:

```mylang2
import "core:process";

if (!process.can("net")) {
  coreio.print("running offline; skipping the update check");
}

coreio.print(process.permissions());
// { sandboxed: true, read: "/app/data", net: "api.telegram.org", process: "denied", … }
```

A worker inherits the policy of the program that started it, so a sandboxed program cannot
widen its permissions by starting a thread.

---

---

## Permissions in practice

The reference above gives the flags; this is how they behave when you actually use them.

### Which library needs what

| Flag | Libraries that ask for it |
| --- | --- |
| `--allow-read` | `fs`, `fs/stream`, `archive` (reading), `compress.file` (source), `crypto.hashFile`, `tcp.connectUnix`, a `tls` certificate given as a file, `import` of a file or `.json`, a `workers` file |
| `--allow-write` | `fs`, `fs/stream`, `archive` (extracting), `compress.file` (destination), `tcp.listenUnix` |
| `--allow-net` | `net/http`, `tcp`, `tls`, `udp`, `ws`, `dns`, a remote `import` |
| `--allow-env` | `os.environ`, `os.getenv`, `os.setenv`, `os.unsetenv` |
| `--allow-sys` | the machine queries in `os`, everything in `os/system` |
| `--allow-process` | `process.run`, `process.pipeline`, `process.spawn` |
| `--allow-worker` | `workers.start`, `workers.pool` |

Nothing else asks for anything: `strings`, `arrays`, `objects`, `collections`, `iter`,
`json`, `bytes`, `binary`, `validation`, `numbers`, `uuid`, `random`, `path`, `syncbox`,
`events`, `time`, `utils` and most of `crypto` work on values that are already in the
program.

### The same program, three ways

Take a program that reads a directory, packs it, and posts the result somewhere:

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:os";
import "core:archive";
import "core:crypto";

var dir = path.join(os.tmpdir(), "mylang-perm-demo");

fs.FSUtils().ensureDir(dir);
fs.writeFile(path.join(dir, "notes.txt"), "something worth keeping");

var packed = archive.tar([
  { name: "notes.txt", data: fs.readFile(path.join(dir, "notes.txt")) }
]);

coreio.print("packed", length(packed), "bytes");
coreio.print("checksum:", crypto.sha256(packed));

fs.FSUtils().removeDir(dir);
```

**Unrestricted** — no flag has been given, so nothing is denied:

```bash
mylang run pack.ml
```

This is the mode for your own machine and your own code. It is not a hole: it is the
default *until the first grant*, and the moment you give one, everything else closes.

**Scoped** — the first `--allow-*` turns on deny-by-default, so these two flags are the
whole of what the program may do:

```bash
mylang run pack.ml --allow-read=/tmp --allow-write=/tmp
```

It has no network, cannot run a program, cannot read an environment variable and cannot
start a thread, even though nothing says so explicitly.

**Scoped and explicitly fenced** — a `--deny-*` always wins, even over a grant, which is
how you make an intention impossible to undo by mistake:

```bash
mylang run pack.ml --allow-read=/tmp --allow-write=/tmp --deny-net --deny-process
```

### What a refusal looks like

A refusal names what was wanted and the flag that would allow it:

```
Permission denied: read access to "/etc/passwd". Run with --allow-read=/etc/passwd
```

It is an ordinary error, so a program can catch it and carry on:

```mylang2
import "core:coreio";
import "core:fs";

func readIfAllowed(file) {
  try {
    return fs.readFile(file).toString();
  } catch (e) {
    coreio.print("could not read", file);

    return nil;
  }
}

coreio.print("got:", readIfAllowed("/etc/shadow"));
```

Better still, ask first rather than failing:

```mylang2
import "core:coreio";
import "core:process";

coreio.print("may I read /tmp:", process.can("read", "/tmp"));
coreio.print("may I reach example.com:", process.can("net", "example.com"));
coreio.print("may I run git:", process.can("process", "git"));
coreio.print("the whole policy:", process.permissions());
```

```bash
mylang run ask.ml --allow-read=/tmp
```

That is how a program adapts: skip the optional feature rather than stopping.

### Limits, not just permissions

A permission says *whether*; a limit says *how much*.

| Flag | What it bounds |
| --- | --- |
| `--max-memory=<size>` | memory held, buffers included (`256MB`, `1g`, `512kb`) |
| `--timeout=<duration>` | how long the program may run (`30s`, `500ms`, `2m`) |
| `--max-open-files=<n>` | files open at once |
| `--max-connections=<n>` | sockets and servers open at once |
| `--max-tasks=<n>` | tasks alive at once |
| `--max-workers=<n>` | worker threads running at once |

The four counting limits are about exhaustion rather than size: a program can open ten
thousand sockets while using almost no memory, and that runs the machine out of something
real. A slot is taken when a resource opens and given back when it closes, so the limit
counts what the program is *holding*:

```mylang2
import "core:coreio";
import "core:tcp";

var held = [];

for (var i = 0; i < 3; i++) { held[length(held)] = tcp.listen(0, "127.0.0.1"); }

coreio.print("holding", length(held), "servers");

for (var server in held) { server.close(); }

coreio.print("all given back");
```

```bash
mylang run hold.ml --allow-net=127.0.0.1 --max-connections=5
```

```bash
mylang run hold.ml --allow-net=127.0.0.1 --max-connections=2
```

```
Too many network connections: the limit is 2. Raise it with --max-connections
```

Reaching a limit does not drop the program where it stands. Every live task is unwound,
so `defer` and `symbol.dispose` run — a buffered file is flushed, a socket closed, a child
killed:

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:os";
import "core:time";

var file = path.join(os.tmpdir(), "mylang-cleanup-demo.txt");

func work() {
  var handle = defer fs.file(file, "w");

  handle.write("written before the timeout\n");

  time.Sleep(60000);                 // the timeout arrives in the middle of this
}

work();
```

```bash
mylang run cleanup.ml --allow-read=/tmp --allow-write=/tmp --timeout=1s
```

The program ends at one second, and the file is complete and closed — the `defer` ran
while the task was being unwound. Cleanup that itself suspends gets a short grace period;
cleanup that will not finish is cut off rather than left holding the program open.

### Remote modules: `mylang.lock`

A remote `import` records the hash of what it fetched in `mylang.lock` at the project
root. From then on the same url must return the same bytes:

```bash
mylang run app.ml --allow-net                # records each url the first time
mylang run app.ml --allow-net --frozen       # refuses any url not already recorded
```

If a url's contents change, the import is refused rather than quietly running something
else. `--frozen` is for a build or a deployment, where a new dependency appearing is a
problem rather than a convenience.

### Seeing the policy a program is running under

```bash
mylang run app.ml --allow-read=./data --allow-net=api.example.com --verbose
```

`--verbose` prints the policy as the interpreter understood it, which is the quickest way
to find a flag that did not say what you thought — a path that resolved somewhere else, or
a host without the port you meant.

---

## Security Features

MyLang2 incorporates multiple security mechanisms to protect applications:

- **Property Protection**: Properties prefixed with `__` are automatically protected from external access
- **Native Member Access**: interpreted code can never see or call JavaScript. Every member read,
  write and `in` check goes through `src/runtime/members.ts`, which resolves members by hand:
  language values (objects, arrays, strings, errors) expose only their *own* properties - the JS
  prototype chain is never consulted, so `"x".toUpperCase`, `[].push`, `{}.toString`,
  `.constructor`, `.__proto__` simply do not exist. Functions and struct types reveal only `name`;
  host objects (environment, AST nodes, buffers, servers...) are opaque; built-in host types the
  language may use (typed arrays, `Map`/`Set`) expose exactly the members listed in `NATIVE_TYPES`
  (`registerNativeType` lets a library add more). Prototypes can never be written.
- **Safe Property Access**: Optional chaining prevents runtime errors when accessing null or undefined properties
- **Controlled Environment**: Sandboxed execution environment for untrusted code

---

## Advanced Features

### **Global Functions**

MyLang2 provides universal functions that work across all data types:

#### **length function**

```mylang2
import "coreio";

// Universal length function with intelligent type handling
coreio.print(length("Hello"));     // 5 (string character count)
coreio.print(length([1, 2, 3]));   // 3 (array element count)
coreio.print(length({a: 1, b: 2})); // 2 (object property count)
coreio.print(length(123.45));      // 5 (string representation length)
coreio.print(length(12345n));      // 5 (string representation length)
coreio.print(length(true));      // 1
coreio.print(length(false));      // 1
coreio.print(length(nil));      // 0
coreio.print(length(func test(args1, args2) {})); // 2 (param length)
coreio.print(length(struct Test{
  var fields;

  func setFields(fields = 0) {
    return this.fields = fields;
  }
})); // 2 (fields count + func count) also for enum
```

#### **process variable**

```mylang2
import "coreio";
import "os/system";

coreio.print(process.nodejs.version); // Current NodeJS version
coreio.print(process.version); // Current mylang2 version
coreio.print(process == system); // true
```

### **Memory Management**

Automatic resource management with defer statements:

```mylang2
func resourceManagement() {
  var resource = openResource();

  defer closeResource(resource); // Always executes on function exit

  // Resource utilization
  processResource(resource);

  if (someCondition) {
    return; // defer still executes before return
  }

  // Additional processing operations
}

// Defer expression
func readConfig(file) {
  var fd = fs.open(file, "r");

  return {
    content: fs.read(fd, bytes.Bytes(2048), 0, 2048, 0),
    [symbol.dispose]: func() {
      fs.close(fd);
    }
  }
}

var readFile = defer readConfig("./package.json");

coreio.print('File content:', readFile.content.buffer.toString());
```

### **`defer` and `symbol.dispose`**

`defer` registers work to run when the enclosing block ends — however it ends: normally,
through `return`, `break` or `continue`, through a thrown error, or because the task was
cancelled.

**Deferred work runs in reverse order.** A resource opened later is released first, so a
`defer` can always rely on what was set up before it:

```mylang2
func forward(path) {
  var file = defer fs.file(path, "r");          // closed second
  var socket = defer tcp.connect(host, port);   // closed first

  socket.write(file.readAll());
}
```

**Every registration runs, even when one of them fails.** A leaked resource is worse than
a lost error message, so a throwing `defer` does not stop the ones registered before it;
the first error is what propagates, and later ones are attached to it:

```mylang2
func f() {
  defer closeA();
  defer { throw "cleanup failed"; }    // does not stop closeA()
  defer closeC();
}
```

If the *body* failed, the body's error wins — a failure in cleanup never hides what
actually went wrong.

#### Releasing native resources

`defer <expression>` requires the value to carry `symbol.dispose`. Every built-in library
that owns something releasable sets it, so `defer` works the same way across all of them:

| Library | What `defer` releases |
| --- | --- |
| `fs` | `fs.file(...)` handles, `fs.Watcher(...)` |
| `fs/stream` | readable and writable streams (writable streams are flushed first) |
| `tcp` / `udp` / `ws` | sockets and servers |
| `net/http` | a listening server |
| `process` | a running child (it is killed) |
| `workers` | a worker thread (it is terminated) |

```mylang2
func fetch(host, port, request) {
  var socket = defer tcp.connect(host, port);

  socket.write(request);

  if (socket.ended()) { throw "the server hung up"; }

  return socket.readAll().toString();
  // the socket is released here, whichever of the two paths was taken
}
```

Every one of these resources also has an explicit `close()`, and closing is **idempotent**
— so an explicit `close()` followed by the `defer` is harmless, and the two styles mix
safely. Closing may suspend, so `wait spawn resource.close()` works too.

Your own values can join in by setting `symbol.dispose`:

```mylang2
func openPool(size) {
  var connections = connect(size);

  return {
    take: func() { return connections[0]; },
    [symbol.dispose]: func() { closeAll(connections); }
  };
}

func useThePool() {
  var pool = defer openPool(4);

  return pool.take();
}
```

A **struct** can own a resource the same way, which is the natural shape when the thing
being released belongs to an object with other behaviour. A struct body declares the
member directly, with the symbol in brackets where the method name would go:

```mylang2
import "core:fs";

struct Report {
  private var handle;
  var path;

  func init(file) {
    this.path = file;
    this.handle = fs.file(file, "w");
  }

  func line(text) { this.handle.write(text + "\n"); }

  func [symbol.dispose]() { this.handle.close(); }
}

func writeReport(file) {
  var report = defer Report(file);

  report.line("first");
  report.line("second");

  return report.path;
  // the handle is closed here, whichever way this returns
}
```

The disposer is an ordinary method of the struct: `this` is the instance, it may reach the
struct's `private` members (`this.handle` above is private), it may call the struct's other
methods, and it may suspend — closing a socket or flushing a file inside it is fine.

The caller only has to `defer` the struct; what the struct opened is its own business.

#### Symbol members of a struct

The brackets hold an expression, evaluated once per instance, and it must come out as one
of the language's two protocol symbols:

| Member | What it does |
| --- | --- |
| `func [symbol.dispose]()` | `defer Instance(...)` releases the instance through it |
| `func [symbol.iterator]()` | `for (x in instance)` walks the instance through it |

```mylang2
struct Countdown {
  var from;

  func [symbol.iterator]() {
    var current = this.from;

    return {
      next: func() {
        if (current <= 0) { return { done: true, value: nil }; }

        current--;

        return { done: false, value: current + 1 };
      }
    };
  }
}

var seen = [];

for (var n in Countdown(3)) { seen[length(seen)] = n; }
// seen is [3, 2, 1]
```

A symbol member is not a named one, so it is never listed by `for ... in` over the
instance's keys, never serialised by `json.stringify`, and cannot be marked `private` or
`static` — the parser refuses both, because a symbol is not a name `private` could hide and
a protocol belongs to the instance rather than to the type. Declaring the same symbol twice
in one struct is an error, and so is a bracketed name that is not a protocol symbol.

Assigning the member in `init` still works and means exactly the same thing, which is what
to reach for when the disposer is chosen at run time:

```mylang2
struct Handle {
  var kind;

  func init(kind) {
    this.kind = kind;

    if (kind == "noisy") {
      this[symbol.dispose] = func() { return "closed loudly"; };
    } else {
      this[symbol.dispose] = func() { return "closed quietly"; };
    }
  }
}
```

---

## Practical Examples

### **Web Server Implementation**

```mylang2
import (
  "coreio",
  "net/http",
  "fs",
);

var server = http.Server();

// Configure CORS for cross-origin requests
server.cors({
  origin: "*",
  methods: ["GET"],
});

// Serve static HTML content
server.get("/", func(ctx) {
  return ctx.send(fs.readFile("./index.html"), 200, { "Content-Type": "text/html; charset=utf-8" });
});

// Dynamic route with parameters
server.get("/user/:id", func (ctx) {
  return ctx.send({ userId: ctx.params.id });
});

// JSON API endpoint
server.get("/api", func (ctx) {
   return ctx.send(
       { status: "ok", message: "JSON works!" },
       200,
       { "Content-Type": "application/json" }
    );
});

// Echo endpoint for POST requests
server.post("/echo", func (ctx) {
    return ctx.send(
       { you_sent: ctx.body },
       200,
       { "Content-Type": "application/json" }
    );
});

// Data processing endpoint
server.post("/data", func (ctx) {
  return ctx.send({ got: ctx.body });
});

// Rate limiting configuration
server.rateLimit({
  windowMs: 1000,
  max: 100
});

// Start server with callback
server.listen(3000, func() {
   coreio.print("Server running on http://localhost:3000");
});
```

### **Data Processing Pipeline**

```mylang2
import "fs";
import "strings";
import "arrays";

func processData(filename) {
  try {
    var content = fs.readFile(filename, "utf8").toString();
    var lines = strings.split(content, "\n");
    var processed = arrays.map(lines, func(line) {
      return strings.trim(line);
    });
    return processed;
  } catch(err) {
    coreio.print("Error processing file:", err);
    return [];
  } finally {
    coreio.print("Processing completed");
  }
}
```

### **Custom Iterator**

```mylang2
func Range(start, endA) {
  return {
   [symbol.iterator]: func() {
      var current = start;
      var end = endA;

      return {
        next: func() {
          if (current >= end) {
            return { done: true, value: nil };
          }
          var value = current;
          current++;
          return { done: false, value: value };
        }
      };
    }
  }
}

var range = Range(0, 5);
for (var num in range) {
  coreio.print(num); // 0, 1, 2, 3, 4
}
```

### **Complete Example: Todo List Manager**

```mylang2
import "coreio";

struct Todo {
  var id;
  var title;
  var completed;

  func init(id, title) {
    this.id = id;
    this.title = title;
    this.completed = false;
  }

  func toggle() {
    this.completed = !this.completed;
  }

  func display() {
    var status = this.completed ? "✓" : "○";
    return $"{status} {this.title}";
  }
}

struct TodoList {
  var todos;
  var nextId;

  func init() {
    this.todos = [];
    this.nextId = 1;
  }

  func add(title) {
    var todo = Todo(this.nextId, title);
    this.todos[length(this.todos)] = todo;
    this.nextId += 1;
    return todo;
  }

  func remove(id) {
    var newTodos = [];
    for (var todo in this.todos) {
      if (todo.id != id) {
        newTodos[length(newTodos)] = todo;
      }
    }
    this.todos = newTodos;
  }

  func toggle(id) {
    for (var todo in this.todos) {
      if (todo.id == id) {
        todo.toggle();
        return true;
      }
    }
    return false;
  }

  func display() {
    coreio.print("\n=== Todo List ===");
    if (length(this.todos) == 0) {
      coreio.print("No todos yet!");
      return;
    }
    for (var todo in this.todos) {
      coreio.print($"{todo.id}. {todo.display()}");
    }
  }
}

// Usage
var list = TodoList();
list.add("Buy groceries");
list.add("Write code");
list.add("Exercise");
list.display();

list.toggle(2);
list.display();

list.remove(1);
list.display();
```

### **Everything together: a sandboxed log collector**

This one program uses most of what 2.2 added — `core:` imports, a struct with `private`
and `static` members, `defer` releasing four different kinds of resource, non-blocking
file and network work, a worker for the CPU-bound part, `validation` for untrusted input,
and `binary`, `compress` and `archive` for the data itself. Run it under a sandbox:

```bash
mylang run collector.ml \
  --allow-read=./logs \
  --allow-write=./out \
  --allow-net=127.0.0.1 \
  --allow-worker \
  --deny-process \
  --max-memory=256MB \
  --timeout=60s
```

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:json";
import "core:archive";
import "core:compress";
import "core:binary";
import "core:validation" as v;
import "core:tcp";
import "core:workers";
import "core:process";
import "core:time";

// ---------------------------------------------------------------- the shape

// Anything that arrives from outside is checked once, here, so the rest of the
// program can rely on it.
var entrySchema = v.object({
  level:   v.enumOf(["debug", "info", "warn", "error"], { fallback: "info", optional: true }),
  message: v.string({ min: 1, max: 2000 }),
  at:      v.integer({ min: 0, optional: true })
}, { strict: true });

// -------------------------------------------------------------- the collector

struct Collector {
  static var created = 0;        // on the type: shared by every instance

  private var entries;           // internal state, invisible from outside
  private var dropped;
  var name;

  func init(name) {
    this.name = name;
    this.entries = [];
    this.dropped = 0;

    Collector.created += 1;
  }

  // Only this struct may call it.
  private func record(entry) {
    this.entries[length(this.entries)] = entry;
  }

  func accept(raw) {
    var checked = v.check(entrySchema, raw);

    if (!checked.valid) {
      this.dropped += 1;
      return checked.errors;
    }

    this.record(checked.value);
    return nil;
  }

  func count() { return length(this.entries); }

  func rejected() { return this.dropped; }

  func toJSON() { return json.stringify(this.entries); }

  static func instances() { return Collector.created; }
}

// -------------------------------------------------------------- taking input

// A socket, and the server that produced it, are both released by `defer` —
// whichever way this function returns.
func collectFrom(port, collector, howMany) {
  var server = defer tcp.listen(port, "127.0.0.1");

  coreio.print($"listening on {server.port}");

  for (var i = 0; i < howMany; i++) {
    var client = defer server.accept();

    // messages are length-prefixed, so a partial read is never mistaken for a message
    var size = binary.reader(client.readExactly(4)).u32();
    var body = client.readExactly(size).toString();

    var problems = collector.accept(json.parse(body));

    client.write(problems == nil ? "ok" : json.stringify(problems));
    client.end();
  }

  return collector.count();
}

// --------------------------------------------------------------- the output

// Reading the existing logs does not block: while these are in flight the
// program keeps answering, which is why they are spawned.
func readExistingLogs(dir) {
  var jobs = [];

  for (var name in fs.readdir(dir)) {
    jobs[length(jobs)] = spawn fs.readFile(path.join(dir, name));
  }

  var contents = [];

  for (var job in jobs) {
    var done = wait job;

    if (done.status == "fulfilled") {
      contents[length(contents)] = done.result.toString();
    }
  }

  return contents;
}

func writeBundle(collector, existing, out) {
  var entries = [
    { name: "collected.json", data: collector.toJSON() }
  ];

  for (var i = 0; i < length(existing); i++) {
    entries[length(entries)] = { name: $"logs/{i}.log", data: existing[i] };
  }

  var bundle = archive.zip(entries, { level: 9 });   // deflate, without blocking

  fs.FSUtils().ensureDir(out);
  fs.writeFile(path.join(out, "bundle.zip"), bundle);

  return bundle;
}

// ------------------------------------------------------------------- the run

func main() {
  if (!process.can("net")) {
    coreio.print("no network permission; nothing to collect");
    return 1;
  }

  var collector = Collector("primary");

  // the worker computes on another thread while the program keeps serving
  var stats = defer workers.start("./summarise.ml", { data: 2000000 });

  var accepted = collectFrom(0, collector, 3);

  coreio.print($"accepted {accepted}, rejected {collector.rejected()}");
  coreio.print($"collectors created: {Collector.instances()}");

  var existing = readExistingLogs("./logs");
  var bundle = writeBundle(collector, existing, "./out");

  coreio.print($"bundle: {binary.sizeOf(bundle)} bytes");
  coreio.print($"compression: {compress.ratio(collector.toJSON(), compress.gzip(collector.toJSON()))}");
  coreio.print($"summary from the worker: {stats.result()}");

  return 0;
}

main();
// Every resource opened above — the server, each client socket and the worker —
// is released here, in reverse order, even if something threw along the way.
```

### **Everything together: a backup service**

Where the collector above shows the shape of 2.2, this one shows its *limits*. Every step
works on data larger than the memory the program is allowed — nothing here is ever held
whole — and the CPU work runs on a pool of threads created once rather than one per job:

```bash
mylang run backup.ml \
  --allow-read=./src \
  --allow-write=./out \
  --allow-process=cat,wc \
  --allow-worker \
  --max-memory=96MB \
  --timeout=120s
```

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:archive";
import "core:compress";
import "core:workers";
import "core:process";
import "core:tcp";

var SOURCE = "./src";
var OUT = "./out";

func main() {
  fs.FSUtils().ensureDir(OUT);

  // 1. Pack the tree straight onto disk. `archive.create` would build the whole
  //    archive as one value first, which a large tree cannot fit under the limit.
  var tarball = archive.createFile(SOURCE, path.join(OUT, "backup.tar"), "tar");

  coreio.print($"packed {fs.stat(tarball).size()} bytes");

  // 2. Compress it a piece at a time, for the same reason.
  var packed = path.join(OUT, "backup.tar.gz");
  var written = compress.file("gzip", tarball, packed);

  coreio.print($"compressed to {written} bytes");

  // 3. Hash every file on a pool of threads. The threads are created once, so the
  //    cost is paid once however many files follow.
  var pool = defer workers.pool("./hash.ml", workers.cpus());
  var jobs = [];

  for (var name in fs.readdir(SOURCE)) {
    var full = path.join(SOURCE, name);

    if (fs.stat(full).isFile()) { jobs[length(jobs)] = spawn pool.run(name) }
  }

  var digests = wait.all(jobs);

  coreio.print($"hashed {length(digests)} files on {pool.size} threads");

  // 4. Count the lines with a pipeline: each stage's output is the next one's input,
  //    so the stream passes through without anything collecting it.
  var counted = process.pipeline([
    ["cat", [path.join(SOURCE, "log1.txt"), path.join(SOURCE, "log2.txt")]],
    ["wc", ["-l"]]
  ]);

  coreio.print($"lines across two logs: {counted.stdout.toString()}");

  // 5. Serve the manifest over a unix socket - a file rather than a port, so it needs
  //    --allow-write for the path and no network permission at all.
  var sock = path.join(OUT, "backup.sock");
  var server = defer tcp.listenUnix(sock, { force: true });

  var serving = spawn {
    var client = server.accept();

    client.write($"{length(digests)} files, {written} bytes\n");
    client.end()
  }

  var client = defer tcp.connectUnix(sock);

  coreio.print("manifest says: " + client.readAll().toString());

  wait serving;

  // 6. Unpack it again, one entry at a time.
  compress.file("gunzip", packed, path.join(OUT, "roundtrip.tar"));

  var restored = archive.extractFile(
    path.join(OUT, "roundtrip.tar"),
    path.join(OUT, "restored")
  );

  coreio.print($"restored {length(restored)} files");

  return 0;
}

main();
// The pool, the server and both sockets are released here, in reverse order.
```

The worker it uses is a loop — one answer for every value received:

```mylang2
// hash.ml
import "core:crypto";
import "core:path";

for (;;) {
  var name = worker.receive();

  if (name == nil) { break; }

  // hashFile reads the file in pieces, so a 20 GB file costs no more than a small one
  worker.post({
    name: name,
    digest: crypto.hashFile(path.join("./src", name), "sha256")
  });
}
```

On an 82 MB tree of 20 MB files, this finishes under `--max-memory=96MB`. Swap
`archive.createFile` for `archive.create`, `compress.file` for `compress.gzip` and
`crypto.hashFile` for `crypto.hash(fs.readFile(...))`, and the same program needs 256 MB —
the tree, the archive and its compressed form all held at once.

The floor is set by the largest single *entry*, not by the archive: `extractFile` holds one
entry at a time, so unpacking a 20 GB archive of 1 MB files needs very little, while one
20 MB file inside it needs 20 MB. Archives written this way are ordinary archives — the
system `tar` and `unzip` read them, and a round trip comes back byte for byte.

---

## Cookbook

Whole tasks rather than single calls. Each one runs as it stands, and each shows the
command line it needs.

### Count what is in a directory, without reading it all

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:os";
import "core:objects";

var dir = path.join(os.tmpdir(), "mylang-cook-count");

fs.FSUtils().ensureDir(dir);
fs.writeFile(path.join(dir, "a.txt"), "aaa");
fs.writeFile(path.join(dir, "b.log"), "bbbbb");
fs.writeFile(path.join(dir, "c.txt"), "c");

var byExtension = {};
var bytes = 0;

for (var name in fs.readdir(dir)) {
  var full = path.join(dir, name);
  var info = fs.stat(full);

  if (!info.isFile()) { continue; }

  var ext = path.extname(name);

  if (!objects.hasOwnProperty(byExtension, ext)) { byExtension[ext] = 0; }

  byExtension[ext] += 1;
  bytes += info.size();
}

coreio.print("by extension:", byExtension);
coreio.print("total bytes:", bytes);

fs.FSUtils().removeDir(dir);
```

```bash
mylang run count.ml --allow-read=/tmp --allow-write=/tmp
```

`fs.stat` tells you the size without opening the file, so this costs nothing however large
the files are.

### Read several files at once

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:os";
import "core:time";

var dir = path.join(os.tmpdir(), "mylang-cook-parallel");

fs.FSUtils().ensureDir(dir);

for (var i = 1; i <= 4; i++) { fs.writeFile(path.join(dir, $"part{i}.txt"), $"contents {i}"); }

var watch = time.Stopwatch();

watch.start();

var jobs = [];

for (var name in fs.readdir(dir)) {
  jobs[length(jobs)] = spawn fs.readFile(path.join(dir, name))
}

var contents = wait.all(jobs);

watch.stop();

coreio.print("read", length(contents), "files in", watch.elapsed(), "ms");
coreio.print("first:", contents[0].toString());

fs.FSUtils().removeDir(dir);
```

`spawn` makes the reads overlap: each task parks while its file is being read and the
others run. The same shape works for requests, sockets or child processes.

### Retry something that might fail

```mylang2
import "core:coreio";
import "core:time";

func withRetries(attempts, pause, work) {
  var lastError = nil;

  for (var attempt = 1; attempt <= attempts; attempt++) {
    try {
      return work(attempt);
    } catch (e) {
      lastError = e;

      coreio.print($"attempt {attempt} failed");

      if (attempt < attempts) { time.Sleep(pause * attempt); }
    }
  }

  throw lastError;
}

var tries = 0;

var answer = withRetries(4, 50, func(attempt) {
  tries += 1;

  if (tries < 3) { throw "not yet"; }

  return $"succeeded on attempt {attempt}";
});

coreio.print(answer);
```

The wait grows with the attempt, and `time.Sleep` parks only this task — everything else
in the program keeps running while it backs off.

### Do several things and keep going when one fails

```mylang2
import "core:coreio";

var tasks = [];

for (var i = 1; i <= 4; i++) {
  tasks[length(tasks)] = spawn {
    if (i == 3) { throw $"item {i} is broken"; }

    return $"item {i} is fine";
  }
}

var done = 0;
var failed = 0;

for (var task in tasks) {
  var outcome = wait task;

  if (outcome.status == "fulfilled") {
    done += 1;
    coreio.print("ok:", outcome.result);
  } else {
    failed += 1;
    coreio.print("failed:", outcome.error);
  }
}

coreio.print($"{done} succeeded, {failed} failed");
```

`wait task` gives `{status, result, error, done, elapsed}` — `status` is `"fulfilled"` or
`"rejected"` — so one failure does not take the others with it. `wait.all([...])` is the
other shape: it hands back the results directly and raises on the first failure.

Note the `return` in that block. A `spawn` of an **expression** carries its value, but a
`spawn { ... }` **block** does not carry its last expression: it needs `return` for the
value to reach `wait`. A block without one is for the side effects, and its result is
`nil`.

### Walk a directory tree

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:os";
import "core:arrays";

var root = path.join(os.tmpdir(), "mylang-cook-walk");

fs.FSUtils().ensureDir(path.join(root, "a", "b"));
fs.writeFile(path.join(root, "top.txt"), "1");
fs.writeFile(path.join(root, "a", "mid.txt"), "2");
fs.writeFile(path.join(root, "a", "b", "deep.txt"), "3");

func walk(dir) {
  var found = [];

  for (var name in fs.readdir(dir)) {
    var full = path.join(dir, name);

    if (fs.stat(full).isDirectory()) {
      found = arrays.concat(found, walk(full));
    } else {
      found[length(found)] = full;
    }
  }

  return found;
}

for (var file in walk(root)) {
  coreio.print(path.relative(root, file));
}

fs.FSUtils().removeDir(root);
```

```bash
mylang run walk.ml --allow-read=/tmp --allow-write=/tmp
```

Recursion is bounded by memory rather than by a host stack here, so a deep tree does not
overflow.

### Hash every file in a directory, on every core

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:os";
import "core:workers";

var dir = path.join(os.tmpdir(), "mylang-cook-hash");

fs.FSUtils().ensureDir(dir);

for (var i = 1; i <= 6; i++) { fs.writeFile(path.join(dir, $"f{i}.bin"), $"contents of file {i}"); }

// the worker: a loop that answers one digest for every path it receives
fs.writeFile(path.join(dir, "hasher.ml"),
  "import \"core:crypto\";\n" +
  "for (;;) { var p = worker.receive(); if (p == nil) { break; } worker.post({ path: p, digest: crypto.hashFile(p, \"sha256\") }); }");

var pool = defer workers.pool(path.join(dir, "hasher.ml"), workers.cpus());

var jobs = [];

for (var name in fs.readdir(dir)) {
  if (path.extname(name) != ".bin") { continue; }

  jobs[length(jobs)] = spawn pool.run(path.join(dir, name))
}

var digests = wait.all(jobs);

coreio.print("hashed", length(digests), "files on", pool.size, "threads");
coreio.print("one of them:", digests[0]);

fs.FSUtils().removeDir(dir);
```

```bash
mylang run hashall.ml --allow-read=/tmp --allow-write=/tmp --allow-worker
```

`crypto.hashFile` reads in pieces, so this works on files far larger than the memory
limit; the pool creates its threads once however many files follow.

### Serve an API and call it from the same program

```mylang2
import "core:coreio";
import "core:net/http";
import "core:validation" as v;

var server = defer http.Server();
var created = [];

var newNote = v.object({
  title: v.string({ min: 1, max: 80 }),
  body: v.string({ max: 2000 })
});

server.get("/notes", func(ctx) { ctx.json({ notes: created }); });

server.post("/notes", func(ctx) {
  var result = v.check(newNote, ctx.body);

  if (!result.valid) { return ctx.status(400).json({ errors: result.errors }); }

  created[length(created)] = result.value.title;

  ctx.status(201).json({ created: result.value.title });
});

var where = server.listen(0, "127.0.0.1");
var client = http.Client({ baseURL: $"http://127.0.0.1:{where.port}" });

coreio.print("created:", client.post("/notes", { title: "first", body: "hello" }).json());

var rejected = client.post("/notes", { title: "", body: "hello" });

coreio.print("rejected:", rejected.status(), rejected.json());
coreio.print("all of them:", client.get("/notes").json());
```

```bash
mylang run api.ml --allow-net=127.0.0.1
```

### Back up a directory and check the result

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:os";
import "core:archive";
import "core:compress";
import "core:crypto";

var work = path.join(os.tmpdir(), "mylang-cook-backup");
var source = path.join(work, "src");

fs.FSUtils().ensureDir(source);

for (var i = 1; i <= 3; i++) { fs.writeFile(path.join(source, $"doc{i}.txt"), $"document {i}"); }

// pack and compress on disk: nothing holds the whole archive
var tarball = archive.createFile(source, path.join(work, "backup.tar"), "tar");
var packed = path.join(work, "backup.tar.gz");

compress.file("gzip", tarball, packed);

coreio.print("archive:", fs.stat(tarball).size(), "bytes");
coreio.print("compressed:", fs.stat(packed).size(), "bytes");
coreio.print("checksum:", crypto.hashFile(packed, "sha256"));

// and prove it comes back
compress.file("gunzip", packed, path.join(work, "check.tar"));

var restored = archive.extractFile(path.join(work, "check.tar"), path.join(work, "restored"));

coreio.print("restored:", restored);
coreio.print("doc2 says:", fs.readFile(path.join(work, "restored", "doc2.txt")).toString());

fs.FSUtils().removeDir(work);
```

```bash
mylang run backup.ml --allow-read=/tmp --allow-write=/tmp --max-memory=96MB
```

### Turn a shell pipeline into a program

```mylang2
import "core:coreio";
import "core:process";

// the shell's: printf ... | sort | uniq -c | sort -rn
var counted = process.pipeline([
  ["printf", ["error\nwarning\nerror\ninfo\nerror\n"]],
  ["sort"],
  ["uniq", ["-c"]],
  ["sort", ["-rn"]]
]);

coreio.print(counted.stdout.toString());

for (var stage in counted.stages) {
  coreio.print(stage.command, "exited", stage.code);
}
```

```bash
mylang run pipeline.ml --allow-process=printf,sort,uniq
```

Each stage's output goes straight into the next one's input, so this works on a stream far
larger than memory. Every stage is checked before anything starts.

### A producer and a consumer

```mylang2
import "core:coreio";
import "core:syncbox";
import "core:time";

var queue = syncbox.Chan(2);          // a small buffer, so the producer must wait

var producer = spawn {
  for (var i = 1; i <= 6; i++) {
    queue.send($"item {i}");
    coreio.print("produced item", i, "- buffered:", queue.len());
  }

  queue.close();

  return "produced";
}

var consumer = spawn {
  var handled = 0;

  for (;;) {
    var item = queue.recv();

    if (item == nil) { break; }

    time.Sleep(20);                   // slower than the producer, on purpose
    handled += 1;
  }

  return handled;
}

wait producer;

var count = wait consumer;

coreio.print("consumed", count.result, "items");
```

A full channel parks the producer rather than growing without bound, which is what makes
this safe when the consumer is the slower of the two.

### Watch a directory and react

```mylang2
import "core:coreio";
import "core:fs";
import "core:path";
import "core:os";
import "core:time";

var dir = path.join(os.tmpdir(), "mylang-cook-watch");

fs.FSUtils().ensureDir(dir);

var changes = [];
var watcher = defer fs.Watcher(dir, func(event) {
  changes[length(changes)] = event;
});

fs.writeFile(path.join(dir, "new.txt"), "hello");

time.Sleep(300);                      // give the host a moment to report it

coreio.print("changes seen:", length(changes) > 0);

fs.FSUtils().removeDir(dir);
```

```bash
mylang run watch.ml --allow-read=/tmp --allow-write=/tmp
```

### Read a binary format

```mylang2
import "core:coreio";
import "core:binary";
import "core:bytes";

// build a small framed message, then read it back the way a protocol would
var w = binary.writer();

w.u8(2);                              // version
w.u16(3);                             // how many records follow

for (var i = 1; i <= 3; i++) {
  var name = $"record{i}";

  w.u16(bytes.byteLength(name));
  w.string(name);
  w.u32(i * 1000);
}

var message = w.build();

coreio.print("message is", length(message), "bytes:", binary.hex(message));

var r = binary.reader(message);

coreio.print("version:", r.u8());

var count = r.u16();

for (var i = 0; i < count; i++) {
  var nameLength = r.u16();

  coreio.print("record:", r.string(nameLength), "value:", r.u32());
}

coreio.print("bytes left:", r.remaining());
```

No permissions: this is all inside the program. Over a socket it is the same code with
`readExactly` in front of it — read the fixed header, decode the length, read exactly that
many bytes.

### Make a program that adapts to its permissions

```mylang2
import "core:coreio";
import "core:process";
import "core:os";

var report = { features: [] };

func enable(name) { report.features[length(report.features)] = name; }

if (process.can("read", os.tmpdir())) { enable("reading the cache"); }
if (process.can("net", "api.example.com")) { enable("fetching updates"); }
if (process.can("process", "git")) { enable("reading the repository"); }
if (process.can("worker", "")) { enable("parallel hashing"); }

coreio.print("running with:", report.features);
coreio.print("sandboxed:", process.permissions().sandboxed);
```

```bash
mylang run adapt.ml
```

```bash
mylang run adapt.ml --allow-read=/tmp --allow-worker
```

The same program reports different features under the two command lines, without a single
refusal being raised — which is the point of asking first.

---

## 🧪 Testing

The test framework is a built-in library — `test` — and the suite that exercises this
repository is written in MyLang2 itself, with no JavaScript assertions anywhere.

```bash
mylang test                          # every *.test.ml under ./test
mylang test test/language            # one directory
mylang test test/library/fs.test.ml  # one file
mylang test --filter defer           # only tests whose name contains "defer"
mylang test --bail                   # stop at the first failure
mylang test --verbose                # print every test, not just the failures
```

From this repository you can also run the suite through its entry point, which imports
every file in a fixed order:

```bash
npm run testing                        # build, then run every test
node index.js                          # run again without rebuilding
MYLANG_TEST_VERBOSE=1 node index.js    # list every single test
NO_COLOR=1 node index.js               # plain output
```

Either way the process exits with code `1` when any test fails.

### Layout

| Path | Content |
| --- | --- |
| `test/index.ml` | entry point: imports every test file and prints the summary |
| `test/language/*.test.ml` | the language: literals, operators, control flow, structs, defer, permissions, … |
| `test/library/*.test.ml` | one file per built-in library |
| `test/fixtures/` | files used by the module, `fs`, `http`, permission and worker tests |
| [`library/test/README.md`](library/test/README.md) | the framework's own documentation |

### Writing a test

```mylang2
import "core:test" as { describe, test, beforeEach, assert, finish };
import "core:strings";

describe("strings", func() {
  test("toUpperCase", func() {
    assert.equal(strings.toUpperCase("abc"), "ABC");
  });

  test("errors can be checked", func() {
    assert.throws(func() { strings.toUpperCase(5); }, "must be of type string");
  });
});

finish("strings");
```

Assertions: `ok`, `notOk`, `isTrue`, `isFalse`, `isNil`, `notNil`, `equal` / `notEqual`
(strict and deep), `typeOf`, `closeTo`, `greater` / `less` (and `...OrEqual`), `lengthOf`,
`includes` / `notIncludes`, `throws`, `doesNotThrow`, `fail`. Hooks: `beforeEach`,
`afterEach`, `beforeAll`, `afterAll`. Use `skip("name", "reason")` for a known gap;
skipped tests stay visible in the summary.

### Tests can wait

A test body is an ordinary function, so it may `wait`, `spawn`, sleep, open sockets and
read files. That is what makes it possible to test the asynchronous libraries honestly
rather than mocking them:

```mylang2
test("the server answers", func() {
  var server = defer tcp.listen(0, "127.0.0.1");

  server.accept(func(client) {
    client.write("ok");
    client.close();
  });

  var socket = defer tcp.connect("127.0.0.1", server.port);

  assert.equal(socket.readAll().toString(), "ok");
});
```

### Notes for writing tests

- `assert.equal` is strict: `1` and `"1"` differ, unlike the language's loose `==`.
- An imported file is bound under its file name, so two test files must not share a name.
- The network tests start real servers on random loopback ports (`port 0`).
- Tests that need a particular permission policy run a child interpreter with those
  flags — see `test/language/permissions.test.ml`.

## 🎨 Formatting

```bash
mylang prettier --write            # format every .ml file in the project
mylang prettier --check            # for CI: exit 1 if anything is not formatted
mylang prettier src/app.ml         # print one file formatted
cat app.ml | mylang prettier --stdin
```

Settings live in the `"prettier"` section of `mylang.json` — `mylang init` writes them all
out — and a flag on the command line beats the file:

```json
{
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
    "ignore": ["node_modules/**", "mylang_modules/**", ".module/**", ".mylang/**", "dist/**", ".git/**"]
  }
}
```

The formatter changes only the space between tokens — indentation, spacing, blank lines,
quotes, and long lines broken at their commas — never a token itself, so a formatted
program does exactly what it did before. `--verify` re-lexes every result to prove it. It
reads, formats and writes each file as a stream, and rewrites a file through a temporary
copy only when something changed.

Everything about it — every option, the rules, the exit codes, how it fits CI — is in
[`prettier/README.md`](prettier/README.md).

---

## 📋 What changed

[`CHANGELOG.md`](CHANGELOG.md) covers 2.3 — the formatter, `--no-colors`, `symbol.dispose`
in a struct, member `++`, the finished `iter`, quiet servers and four fixes — and 2.2 in full: the language changes, the sandbox and
the five ways around it that were closed, the eleven new libraries, working on data larger
than memory, threads, the performance work, and the fixes.

---

## ⚡ Performance

[`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) measures where the interpreter spends its
time, explains the two costs that the design chooses to pay — walking a tree, and running
every node as a generator — and sets out what was changed, what it was worth, and what is
left. It ends with the things that actually make a program faster today.

The programs it measures are in [`perf/`](perf), so any of its numbers can be reproduced:

```bash
node dist/bin/index.js run perf/loop.ml
node --cpu-prof --cpu-prof-dir=prof dist/bin/index.js run perf/loop.ml
```

---

## Keeping the docs honest

Two checks in [`tools/`](tools) verify the documentation against the code:

```bash
npm run check:docs
```

It parses all 405 examples in this repository's markdown, checks 335 documented methods
against what their compiled form actually does — so a table cannot promise that a call
suspends when it does not — and verifies that every documented method exists at all.

```bash
npm run check:docs:run
```

That one **runs** every example that can run — 182 of them — because parsing proves an
example is the right language and only running it proves it is the right API. It found
eight signature mistakes in these documents that reading had not: arguments the wrong way
round, keys passed as a list where they are separate arguments, `recv` written as
`receive`, a `spawn` block expected to hand back its last expression. Each check exits
non-zero on a failure. See [`tools/`](tools) for what they can and cannot catch.

```bash
npm run check:prettier
npm run check:prettier:suite
```

The first formats every `.ml` file and every documented example two ways and proves the
formatter's promises on each: the same tokens come out, formatting twice changes nothing,
and the stream gives the same answer one byte at a time as all at once. The second then
formats a copy of the test suite and runs it. `npm run check` runs the first with the rest.

---

## 🤝 Contributing

We welcome contributions to MyLang2! Please see our contributing guidelines for more information.

## 📄 License

MyLang2 is released under the MIT License. See LICENSE file for details.
