# `workers`

Running MyLang code on another thread.

```ml
import "core:workers";
```

The interpreter is single-threaded by design: `spawn` gives concurrency, not parallelism,
so one task that computes for a long time holds the thread. A worker is the answer to
exactly that case — the file runs on its own thread, with its own interpreter, and the two
sides exchange messages.

## Suspension

| Method | Suspends | Description |
| --- | --- | --- |
| `workers.start(file, options)` | — | run a file on another thread |
| `workers.pool(file, size, options)` | — | a fixed set of threads sharing a queue |
| `pool.run(value, options)` | yes | give one job to a free thread, park for its answer |
| `w.receive()` | yes | the next value the worker posted; `nil` once it has ended |
| `w.result()` | yes | park until the worker's program finishes, then its value |
| `w.close()` | yes | terminate the thread (idempotent) |
| `w.post(value, options)` | — | send a value to the worker |
| `pool.busy()` | — | how many threads are working |
| `pool.queued()` | — | how many jobs wait for a free thread |
| `pool.size` / `pool.file` / `pool.closed` | — | fields |
| `w.pending()` | — | values that arrived and are not taken yet |
| `w.running()` | — | is it still going? |
| `w.file` / `w.closed` | — | fields |

## Inside the worker file

A `worker` object is available without importing anything:

| Member | Suspends | Description |
| --- | --- | --- |
| `worker.data` | — | what `start` passed in |
| `worker.post(value, options)` | — | send a value back |
| `worker.receive()` | yes | the next value sent to this worker |
| `worker.pending()` | — | values waiting |

The value of the worker file's last expression becomes `w.result()`.

## Permissions

Starting a worker needs `--allow-worker`, and `--allow-read` for the file. The worker
**inherits the parent's whole policy**: a sandboxed program cannot widen its permissions
by starting a thread.

```
mylang run app.ml --allow-worker --allow-read=./workers
```

## What crosses the boundary

Plain data crosses, and so does `bytes`. A value carrying methods of its own — a socket, a
file handle, a function — does not, and sending one raises an error naming the problem.

Binary is **copied** by default, so the value stays usable on both sides. Passing
`{ transfer: true }` hands the memory over instead:

```ml
w.post(payload);                      // copied: both sides have it
w.post(payload, { transfer: true });  // handed over: this side no longer does
```

A transfer costs nothing however large the buffer is, which is the point of it — but the
sending side is left without the bytes, and any use of them afterwards says so rather than
answering as if the value were empty. Use it when the value is being given away; leave it
out when it is being shared.

A transfer is also quietly done as a copy for a small value that shares its block of
memory with others, since handing that block over would empty unrelated values with it. So
`{ transfer: true }` is a request: honoured where it saves something, ignored where it
would be unsafe.

## Pools

`workers.start` gives one thread per call, which is the wrong shape for many small jobs: a
thread costs several milliseconds to create and a few megabytes to keep, so starting one
per item spends more than the work. A pool creates its threads once and hands each one job
at a time:

```ml
var pool = defer workers.pool("./hash.ml", 4);

var tasks = [];
for (var file in files) { tasks[length(tasks)] = spawn pool.run(file) }

var hashes = wait.all(tasks);
```

A pool worker is written as a loop — one answer posted for every value received:

```ml
// hash.ml
import "core:crypto";

for (;;) {
  var job = worker.receive();

  if (job == nil) { break; }

  worker.post(crypto.hash("sha256", job));
}
```

`run(value)` sends a value, parks until that thread answers, and returns it, so it reads
like an ordinary call. Several of them in `spawn` tasks fill the pool without any of them
blocking the others; jobs beyond the thread count wait their turn in the order they
arrived. A worker that ends without answering is reported as exactly that, rather than
leaving the caller parked.

Each thread takes a slot counted against `--max-workers`, so the limit counts threads
rather than pools. A pool that cannot have all of its threads ends the ones it did start
before reporting, so a refusal leaves nothing running.

## Resources

A worker carries `symbol.dispose`, so `defer` guarantees the thread is not left running:

```ml
func compute(n) {
  var w = defer workers.start("./heavy.ml", { data: n });

  return w.result();
}
```

## Examples

### Offloading a long computation

`heavy.ml`:

```ml
var limit = worker.data;
var total = 0;

for (var i = 0; i < limit; i++) { total += i * i; }

func result() { return total; }
result();
```

The program that starts it keeps running while the worker computes:

```ml
import "core:workers";

var w = defer workers.start("./heavy.ml", { data: 50000000 });

var ticker = spawn {
  while (w.running()) {
    coreio.print("still working…");
    wait spawn time.Sleep(200);
  }
};

coreio.print("total:", w.result());
wait ticker;
```

### A worker that answers requests

`echo.ml`:

```ml
func run() {
  while (true) {
    var message = worker.receive();

    if (message == "stop") { return "finished"; }

    worker.post("echo: " + message);
  }
}
run();
```

```ml
var w = defer workers.start("./echo.ml");

w.post("one");
coreio.print(w.receive());

w.post("two");
coreio.print(w.receive());

w.post("stop");
coreio.print(w.result());
```

### One thread per chunk

When the work splits into as many pieces as there are cores, a thread each is the simplest
shape:

```ml
import "core:workers";

var threads = [];

for (var i = 0; i < workers.cpus(); i++) {
  threads[length(threads)] = workers.start("./chunk.ml", { data: chunks[i] });
}

var total = 0;

for (var w in threads) {
  total += w.result();
  w.close();
}
```

### A pool for many small jobs

When there are far more jobs than cores, a pool is both faster and simpler — the threads
are created once:

```ml
var pool = defer workers.pool("./hash.ml", workers.cpus());

var tasks = [];
for (var path in paths) { tasks[length(tasks)] = spawn pool.run(path) }

var digests = wait.all(tasks);

coreio.print(length(digests), "files hashed on", pool.size, "threads");
```

### Handing a large buffer to a thread

```ml
var frame = fs.readFile("./frame.raw");          // 40 MB

var w = defer workers.start("./encode.ml");

w.post(frame, { transfer: true });               // nothing is copied

var encoded = w.receive();
// `frame` is no longer available here: the thread has those bytes now
```

## Notes

- Messages are copied, not shared, unless `{ transfer: true }` is given for binary. A
  socket, a file handle or a function does not cross at all, and sending one raises an
  error naming the problem.
- A path-scoped grant crosses intact: a thread started under `--allow-read=./data` can
  read inside `./data` and nowhere else.
- A worker file that throws makes `w.result()` raise with that message.
- `workers.isWorker()` is `true` inside a worker and `false` on the main thread.
- `workers.cpus()` reports the useful parallelism of the machine; it needs `--allow-sys`.
