import "core:coreio";
import "core:time";
var o = { a: { b: { c: 7 } } };
var w = time.Stopwatch();
w.start();
var total = 0;
for (var i = 0; i < 300000; i++) { total += o.a.b.c; }
w.stop();
coreio.print("300k three-deep member reads:", w.elapsed(), "ms");
