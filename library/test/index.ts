/**
 * `test` - the built-in test framework.
 *
 *     import "core:test";
 *
 *     test.describe("math", func() {
 *       test.beforeEach(func() { ... });
 *
 *       test.test("adds", func() {
 *         test.assert.equal(1 + 2, 3);
 *       });
 *     });
 *
 *     test.finish("math");
 *
 * Run a file with `mylang test <file>`, or a whole directory with `mylang test`.
 *
 * Every callback (`describe` body, `test` body, hooks) runs as a coroutine, so a test may
 * `wait`, `spawn` or sleep. Each test body runs as its own task, which means a test that
 * leaves work running cannot corrupt the next one's control flow.
 */

import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { type Gen } from "../../src/runtime/coroutine";
import { assertions, fail } from "./assertions";
import { show, deepEq, describeThrown } from "./values";
import { state, newScope } from "./state";
import { colorsEnabled } from "../../src/output/colors";

const COLORS: Record<string, string> = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function paint(text: string, color: string): string {
  if (!state.color || !colorsEnabled() || !COLORS[color]) return text;

  return `${COLORS[color]}${text}\x1b[0m`;
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function write(line: string): void {
  console.log(line);
}

abstract class TestBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return { name: "test", path: __dirname };
  }

  /** Where the current file lives, for failure attribution. */
  protected sourceFile(): string | null {
    try {
      return state.currentFile ?? String(this.environment.get("import").main);
    } catch {
      return state.currentFile;
    }
  }

  /** Register a hook on the innermost open scope. */
  protected registerHook(
    kind: "before" | "after" | "beforeAll" | "afterAll",
    hook: any,
  ): null {
    this.assertFunction(hook, "hook");

    state.scopes[state.scopes.length - 1]![kind].push(hook);

    return null;
  }

  /** Run `before`/`beforeAll` outward-in, `after` inward-out. */
  protected *runHooks(kind: "before" | "after"): Gen<void> {
    if (kind === "before") {
      for (const scope of state.scopes) {
        if (!scope.beforeAllRan && scope.beforeAll.length > 0) {
          scope.beforeAllRan = true;

          for (const hook of scope.beforeAll) {
            yield this.executeCallback(hook, []);
          }
        }
      }

      for (const scope of state.scopes) {
        for (const hook of scope.before) {
          yield this.executeCallback(hook, []);
        }
      }

      return;
    }

    for (let i = state.scopes.length - 1; i >= 0; i--) {
      for (const hook of state.scopes[i]!.after) {
        yield this.executeCallback(hook, []);
      }
    }
  }

  /** `afterAll` hooks of the scope that is about to close. */
  protected *runAfterAll(): Gen<void> {
    const scope = state.scopes[state.scopes.length - 1];

    if (!scope) return;

    for (const hook of scope.afterAll) {
      yield this.executeCallback(hook, []);
    }
  }

  call(): any {
    throw new Error("Call is not implemented");
  }
}

/** Record a passing or failing test. */
function record(
  ok: boolean,
  name: string,
  error: string | null,
  file: string | null,
): void {
  if (ok) {
    state.passed++;

    if (state.verbose) {
      write(`${indent(state.path.length + 1)}${paint("✓", "green")} ${name}`);
    }

    return;
  }

  state.failed++;
  state.failures.push({ name: state.fullName(name), error: error ?? "", file });

  write(`${indent(state.path.length + 1)}${paint(`✗ ${name}`, "red")}`);
  write(`${indent(state.path.length + 2)}${paint(error ?? "", "red")}`);
}

class Describe extends TestBuilder {
  override *call(): Gen<any> {
    const [name, body] = this.args;

    this.assertString(name, "name");
    this.assertFunction(body, "body");

    if (state.bailed) return null;

    const top = state.path.length === 0;
    const passedBefore = state.passed;
    const failedBefore = state.failed;
    const skippedBefore = state.skipped;

    state.path.push(name);
    state.scopes.push(newScope());

    if (state.verbose) {
      write(`${indent(state.path.length)}${paint(name, "cyan")}`);
    }

    try {
      yield this.executeCallback(body, []);

      // `afterAll` of this group, now that every test in it has run
      yield this.runAfterAll();
    } catch (error) {
      record(false, "(describe body)", describeThrown(error), this.sourceFile());
    } finally {
      state.path.pop();
      state.scopes.pop();
    }

    if (top && !state.verbose && !state.bailed) {
      const passed = state.passed - passedBefore;
      const failed = state.failed - failedBefore;
      const skipped = state.skipped - skippedBefore;
      const extra = skipped > 0 ? `, ${skipped} skipped` : "";

      if (failed === 0) {
        write(
          `  ${paint("✓", "green")} ${name}${paint(` (${passed} passed${extra})`, "gray")}`,
        );
      } else {
        write(
          `  ${paint("✗", "red")} ${name}${paint(` (${passed} passed, ${failed} FAILED${extra})`, "red")}`,
        );
      }
    }

    return null;
  }
}

