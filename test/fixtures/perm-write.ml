import "core:coreio";
import "core:fs";

try {
  fs.writeFile("./test/fixtures/perm-tmp.txt", "x");
  fs.unlink("./test/fixtures/perm-tmp.txt");
  coreio.print("write: ok");
} catch (e) {
  coreio.print("write: denied");
}
