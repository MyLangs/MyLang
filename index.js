const fs = require("fs");
const path = require("path");
const { run } = require("./dist/src/utils/utils");

// Runs the MyLang test suite (test/index.ml). The tests are written in MyLang
// itself; this file only starts the interpreter. The suite ends the process with
// exit code 1 when a test fails.
const mainFileDir = path.join(__dirname, "test");
const mainFilePath = path.join(__dirname, "test", "index.ml");
const mainFileContent = fs.readFileSync(mainFilePath, "utf-8");

(async () => {
  try {
    await run(mainFileContent, {
      main: mainFilePath,
      base: mainFileDir,
    });
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
  }
})();
