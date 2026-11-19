/**
 * One test file, run on its own thread, for `mylang test --jobs=N`.
 *
 * Each file already runs in its own interpreter, so running several at once needs nothing
 * from the test files themselves - only somewhere to run them and a way to collect what
 * they reported. The worker runs one file, captures everything it printed, and posts the
 * counters back; the parent merges them and prints each file's output as a block, so
 * parallel output stays as readable as serial output.
 */

const fs = require("node:fs");
const path = require("node:path");
const { parentPort, workerData } = require("node:worker_threads");

const { run } = require("../../src/utils/utils");
const { state: testState } = require("../../library/test/state");
const {
  security,
  Permissions,
  ResourceLimits,
  ResourceCounters,
} = require("../../src/security");

/** Lines the test file printed, in order. */
const output = [];

function capture() {
  const write = (...args) => {
    output.push(
      args
        .map((arg) => (typeof arg === "string" ? arg : String(arg)))
        .join(" "),
    );
  };

  console.log = write;
  console.info = write;
  console.warn = write;
  console.error = write;
}

async function main() {
  const { file, relative, options, policy } = workerData;

  // the worker runs under the same policy as the parent
  security.configure(
    new Permissions(policy.permissions ?? {}),
    new ResourceLimits(policy.limits ?? {}),
    new ResourceCounters(policy.counts ?? {}),
  );

  testState.reset();
  testState.underRunner = true;
  testState.verbose = Boolean(options.verbose);
  testState.bail = Boolean(options.bail);
  testState.color = options.color !== false;
  testState.filter = options.filter ?? null;
  testState.currentFile = relative;

  capture();

  let failure = null;

  try {
    await run(fs.readFileSync(file).toString(), {
      base: path.dirname(file),
      main: file,
      options,
    });
  } catch (error) {
    failure = error && error.message ? String(error.message) : String(error);
  }

  parentPort.postMessage({
    relative,
    output,
    failure,
    passed: testState.passed,
    failed: testState.failed,
    skipped: testState.skipped,
    failures: testState.failures.map((entry) => ({
      name: entry.name,
      error: entry.error,
      file: entry.file ?? relative,
    })),
    skips: testState.skips.map((entry) => ({
      name: entry.name,
      reason: entry.reason,
      file: entry.file ?? relative,
    })),
  });
}

main().then(
  () => {
    // the port is closed so the thread can end instead of waiting on it
    try {
      parentPort.close();
    } catch {
      // already gone
    }
  },
  (error) => {
    parentPort.postMessage({
      relative: workerData.relative,
      output,
      failure: error && error.message ? String(error.message) : String(error),
      passed: 0,
      failed: 0,
      skipped: 0,
      failures: [],
      skips: [],
    });

    try {
      parentPort.close();
    } catch {
      // already gone
    }
  },
);
