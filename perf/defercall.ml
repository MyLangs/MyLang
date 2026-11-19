import "core:coreio";
import "core:time";
import "core:fs";
import "core:path";
import "core:os";

var file = path.join(os.tmpdir(), "mylang-perf.txt");
fs.writeFile(file, "x");

func withDefer() { var h = defer fs.file(file, "r"); return 1; }
func withClose() { var h = fs.file(file, "r"); h.close(); return 1; }

var w = time.Stopwatch();
w.start();
var t = 0;
for (var i = 0; i < 3000; i++) { t += withDefer(); }
w.stop();
coreio.print("3k calls with defer:", w.elapsed(), "ms");

var w2 = time.Stopwatch();
w2.start();
var t2 = 0;
for (var i = 0; i < 3000; i++) { t2 += withClose(); }
w2.stop();
coreio.print("3k calls with an explicit close:", w2.elapsed(), "ms");
