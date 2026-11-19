import { colorsEnabled } from "../../src/output/colors";
/**
 * `mylang test` - discover and run MyLang test files.
 *
 *   mylang test                      every *.test.ml under ./test (or ./tests, or .)
 *   mylang test path/to/file.test.ml a single file
 *   mylang test ./suite              every *.test.ml under that directory
 *   mylang test --filter auth        only tests whose full name contains "auth"
 *
 * Each file runs in its own interpreter, in order, and the totals are aggregated by the
 * `test` library (which keeps them in one place for the whole process). The process exits
 * with code 1 when anything failed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { run as runFile } from "../../src/utils/utils";
import { state as testState } from "../../library/test/state";
import { security } from "../../src/security";

const TEST_SUFFIX = ".test.ml";
const DEFAULT_DIRS = ["test", "tests", "spec"];
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".module",
  ".mylang",
  "dist",
]);

interface TestOptions {
  filter?: string;
  verbose?: boolean;
  bail?: boolean;
  color?: boolean;
  reporter?: string;
  /** How many files to run at once; 1 (the default) runs them in order. */
  jobs?: number | string;
}

/** What one worker reports back about the file it ran. */
interface WorkerResult {
  relative: string;
  output: string[];
  failure: string | null;
  passed: number;
  failed: number;
  skipped: number;
  failures: Array<{ name: string; error: string; file: string }>;
  skips: Array<{ name: string; reason: string; file: string }>;
}

/** The compiled worker, next to this file in `dist`. */
const TEST_WORKER = path.join(__dirname, "testWorker.js");

/** How many files to run at once, from `--jobs` and what the machine can do. */
function resolveJobs(
  requested: number | string | undefined,
  files: number,
): number {
  if (requested === undefined) return 1;

  const asked = String(requested).trim().toLowerCase();
  // Test files spend much of their time waiting on files and sockets, not on the CPU, so
  // a thread per core is a floor rather than a ceiling: two threads help even on a
  // two-core machine. The cap keeps a large machine from spawning more than the work needs.
  const wanted =
    asked === "auto" || asked === ""
      ? Math.max(2, Math.min(os.cpus().length, 8))
      : Number(asked);

  if (!Number.isInteger(wanted) || wanted < 1) {
    throw new Error(
      `--jobs expects a positive whole number or "auto", received "${requested}"`,
    );
  }

  return Math.max(1, Math.min(wanted, files));
}

/**
 * The parent's policy, in the plain shape a worker can rebuild it from.
 *
 * A test run in a worker is restricted exactly as the run that started it: the grants are
 * handed over as they stand, paths and hosts included. The counts are per-thread, since
 * each thread has its own files and sockets open.
 */
function exportPolicy(): Record<string, any> {
  return {
    permissions: security.permissions.serialize(),
    limits: {
      maxMemory: security.limits.maxMemory,
      timeout: security.limits.timeout,
    },
    counts: security.counters.serialize(),
  };
}

/** Every `*.test.ml` below `dir`, sorted so runs are reproducible. */
function collect(dir: string, found: string[] = []): string[] {
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;

      collect(full, found);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(TEST_SUFFIX)) found.push(full);
  }

  return found;
}

/** Work out which files a target refers to. */
function resolveTargets(target: string | undefined): string[] {
  if (target) {
    const full = path.resolve(process.cwd(), target);

    if (!fs.existsSync(full)) {
      throw new Error(`No such test target: ${target}`);
    }

    return fs.statSync(full).isDirectory() ? collect(full) : [full];
  }

  for (const candidate of DEFAULT_DIRS) {
    const full = path.resolve(process.cwd(), candidate);

    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      const files = collect(full);

      if (files.length > 0) return files;
    }
  }

  return collect(process.cwd());
}

function paint(text: string, color: string): string {
  if (!testState.color) return text;

  const codes: Record<string, string> = {
    red: "\x1b[31m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
  };

  return `${codes[color] ?? ""}${text}\x1b[0m`;
}

