# `time`

Dates, durations, stopwatches, sleeping and timers.

```ml
import "core:time";
```

## Suspension

| Method | Suspends | Description |
| --- | --- | --- |
| `time.Sleep(ms)` | yes | pause this task; other tasks keep running |
| `time.Delay(ms, fn)` | — | run `fn` later, returning at once |
| `time.Timeout(ms, fn)` | — | a cancellable one-shot timer |
| `time.Interval(ms, fn)` | — | a repeating timer |
| `time.Debounce(ms, fn)` | — | run `fn` once the calls stop |
| `time.Throttle(ms, fn)` | — | run `fn` at most once per interval |
| `time.now()` | — | the current moment |
| `time.DateTime(…)` | — | a point in time |
| `time.Duration(…)` | — | a span of time |
| `time.Stopwatch()` | — | measure elapsed time |
| `time.TimeZone(name)` / `time.TimeZones` | — | zones |
| `time.TimeUtils()` | — | formatting and parsing helpers |

`time.Sleep` parks the task; it never blocks the thread. That is why a sleeping task does
not stop a server from answering:

```ml
var slow = spawn {
  wait spawn time.Sleep(5000);
  coreio.print("five seconds later");
};

keepServing();      // runs the whole time
wait slow;
```

## Examples

### Waiting without blocking

```ml
import "core:time";

for (var attempt = 0; attempt < 5; attempt++) {
  if (tryConnect()) { break; }

  time.Sleep(1000 * (attempt + 1));     // backing off, other tasks unaffected
}
```

### Timing something

```ml
var watch = time.Stopwatch();

watch.start();
doTheWork();
watch.stop();

coreio.print($"took {watch.elapsed()}ms");
```

### Dates

```ml
var now = time.now();
var later = now.add(time.Duration({ hours: 3 }));

coreio.print(now.format("YYYY-MM-DD HH:mm:ss"));
coreio.print(later.isAfter(now));          // true
```

### A repeating job

```ml
var timer = time.Interval(60000, func() {
  coreio.print("still alive");
});

// later
timer.cancel();
```

### Debouncing

```ml
var save = time.Debounce(300, func() { writeToDisk(); });

for (var key in keystrokes) { save(); }    // writes once, 300ms after the last key
```

## Notes

- Timers run on the interpreter's scheduler, so a callback is an ordinary task: it can
  `wait`, `spawn` and sleep like any other code.
- `time.Sleep(0)` yields to other ready tasks without waiting.
- For measuring, `Stopwatch` is steadier than subtracting two `now()` values, which can
  move when the system clock does.
