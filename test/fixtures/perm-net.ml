import "core:coreio";
import "core:tcp";

try {
  var server = tcp.listen(0, "127.0.0.1");
  server.close();
  coreio.print("net: ok");
} catch (e) {
  coreio.print("net: denied");
}
