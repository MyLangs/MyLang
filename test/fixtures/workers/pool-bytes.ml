// Reports what it received, which lets a test check that bytes survive the crossing.
import "core:bytes";

for (;;) {
  var job = worker.receive();

  if (job == nil) { break; }

  worker.post({ size: job.length, isBytes: bytes.is(job), first: job.get(0) });
}
