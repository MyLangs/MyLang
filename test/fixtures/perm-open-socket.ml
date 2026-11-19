// Holds an open server and then spins: the program must still end promptly when its
// time limit fires, even though a resource is still open.
import "core:coreio";
import "core:tcp";

var server = defer tcp.listen(0, "127.0.0.1");

coreio.print("listening");

var i = 0;
while (true) { i += 1; }
