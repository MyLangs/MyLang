# Where the time goes

What makes MyLang2 slow, what was measured, what was changed, and what is left. Every
number here came from running the programs in this document on one machine; they are for
comparing one version of the interpreter against another, not for comparing machines.

How to reproduce any of it:

```bash
node dist/bin/index.js run perf/loop.ml                    # the timings
node --cpu-prof --cpu-prof-dir=prof dist/bin/index.js run perf/loop.ml   # the profile
```

---

## 1. The two costs built into the design

MyLang2 walks its syntax tree and runs every node as a generator. Both of those are
deliberate, and both cost something on every step.

### Walking the tree

There is no bytecode and no compilation step. `total += i` is not an instruction; it is an
`AssignmentExpression` node whose `evaluate` asks an `IdentifierLiteral` for a value, asks
a `BinaryExpression` to add, and asks the `Environment` to store the result. Each of those
is a method call through a generator, with the arguments passed as objects.

A bytecode VM turns that statement into a handful of array reads and an addition. The
tree-walker does the same work, but it rediscovers the *shape* of the statement every time
it runs it. In a loop that runs a million times, it rediscovers it a million times.

This is why the interpreter is in the range of tens of millions of simple operations per
second rather than hundreds of millions, and no amount of tuning inside this design
changes that. What tuning *can* do is remove work that is not the shape — and there was a
surprising amount of it.

### Generators

Every `evaluate` is a `function*`, and calls between them are `yield callee()`, driven by
`src/runtime/Trampoline.ts`. That is what makes the language's distinctive features
possible:

- **Recursion is bounded by memory, not by the host stack.** A language call pushes a
  frame on a heap array rather than on the JavaScript stack, so deep recursion does not
  overflow.
- **Any expression can suspend.** `socket.read()` parks the task mid-expression and
  resumes it later, which is why nothing in this language blocks and why `spawn` works
  without `async`/`await` colouring every function that might wait.
- **Cancellation runs cleanup.** A task can be unwound from outside, and every frame's
  `finally` runs, which is how `defer` and `symbol.dispose` survive a timeout.

The price is that `Trampoline.resume` is the single hottest function in any profile — about
a third of the time in a tight loop. That third is not waste: it is the dispatch loop that
makes the three properties above work. Removing it would mean giving them up.

---

## 2. What the profile showed

A million-iteration loop (`total += i`), profiled:

| | Before | After |
| --- | --- | --- |
| `Trampoline.resume` | 27.9% | 34.2% |
| garbage collector | **14.0%** | 9.4% |
| `Environment.update` | **7.7%** | — |
| `Scheduler.step` | 7.6% | 10.5% |
| `BlockStatement.evaluate` | 7.2% | 8.1% |
| `AssignmentExpression.evaluate` | 5.3% | 7.0% |
| `Environment.getEnvironmentWithKey` | 4.5% | 5.0% |
| `IntLiteral.evaluate` | 3.7% | — |
| `RegExp: [eE]` | **1.0%** | — |
| total | 1407 ms | 1031 ms |

The percentages rise for functions that were not touched; what matters is the total. Three
things in that first column should not have been there at all.

### A regular expression in the hot loop

`RegExp: [eE]` appearing in a profile of a program containing no regular expressions is a
clear sign of work in the wrong place. `IntLiteral.evaluate` was doing this:

```ts
*evaluate() {
  const cleanValue = this.value.replace(/_/g, "");     // every time
  const isBigInt = cleanValue.endsWith("n");           // every time
  const numStr = isBigInt ? cleanValue.slice(0, -1) : cleanValue;
  const isFloat = numStr.includes(".") || /[eE]/.test(numStr);   // every time
  ...
  return Number(numStr);                               // every time
}
```

The text of a literal is fixed when the program is parsed, so this can only ever reach the
same answer. The loop was parsing the number `1` from a string a million times. The fix is
to do it once, in the constructor, and have `evaluate` return the stored value.
`FloatLiteral` had the same shape.

### Every assignment rebuilt its scope

`Environment.update` ended with this:

```ts
return (matchedEnvironment.values = {
  ...matchedEnvironment.values,
  [key]: value,
});
```

Assigning to one variable rebuilt the entire table of variables in that scope. The cost
grew with the number of variables in scope, and every assignment allocated a fresh object
for the collector to clean up — which is most of what that 14% of GC time was.

Nothing read the return value, and nothing compared scope tables by identity; `clone` and
`combine` copy the table themselves, so a clone taken earlier is unaffected by a later
assignment. It became `matchedEnvironment.values[key] = value;`.

### Every block allocated a list it did not use

`BlockStatement.evaluate` began with `const deferenceCall: Deferred[] = []` and ended with
a flag snapshot object, whether or not the block contained a `defer`. A loop body is a
block, so that was two allocations per iteration to hold nothing. Both are now created
only when something is actually deferred.

---

## 3. What the changes were worth

Best of three runs, same machine:

