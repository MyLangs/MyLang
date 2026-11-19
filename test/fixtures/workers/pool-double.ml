// A pool worker: a loop that answers one value for every value it receives.
for (;;) {
  var job = worker.receive();

  if (job == nil) { break; }

  worker.post({ seen: job, doubled: job * 2 });
}
