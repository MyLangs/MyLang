// Run under various --allow-read policies by test/language/permissions.test.ml.
import "core:coreio";
import "core:fs";

try {
  fs.readFile("./test/fixtures/note.txt");
  coreio.print("inside: ok");
} catch (e) {
  coreio.print("inside: denied");
}

try {
  fs.readFile("./package.json");
  coreio.print("outside: ok");
} catch (e) {
  coreio.print("outside: denied");
}
