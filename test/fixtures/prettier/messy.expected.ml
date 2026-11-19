// A file written without any care for layout.
import "core:coreio";
var total = 0;
func add(a, b) {
  return a + b;
}

struct Point {
  var x;
  var y;
  func [symbol.dispose]() { coreio.print("bye"); }
}
for (var i = 0; i < 3; i++) { total += add(i, -1); }
var o = { a: 1, b: [1, 2, 3], c: { d: true } };
var flag = total > 2 ? "big" : "small";
o.a++;
var text = $"total={total}";
if (!flag) { coreio.print("never") } else { coreio.print(text) }

coreio.print(o?.c.d, typeof o.a + "!");
