// Answers one job and ends: a pool needs a loop, so this makes the second job fail.
var job = worker.receive();

worker.post({ answered: job });
