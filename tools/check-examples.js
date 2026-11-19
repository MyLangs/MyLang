// Parse every code example in every README and in docs/, and report the ones that do not
// parse. A documented example that cannot even be read by the interpreter is worse than no
// example, and this is cheap enough to run on every change.
//
//   node tools/check-examples.js
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { Lexer } = require(path.join(root, "dist/src/lexer/Lexer"));
const { Parser } = require(path.join(root, "dist/src/ast/Parser"));

/** Every markdown file worth checking: the main README, the libraries', and docs/. */
function* documents(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) yield* documents(full);
    else if (entry.name.endsWith(".md")) yield full;
  }
}

const failures = [];
let blocks = 0;

for (const file of [...documents(root)].sort()) {
  const text = fs.readFileSync(file, "utf8");

  // fenced blocks tagged as this language
  for (const match of text.matchAll(/```(ml|mylang2|mylang)\n([\s\S]*?)```/g)) {
    const code = match[2];
    const line = text.slice(0, match.index).split("\n").length + 1;

    blocks++;

    try {
      const lexed = new Lexer(code).analyze();

      if (lexed.errors.length > 0) {
        failures.push(`${path.relative(root, file)}:${line}  (lex) ${lexed.errors[0].message}`);
        continue;
      }

      new Parser(lexed.tokens).parse();
    } catch (error) {
      const message = String((error && error.message) || error).split("\n")[0];

      failures.push(`${path.relative(root, file)}:${line}  (parse) ${message}`);
    }
  }
}

console.log(`${blocks} documented examples checked, ${failures.length} do not parse\n`);

for (const failure of failures) console.log(failure);

process.exitCode = failures.length > 0 ? 1 : 0;
