# `perf`

The programs behind the numbers in [`docs/PERFORMANCE.md`](../docs/PERFORMANCE.md).

| File | What it measures |
| --- | --- |
| `loop.ml` | a million loop iterations with an addition |
| `member.ml` | three-deep member reads (`o.a.b.c`) |
| `call.ml` | calls to a two-argument function |
| `const.ml` | constant expressions that could be folded |
| `depth.ml` | a write to a local against one five scopes up |
| `defercall.ml` | the cost `defer` adds to a call |
| `strings.ml` | growing a string against growing an array |

Each prints a timing taken with `time.Stopwatch`:

```bash
node dist/bin/index.js run perf/loop.ml
```

For a profile of where that time went:

```bash
node --cpu-prof --cpu-prof-dir=prof dist/bin/index.js run perf/loop.ml
```

These are for comparing one build of the interpreter against another on one machine. They
are not a benchmark suite, and the absolute numbers mean nothing across machines. Run each
a few times and take the best: the first run pays for loading the interpreter.
