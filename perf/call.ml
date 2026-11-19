import "core:coreio";
import "core:time";
func add(a, b) { return a + b; }
var w = time.Stopwatch();
w.start();
var total = 0;
for (var i = 0; i < 300000; i++) { total = add(total, 1); }
w.stop();
coreio.print("300k function calls:", w.elapsed(), "ms");
