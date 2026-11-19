import "core:coreio";
import "core:process";

try {
  process.run("node", ["-e", "console.log('hi')"]);
  coreio.print("process: ok");
} catch (e) {
  coreio.print(e);
  coreio.print("process: denied");
}
