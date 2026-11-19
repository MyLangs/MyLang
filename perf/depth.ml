import "core:coreio";
import "core:time";
// the same loop, but the variable lives further up the scope chain
var outer = 0;
func level1() {
  func level2() {
    func level3() {
      func level4() {
        var w = time.Stopwatch();
        w.start();
        for (var i = 0; i < 300000; i++) { outer += 1; }
        w.stop();
        coreio.print("300k writes to a variable 5 scopes up:", w.elapsed(), "ms");
      }
      level4();
    }
    level3();
  }
  level2();
}
level1();

var w2 = time.Stopwatch();
w2.start();
var local = 0;
for (var i = 0; i < 300000; i++) { local += 1; }
w2.stop();
coreio.print("300k writes to a local:", w2.elapsed(), "ms");
