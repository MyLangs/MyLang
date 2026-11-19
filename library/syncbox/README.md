# `syncbox`

Channels for passing values between tasks.

```ml
import "core:syncbox";
```

Tasks started with `spawn` share the interpreter's single thread, so they never race over
memory — but they still need a way to hand work to each other and to wait for results. A
channel is that way.

## Suspension

| Method | Suspends | Description |
| --- | --- | --- |
| `syncbox.Chan(capacity)` | — | create a channel; `0` is unbuffered |
| `chan.send(value)` | yes | hand over a value, parking while the channel is full |
| `chan.recv()` | yes | take a value, parking while the channel is empty |
| `chan.tryRecv()` | — | take a value or `nil`, never parking |
| `chan.trySend(value)` | — | hand over a value if there is room; `false` if not |
| `chan.close()` | — | no more values will be sent |
| `chan.len()` | — | values buffered right now |
| `chan.cap()` | — | how many it can buffer |
| `chan.isClosed()` | — | has it been closed? |

Sending and receiving park only the task that asked, so every other task keeps running.
That is what makes a producer and a consumer able to run at the same time:

```ml
var jobs = syncbox.Chan(10);

var producer = spawn {
  for (var i = 0; i < 100; i++) { jobs.send(i); }
  jobs.close();
};

var consumer = spawn {
  while (true) {
    var job = jobs.recv();
    if (job == nil) { break; }
    handle(job);
  }
};

wait producer;
wait consumer;
```

## Examples

### A worker pool

```ml
import "core:syncbox";

var jobs = syncbox.Chan(0);
var results = syncbox.Chan(0);

for (var w = 0; w < 4; w++) {
  spawn {
    while (true) {
      var job = jobs.recv();
      if (job == nil) { break; }
      results.send(handle(job));
    }
  }
}

var feeding = spawn {
  for (var job in allJobs) { jobs.send(job); }
  jobs.close();
}

for (var i = 0; i < length(allJobs); i++) {
  coreio.print(results.recv());
}
```

### Signalling that something is done

```ml
var ready = syncbox.Chan(0);

var setup = spawn {
  setUpEverything();
  ready.send(true);
}

ready.recv();      // parks until the setup is finished
coreio.print("ready");
```

### Taking what is there without waiting

```ml
var pending = chan.tryRecv();

if (pending == nil) {
  coreio.print("nothing queued");
}
```

## Notes

- An unbuffered channel (`Chan(0)`) hands the value over directly: the sender parks until
  a receiver takes it. A buffered one lets the sender run ahead by `capacity` values.
- `recv()` on a closed, empty channel returns `nil`; that is the usual way to end a
  consumer loop.
- A channel passes values between tasks in one program. To cross threads, use `workers`,
  where messages are copied rather than shared.
