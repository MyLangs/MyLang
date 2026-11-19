import "core:coreio";
var i = 0;
try {
  while (true) { i += 1; }
} catch (e) {
  coreio.print("caught the limit");
}
coreio.print("still running");