/** Run every selected test file, print the summary, and return the number of failures. */
async function runTests(
  target: string | undefined,
  options: TestOptions = {},
): Promise<number> {
  const files = resolveTargets(target);

  testState.reset();
  testState.underRunner = true;
  testState.verbose = Boolean(options.verbose);
  testState.bail = Boolean(options.bail);
  testState.color = options.color !== false && colorsEnabled();
  testState.filter = options.filter ?? null;

  if (files.length === 0) {
    console.log(`No ${TEST_SUFFIX} files found.`);
    return 0;
  }

  const jobs = resolveJobs(options.jobs, files.length);

  console.log("");
  console.log(
    paint(
      `Running ${files.length} test file${files.length === 1 ? "" : "s"}` +
        (jobs > 1 ? ` on ${jobs} threads` : ""),
      "cyan",
    ),
  );

  // More than one job at a time means the files run in workers. Each worker reports its
  // own counters, so `--bail` can only stop the files that have not started yet.
  if (jobs > 1) {
    await runInParallel(files, jobs, options);

    testState.currentFile = null;
    printSummary();

    return testState.failed;
  }

  for (const file of files) {
    if (testState.bailed) break;

    const relative = path.relative(process.cwd(), file) || file;

    console.log("");
    console.log(paint(relative, "gray"));

    testState.currentFile = relative;

    try {
      await runFile(fs.readFileSync(file).toString(), {
        base: path.dirname(file),
        main: file,
        options,
      });
    } catch (error: any) {
      testState.failed++;
      testState.failures.push({
        name: `${relative} (file did not run)`,
        error: error?.message ? String(error.message) : String(error),
        file: relative,
      });

      console.log(
        paint(
          `  ✗ ${relative} could not be executed: ${error?.message ?? error}`,
          "red",
        ),
      );

      if (testState.bail) testState.bailed = true;
    }
  }

  testState.currentFile = null;

  printSummary();

  return testState.failed;
}

/**
 * Run the files across `jobs` threads, printing each file's output as one block.
 *
 * The queue is shared: a thread that finishes takes the next file, so one slow file does
 * not leave the others idle. Output is buffered per file rather than interleaved, so a
 * parallel run reads the same way a serial one does - the files just appear in the order
 * they finish.
 */
async function runInParallel(
  files: string[],
  jobs: number,
  options: TestOptions,
): Promise<void> {
  const policy = exportPolicy();
  const queue = files.slice();

  /** Fold one worker's report into the totals the summary prints. */
  const absorb = (result: WorkerResult): void => {
    console.log("");
    console.log(paint(result.relative, "gray"));

    for (const line of result.output) console.log(line);

    testState.passed += result.passed;
    testState.failed += result.failed;
    testState.skipped += result.skipped;

    for (const failure of result.failures) testState.failures.push(failure);
    for (const skip of result.skips) testState.skips.push(skip);

    if (result.failure !== null) {
      testState.failed++;
      testState.failures.push({
        name: `${result.relative} (file did not run)`,
        error: result.failure,
        file: result.relative,
      });

      console.log(
        paint(
          `  ✗ ${result.relative} could not be executed: ${result.failure}`,
          "red",
        ),
      );
    }

    if (testState.bail && (result.failed > 0 || result.failure !== null)) {
      testState.bailed = true;
    }
  };

  /** One file in one worker; resolves once its report is in. */
  const runOne = (file: string): Promise<void> =>
    new Promise<void>((resolve) => {
      const relative = path.relative(process.cwd(), file) || file;

      const worker = new Worker(TEST_WORKER, {
        workerData: { file, relative, options, policy },
        // a worker that writes straight to the terminal would interleave with the others
        stdout: true,
        stderr: true,
      });

      let reported = false;

      worker.on("message", (result: WorkerResult) => {
        reported = true;
        absorb(result);
      });

      worker.on("error", (error: Error) => {
        if (reported) return;

        reported = true;
        absorb({
          relative,
          output: [],
          failure: error?.message ? String(error.message) : String(error),
          passed: 0,
          failed: 0,
          skipped: 0,
          failures: [],
          skips: [],
        });
      });

      worker.on("exit", (code) => {
        if (!reported) {
          absorb({
            relative,
            output: [],
            failure: `the thread stopped before reporting (exit code ${code})`,
            passed: 0,
            failed: 0,
            skipped: 0,
            failures: [],
            skips: [],
          });
        }

        resolve();
      });
    });

  /** One thread, taking files off the shared queue until it runs dry. */
  const thread = async (): Promise<void> => {
    for (;;) {
      if (testState.bailed) return;

      const next = queue.shift();

      if (next === undefined) return;

      await runOne(next);
    }
  };

  await Promise.all(Array.from({ length: jobs }, () => thread()));
}

function printSummary(): void {
  console.log("");
  console.log("══════════════════════════════════════════════════════════");

  if (testState.failed > 0) {
    console.log(paint("Failures:", "red"));

    for (const failure of testState.failures) {
      const where = failure.file ? `${failure.file} › ` : "";

      console.log(paint(`  • ${where}${failure.name}`, "red"));
      console.log(paint(`      ${failure.error}`, "red"));
    }

    console.log("");
  }

  const line =
    `Tests: ${testState.total}   Passed: ${testState.passed}   ` +
    `Failed: ${testState.failed}   Skipped: ${testState.skipped}`;

  console.log(testState.failed > 0 ? paint(line, "red") : paint(line, "green"));
}

export { runTests, collect, resolveTargets, type TestOptions };
