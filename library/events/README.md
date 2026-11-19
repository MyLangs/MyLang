# `events`

Emitters, buses, signals and observables.

```ml
import "core:events";
```

## Suspension

Registering a listener returns immediately. Emitting runs the listeners, so emitting
suspends if a listener does.

| Type | Description |
| --- | --- |
| `events.EventEmitter()` | the classic `on` / `emit` pair |
| `events.EventBus()` | a shared emitter with namespaced topics |
| `events.Signal()` | one event, many listeners, typed |
| `events.Observable(producer)` | a stream of values with `subscribe` |
| `events.EventDispatcher()` | listeners with priorities and cancellation |

### `EventEmitter`

| Method | Suspends | Description |
| --- | --- | --- |
| `on(event, fn)` / `once(event, fn)` | — | add a listener |
| `off(event, fn)` / `removeAllListeners(event)` | — | remove listeners |
| `emit(event, …)` | with the listeners | notify everyone |
| `listenerCount(event)` / `eventNames()` | — | inspect |

## Examples

### An emitter

```ml
import "core:events";

var emitter = events.EventEmitter();

emitter.on("message", func(text) {
  coreio.print("got:", text);
});

emitter.emit("message", "hello");
```

### A listener that waits

Because `emit` runs listeners as part of the call, a listener that reads a file makes the
`emit` suspend — the emitter stays in step with its listeners:

```ml
emitter.on("saved", func(path) {
  var size = fs.stat(path).size();
  coreio.print(path, size);
});

emitter.emit("saved", "./out.txt");     // returns once the listener is done
```

To let a listener run on its own instead, spawn inside it:

```ml
emitter.on("saved", func(path) {
  spawn uploadInBackground(path);
});
```

### A bus between parts of a program

```ml
var bus = events.EventBus();

bus.subscribe("user:created", func(user) { sendWelcome(user); });
bus.subscribe("user:created", func(user) { addToSearchIndex(user); });

bus.publish("user:created", newUser);
```

### A signal

```ml
var ready = events.Signal();

ready.connect(func() { coreio.print("off we go"); });

setUpEverything();
ready.emit();
```

### An observable

```ml
var ticks = events.Observable(func(observer) {
  var timer = time.Interval(1000, func() { observer.next(time.now()); });

  return func() { timer.cancel(); };
});

var subscription = ticks.subscribe(func(at) { coreio.print(at); });

// later
subscription.unsubscribe();
```

## Notes

- `once` removes the listener after the first event, so it cannot fire twice.
- `EventDispatcher` is the one to reach for when order matters or a listener needs to stop
  the event reaching the others.
- A listener that throws does not stop the remaining listeners from running.