| Program | Before | After | |
| --- | --- | --- | --- |
| 1,000,000 loop iterations with an addition | 1145 ms | **901 ms** | −21% |
| 300,000 three-deep member reads (`o.a.b.c`) | 536 ms | **431 ms** | −20% |
| 300,000 calls to a two-argument function | 850 ms | **673 ms** | −21% |
| 300,000 constant expressions (`2 * 3 + 4 * 5 - 6 / 2`) | 665 ms | **463 ms** | −30% |
| 300,000 writes to a variable five scopes up | 462 ms | 386 ms | −16% |
| 300,000 writes to a local | 374 ms | 313 ms | −16% |

All 1826 tests pass unchanged. None of these touched the architecture: they removed work
that was being repeated for no reason.

The lesson is worth stating plainly, because it is the useful one for anyone working on
this interpreter: **a tree-walker's real losses are usually not in the walking.** They are
in the per-node work that looks small, sits inside `evaluate`, and happens to run a million
times. Look for string handling, object spreads and allocations in anything named
`evaluate` before looking anywhere else.

---

## 4. What is left, and what it would cost

These are the remaining candidates, in the order of value for effort. None is implemented;
each is written down with what it would involve and what could go wrong.

### Constant folding in the parser — moderate gain, low risk

`2 * 3 + 4 * 5 - 6 / 2` is still eight nodes evaluated on every pass. The parser could
replace a `BinaryExpression` whose operands are both literals with a single literal, as far
up the tree as it folds. The measurement above says the ceiling for that program is the
difference between eight nodes and one.

The care needed: integer and float semantics must match what evaluation would have
produced, including `bigint`, division by zero and overflow. Fold only what is provably
identical, and leave the rest alone.

### Caching member lookups — moderate gain, moderate risk

`o.a.b.c` walks `src/runtime/members.ts` three times for every read, and that resolution is
the same work on every pass unless the object changed shape. A per-node cache keyed on the
value's shape would skip it.

The care needed: this interpreter deliberately resolves members by hand so that interpreted
code can never reach a JavaScript prototype (see *Native Member Access* in the main
README). A cache sits exactly on that boundary, so it must be invalidated by anything that
changes a value's members — and it must never turn a miss into a hit. Getting it wrong is a
security bug, not a performance bug.

### Resolving identifiers to slots — large gain, large change

`getEnvironmentWithKey` walks the scope chain by name on every read and write; five scopes
up costs measurably more than a local (386 ms against 313 ms above). A resolution pass
after parsing could turn each identifier into a (depth, index) pair, making a variable read
two array lookups.

The care needed: this changes how scopes are represented, which touches closures, `defer`'s
captured scope, `clone`, `combine`, structs and the module system. It is the largest single
win available without leaving the tree-walking design, and the one most likely to break
something subtle.

### Avoiding generators for leaf nodes — uncertain gain, high risk

A literal or an identifier read cannot suspend, so in principle those nodes need not be
generators at all, and the trampoline could call them directly. That would cut dispatch for
the most common nodes.

The care needed: "cannot suspend" has to be true for ever, in every path, including through
`members.ts` and any library member. One node that can suspend being treated as one that
cannot would produce a bug that appears only under concurrency. The honest assessment is
that this is not worth it unless a profile proves the dispatch of leaf nodes specifically
is the problem.

### What is not worth doing

- **Caching `shouldYield()`.** It is already a counter check against a budget.
- **Making `Trampoline.resume` cleverer.** Its three `typeof` checks per yield are already
  minimal, and the loop is the feature, not the overhead.
- **Threading the interpreter.** The single thread is what makes the scheduler's guarantees
  simple; `workers` exists for genuine parallelism.

---

## 5. Making a program faster today

None of the above helps a program that is already written. These things do:

**Use the library, not a loop.** Library methods are host code, so they run at host speed.
Summing 33 million bytes with `data.get(i)` in a MyLang loop took 62 seconds in a test;
anything the library can do in one call avoids the per-node cost entirely.

**Keep hot loops shallow.** A variable five scopes up costs more than a local on every
access, because the chain is walked by name. Pull what a loop touches into a local first.

**Use `spawn` for waiting, `workers` for computing.** `spawn` gives concurrency on one
thread: it helps when tasks wait on files, sockets or child processes, and not at all when
they compute. For computation, `workers.pool` uses the other cores — hashing 16 files on a
pool of four threads took 182 ms against 678 ms for a thread per file, and both beat doing
it in-process.

**Stream data rather than holding it.** `compress.file`, `compress.stream`,
`archive.extractFile`, `archive.createFile`, `crypto.hashFile` and `process.pipeline` work
on one piece at a time. An 82 MB tree packed, compressed, hashed and unpacked finished
under `--max-memory=96MB`; the whole-value equivalents needed 256 MB. Less memory also
means less collector time, so this is usually faster as well.

**Hand large buffers over instead of copying them.**
`worker.post(data, { transfer: true })` gives the memory to the other thread rather than
duplicating it — free however large the buffer is, at the cost of this side no longer
having it.

**Measure before changing anything.** `time.Stopwatch` for a timing, `--cpu-prof` for a
profile. Every improvement in section 3 was found by profiling and then verified by
measurement; none of them was where it would have been guessed.
