import "core:coreio";
import "core:time";
var w = time.Stopwatch();
w.start();
var total = 0;
for (var i = 0; i < 300000; i++) { total += 2 * 3 + 4 * 5 - 6 / 2; }
w.stop();
coreio.print("300k constant expressions:", w.elapsed(), "ms");