class Test extends TestBuilder {
  override *call(): Gen<any> {
    const [name, body] = this.args;

    this.assertString(name, "name");
    this.assertFunction(body, "body");

    if (state.bailed) return null;

    if (!state.selected(name)) {
      state.skipped++;
      state.skips.push({
        name: state.fullName(name),
        reason: "filtered out",
        file: this.sourceFile(),
      });

      return null;
    }

    try {
      yield this.runHooks("before");
      yield this.executeCallback(body, []);
      yield this.runHooks("after");

      record(true, name, null, this.sourceFile());
    } catch (error) {
      try {
        yield this.runHooks("after");
      } catch {
        // a failing cleanup must not hide the original failure
      }

      record(false, name, describeThrown(error), this.sourceFile());

      if (state.bail) state.bailed = true;
    }

    return null;
  }
}

class Skip extends TestBuilder {
  override call() {
    const [name, reason] = this.args;

    this.assertString(name, "name");

    state.skipped++;
    state.skips.push({
      name: state.fullName(name),
      reason: reason === undefined || reason === null ? "" : String(reason),
      file: this.sourceFile(),
    });

    if (state.verbose) {
      write(
        `${indent(state.path.length + 1)}${paint(`○ ${name} (skipped)`, "yellow")}`,
      );
    }

    return null;
  }
}

class BeforeEach extends TestBuilder {
  override call() {
    return this.registerHook("before", this.args[0]);
  }
}

class AfterEach extends TestBuilder {
  override call() {
    return this.registerHook("after", this.args[0]);
  }
}

class BeforeAll extends TestBuilder {
  override call() {
    return this.registerHook("beforeAll", this.args[0]);
  }
}

class AfterAll extends TestBuilder {
  override call() {
    return this.registerHook("afterAll", this.args[0]);
  }
}

class Finish extends TestBuilder {
  override call() {
    const [title] = this.args;

    // under `mylang test` the runner prints one summary for every file
    if (state.underRunner) return null;

    const label = title === undefined || title === null ? "" : `${title}: `;

    write("");

    for (const skipped of state.skips) {
      write(
        paint(
          `  ○ skipped: ${skipped.name}${skipped.reason ? ` — ${skipped.reason}` : ""}`,
          "yellow",
        ),
      );
    }

    let line = `${label}${state.passed}/${state.total} passed`;

    if (state.skipped > 0) line += `, ${state.skipped} skipped`;

    if (state.failed > 0) {
      write(paint(`${line}, ${state.failed} FAILED`, "red"));
      process.exitCode = 1;

      return state.failed;
    }

    write(paint(line, "green"));

    return 0;
  }
}

class Summary extends TestBuilder {
  override call() {
    write("");
    write("══════════════════════════════════════════════════════════");

    if (state.failed > 0) {
      write(paint("Failures:", "red"));

      for (const failure of state.failures) {
        write(paint(`  • ${failure.name}`, "red"));
        write(paint(`      ${failure.error}`, "red"));
      }

      write("");
    }

    if (state.skipped > 0) {
      write(paint("Skipped:", "yellow"));

      for (const skipped of state.skips) {
        write(
          paint(
            `  ○ ${skipped.name}${skipped.reason ? `  — ${skipped.reason}` : ""}`,
            "yellow",
          ),
        );
      }

      write("");
    }

    const line = `Tests: ${state.total}   Passed: ${state.passed}   Failed: ${state.failed}   Skipped: ${state.skipped}`;

    write(state.failed > 0 ? paint(line, "red") : paint(line, "green"));

    return state.failed;
  }
}

class Stats extends TestBuilder {
  override call() {
    return {
      passed: state.passed,
      failed: state.failed,
      skipped: state.skipped,
      total: state.total,
    };
  }
}

class Reset extends TestBuilder {
  override call() {
    state.reset();

    return null;
  }
}

class Configure extends TestBuilder {
  override call() {
    const [options] = this.args;

    this.assertObject(options, "options");

    if (typeof options["verbose"] === "boolean") state.verbose = options["verbose"];
    if (typeof options["color"] === "boolean") state.color = options["color"];
    if (typeof options["bail"] === "boolean") state.bail = options["bail"];
    if (typeof options["filter"] === "string") state.filter = options["filter"];

    // `runner: true` makes `finish()` aggregate instead of reporting per file, which is
    // what a file that imports several test files wants (see test/index.ml).
    if (typeof options["runner"] === "boolean") {
      state.underRunner = options["runner"];
    }

    return null;
  }
}

class Show extends TestBuilder {
  override call() {
    return show(this.args[0]);
  }
}

class DeepEq extends TestBuilder {
  override call() {
    return deepEq(this.args[0], this.args[1]);
  }
}

class FailNow extends TestBuilder {
  override call() {
    const [message] = this.args;

    return fail(
      message === undefined || message === null ? "explicit failure" : String(message),
    );
  }
}

module.exports = {
  describe: Describe,
  test: Test,
  it: Test,
  skip: Skip,
  beforeEach: BeforeEach,
  afterEach: AfterEach,
  beforeAll: BeforeAll,
  afterAll: AfterAll,
  finish: Finish,
  summary: Summary,
  stats: Stats,
  reset: Reset,
  configure: Configure,
  show: Show,
  deepEq: DeepEq,
  fail: FailNow,
  assert: assertions,
};
