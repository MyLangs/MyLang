# `runtime`

The scheduler that runs tasks.

```ml
import "core:runtime";
```

The language's `spawn` and `wait` cover almost everything; this module is for the cases
where you want to control *when* a task runs rather than just that it does.

## Suspension

| Method | Suspends | Description |
| --- | --- | --- |
| `runtime.go(fn)` | — | start a task, like `spawn` |
| `runtime.schedule(fn)` | — | queue a task to run after the current one yields |
| `runtime.scheduleFirst(fn)` | — | queue it ahead of the others |
| `runtime.scheduleDelayed(ms, fn)` | — | queue it after a delay |
| `runtime.scheduleRepeating(ms, fn)` | — | queue it again and again |
| `runtime.waitForIdle()` | yes | park until every queued task has run |
| `runtime.Spawn` / `runtime.Scheduler` | — | the underlying types |

## The model

The interpreter is single-threaded and uses no threads of its own. Every `spawn` is a
*task*: a coroutine the scheduler runs until it suspends — on `wait`, on a sleep, on a
channel, or on anything that waits for the host. Tasks take turns, so they are concurrent
without ever racing over memory.

A task also yields when its time slice runs out, so a long loop in one task does not
starve the others.

For real parallelism — work that should use another core — use `workers`.

## Examples

### Waiting for everything to settle

```ml
import "core:runtime";

for (var job in jobs) { spawn handle(job); }

runtime.waitForIdle();

coreio.print("all done");
```

### Running something after the current work

```ml
runtime.schedule(func() {
  coreio.print("this runs once the current task yields");
});
```

### A repeating background job

```ml
var stop = runtime.scheduleRepeating(5000, func() {
  refreshCache();
});

// later
stop();
```

## Notes

- `spawn` in the language and `runtime.go` do the same thing; the keyword is usually
  clearer.
- `waitForIdle` is useful at the end of a program or a test, where you want every spawned
  task to have finished before reporting.
