import "core:coreio";
import "core:time";
var w = time.Stopwatch();
w.start();
var s = "";
for (var i = 0; i < 30000; i++) { s += "abc"; }
w.stop();
coreio.print("30k string appends:", w.elapsed(), "ms ->", length(s), "chars");
var w2 = time.Stopwatch();
w2.start();
var parts = [];
for (var i = 0; i < 30000; i++) { parts[length(parts)] = "abc"; }
w2.stop();
coreio.print("30k array appends:", w2.elapsed(), "ms");
