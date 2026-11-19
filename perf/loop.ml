import "core:coreio";
import "core:time";
var w = time.Stopwatch();
w.start();
var total = 0;
for (var i = 0; i < 1000000; i++) { total += i; }
w.stop();
coreio.print("1M loop iterations:", w.elapsed(), "ms ->", total);
