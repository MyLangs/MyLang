// Prove the formatter's promises on everything in this repository.
//
//   node tools/check-prettier.js               every .ml file and every documented example
//   node tools/check-prettier.js --run-suite   ...then format a copy of the test suite and run it
//
// For each source, under the default settings and under a deliberately unusual set (tabs,
// single quotes, a 40-column width, no blank lines, CRLF), it checks that:
//
//   - the result lexes to exactly the same tokens as the original (nothing but whitespace moved)
//   - formatting the result again changes nothing (idempotent)
//   - streaming the source one byte at a time, and seven at a time, gives the same result
//     as formatting it whole (no token is ever split by a chunk boundary)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const { formatText, createFormatStream } = require(path.join(root, "dist/prettier/index"));
const { verifyEquivalent } = require(path.join(root, "dist/prettier/cli"));
const { DEFAULT_OPTIONS } = require(path.join(root, "dist/prettier/options"));
const { Lexer } = require(path.join(root, "dist/src/lexer/Lexer"));

const UNUSUAL = {
  ...DEFAULT_OPTIONS,
  quote: "single",
  useTabs: true,
  printWidth: 40,
  bracketSpacing: false,
  maxBlankLines: 0,
  endOfLine: "crlf",
};

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

function sources() {
  const out = [];

  for (const file of files(root)) {
    const name = path.relative(root, file);

    if (file.endsWith(".ml")) out.push([name, fs.readFileSync(file, "utf8")]);

    if (file.endsWith(".md")) {
      const text = fs.readFileSync(file, "utf8");
      let index = 0;

      for (const match of text.matchAll(/```(ml|mylang2|mylang)\n([\s\S]*?)```/g)) {
        out.push([`${name} (example ${++index})`, match[2]]);
      }
    }
  }

  return out;
}

function streamed(text, size, options) {
  return new Promise((resolve, reject) => {
    const stream = createFormatStream(options);
    let out = "";

    stream.on("data", (chunk) => (out += chunk));
    stream.on("end", () => resolve(out));
    stream.on("error", reject);

    const bytes = Buffer.from(text);

    for (let i = 0; i < bytes.length; i += size) stream.write(bytes.subarray(i, i + size));

    stream.end();
  });
}

async function main() {
  const all = sources();
  const failures = [];
  let checked = 0;
  let skipped = 0;

  for (const [name, source] of all) {
    // a source the language itself refuses (a fixture that is meant to fail) proves nothing
    if (new Lexer(source).analyze().errors.length > 0) {
      skipped++;
      continue;
    }

    checked++;

    for (const [label, options] of [["default", DEFAULT_OPTIONS], ["unusual", UNUSUAL]]) {
      let formatted;

      try {
        formatted = formatText(source, options);
      } catch (error) {
        failures.push(`${name} [${label}]: threw ${error.message}`);
        continue;
      }

      const problem = verifyEquivalent(source, formatted);

      if (problem) failures.push(`${name} [${label}]: ${problem}`);

      if (formatText(formatted, options) !== formatted) {
        failures.push(`${name} [${label}]: formatting twice is not the same as once`);
      }

      for (const size of [1, 7]) {
        if ((await streamed(source, size, options)) !== formatted) {
          failures.push(`${name} [${label}]: streamed in ${size}-byte pieces differs`);
          break;
        }
      }
    }
  }

  console.log(`${checked} sources checked twice each, ${skipped} skipped (refused by the lexer), ${failures.length} problems\n`);

  for (const failure of failures) console.log(failure);

  if (failures.length > 0) process.exitCode = 1;

  if (process.argv.includes("--run-suite") && failures.length === 0) runSuite();
}

/** Copy the project, format its test suite, and run the suite there. */
function runSuite() {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "mylang-prettier-suite-"));

  console.log(`formatting a copy of the test suite in ${copy} and running it...`);

  fs.cpSync(root, copy, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules`) && !source.includes(`${path.sep}.git`),
  });
  fs.symlinkSync(path.join(root, "node_modules"), path.join(copy, "node_modules"));

  const cli = path.join(copy, "dist/bin/index.js");
  const targets = ["test/language", "test/library", "test/integration", "test/tools", "test/index.ml"];

  // the formatter's own fixtures are meant to be unformatted, so they are left as they are
  execFileSync("node", [cli, "prettier", ...targets, "--write", "--no-config", "--no-colors"], {
    cwd: copy,
    stdio: "inherit",
  });

  execFileSync("node", ["index.js"], { cwd: copy, stdio: "inherit", env: { ...process.env, NO_COLOR: "1" } });

  fs.rmSync(copy, { recursive: true, force: true });
}

main();
