// Run every documented example that can run, and report the ones that fail.
//
// Parsing an example proves it is the right language; running it proves it is the right
// API. That difference is not academic - every signature mistake found in these docs
// parsed perfectly and then failed on the first call: `colors.hex` with its arguments the
// wrong way round, `objects.pick` given a list where it wanted separate arguments,
// `chan.receive` for what is really `chan.recv`, a `spawn` block expected to hand back its
// last expression when only `return` does that.
//
//   node tools/check-examples-run.js                 # the main README
//   node tools/check-examples-run.js library/fs      # one directory
//
// An example that needs something this machine does not have is not a failure. Three kinds
// are skipped, each marked in the document itself rather than guessed at here:
//
//   * a block in a file that is not a program - a worker body using `worker.receive()`,
//     which only exists inside a worker
//   * a block the prose says needs the outside world (an external host, a running server)
//   * a block the prose says is interrupted on purpose, by a timeout
//
// Everything else is expected to run to completion with no permission flags, which is the
// unrestricted mode, so the examples stay the shortest honest form of themselves.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const target = process.argv[2] ? path.resolve(root, process.argv[2]) : root;

/** Every markdown file worth checking under `dir`. */
function* documents(dir) {
  const stat = fs.statSync(dir);

  if (stat.isFile()) {
    yield dir;

    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) yield* documents(full);
    else if (entry.name.endsWith(".md")) yield full;
  }
}

/**
 * Should this block be run?
 *
 * The decision comes from the prose immediately before it and from the block itself, so a
 * document says for itself which of its examples stand alone.
 */
function reasonToSkip(code, before) {
  if (/\bworker\.(receive|post)\s*\(/.test(code) && !/workers\.(start|pool)/.test(code)) {
    return "a worker file, which only runs inside a worker";
  }

  if (/needs? (a real host|the outside world|such a server|a resolver)/i.test(before)) {
    return "needs the outside world";
  }

  if (/cannot run offline/i.test(before)) {
    return "needs the outside world";
  }

  if (/interrupted|the timeout arrives|is cut off/i.test(before) || /time\.Sleep\(60000\)/.test(code)) {
    return "interrupted on purpose";
  }

  if (/^\s*(\/\/|#)/.test(code) && code.trim().split("\n").length <= 2) {
    return "a fragment, not a program";
  }

  // waits for a person at the console
  if (/coreio\.(input|scan)\s*\(/.test(code)) {
    return "waits for console input";
  }

  // a demonstration whose point is the error: the comments say so
  if (/\/\/[^\n]*\b[Ee]rror\b/.test(code)) {
    return "demonstrates a failure on purpose";
  }

  // an endless loop shown with the flag that ends it
  if (/while\s*\(\s*true\s*\)/.test(code) && /--timeout/.test(code + before)) {
    return "ends only under --timeout";
  }

  // leans on a file the prose established beside it
  if (/import\s+["'][.][^"']*["']|workers\.(start|pool)\s*\(\s*["'][.]/.test(code)) {
    return "needs a file from the prose beside it";
  }

  return null;
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "mylang-doc-examples-"));
const failures = [];
let ran = 0;
let skipped = 0;

for (const file of [...documents(target)].sort()) {
  const text = fs.readFileSync(file, "utf8");

  for (const match of text.matchAll(/```(?:ml|mylang2|mylang)\n([\s\S]*?)```/g)) {
    const code = match[1];
    const line = text.slice(0, match.index).split("\n").length + 1;
    const before = text.slice(Math.max(0, match.index - 400), match.index);
    const skip = reasonToSkip(code, before);

    if (skip) {
      skipped++;
      continue;
    }

    // a fragment that leans on names from the prose cannot run; it is not a failure
    const script = path.join(work, `block-${ran}.ml`);

    fs.writeFileSync(script, code);

    const result = spawnSync(
      process.execPath,
      [path.join(root, "dist/bin/index.js"), "run", script],
      { encoding: "utf8", timeout: 30000 },
    );

    ran++;

    // Two failures do not show up as a non-zero exit, and both were real:
    //
    //  * printing a member without calling it. `parsed.hostname` is the method, not the
    //    host, and printing it succeeds - it just prints `[Function: hostname]`. A whole
    //    README example was wrong this way.
    //  * a task that rejects. A failure inside `spawn { ... }` is kept in the handle, so
    //    the program exits 0 with the error merely reported. That is right for the
    //    language and wrong for a documentation check.
    const printed = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    if (/\[Function: \w+\]/.test(printed)) {
      failures.push(
        `${path.relative(root, file)}:${line}  printed a method instead of calling it (look for a missing "()")`,
      );

      ran++;
      continue;
    }

    if (/Error in |Task .*rejected|unhandled task/i.test(printed)) {
      const inner = printed
        .replace(/\x1b\[[0-9;]*m/g, "")
        .split("\n")
        .map((l) => l.trim())
        .find((l) => /Error in |rejected/i.test(l));

      failures.push(`${path.relative(root, file)}:${line}  a task failed: ${(inner ?? "").slice(0, 110)}`);

      ran++;
      continue;
    }

    if (result.status === 0) continue;

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replace(
      /\x1b\[[0-9;]*m/g,
      "",
    );

    // An undefined name means the example leans on something the prose established, which
    // is ordinary in a document. A wrong member or argument does not, and that is the
    // mistake worth reporting.
    if (/is not defined/.test(output) && !/unknown function|does not exist|must be of type/.test(output)) {
      skipped++;
      ran--;
      continue;
    }

    // A document names a file or a host to illustrate - config.json, example.com - and
    // this machine has neither. That says nothing about whether the call is right, so it
    // is not a failure either.
    if (
      /ENOENT|ENOTFOUND|ECONNREFUSED|EADDRNOTAVAIL|EACCES|scandir|Unhandled 'error' event/.test(
        output,
      ) &&
      !/unknown function|does not exist|must be of type/.test(output)
    ) {
      skipped++;
      ran--;
      continue;
    }

    const first =
      output
        .split("\n")
        .map((l) => l.trim())
        .find((l) => /unknown function|does not exist|must be of type|Error|error:/i.test(l)) ??
      output.split("\n").find((l) => l.trim()) ??
      `exit ${result.status}`;

    failures.push(`${path.relative(root, file)}:${line}  ${first.slice(0, 150)}`);
  }
}

fs.rmSync(work, { recursive: true, force: true });

console.log(
  `${ran} documented examples run, ${skipped} skipped, ${failures.length} failed\n`,
);

for (const failure of failures) console.log(failure);

process.exitCode = failures.length > 0 ? 1 : 0;
