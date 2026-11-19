// Run on another thread by test/library/workers.test.ml.
import "core:coreio";

var limit = worker.data;
var total = 0;

for (var i = 0; i < limit; i++) { total += i; }

func result() { return total; }
result();
