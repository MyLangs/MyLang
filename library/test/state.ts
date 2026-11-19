/**
 * The state of a test run.
 *
 * One process runs one suite, possibly spread over many files (`mylang test` imports each
 * file in turn), so the totals live in a module-level singleton rather than in environment
 * variables as the old MyLang-level framework did.
 */

interface Failure {
  /** Full path of the test: "group › subgroup › name". */
  name: string;
  error: string;
  file: string | null;
}

interface Skipped {
  name: string;
  reason: string;
  file: string | null;
}

interface Scope {
  before: any[];
  after: any[];
  beforeAll: any[];
  afterAll: any[];
  beforeAllRan: boolean;
}

class TestState {
  passed = 0;
  failed = 0;
  skipped = 0;

  readonly failures: Failure[] = [];
  readonly skips: Skipped[] = [];

  /** Names of the `describe` blocks currently open. */
  readonly path: string[] = [];
  /** One entry per open `describe`, plus the implicit root scope. */
  readonly scopes: Scope[] = [newScope()];

  /** The file currently being executed, for failure attribution. */
  currentFile: string | null = null;

  /** Set by the runner: `finish()` then aggregates instead of exiting. */
  underRunner = false;

  verbose = false;
  color = true;

  /** Only run tests whose full name contains this text. */
  filter: string | null = null;

  /** Stop the whole run at the first failure. */
  bail = false;

  /** Set when `bail` tripped, so later files report nothing. */
  bailed = false;

  get total(): number {
    return this.passed + this.failed;
  }

  currentPath(): string {
    return this.path.join(" › ");
  }

  fullName(name: string): string {
    return this.path.length > 0 ? `${this.currentPath()} › ${name}` : name;
  }

  /** Does this test match `--filter`? */
  selected(name: string): boolean {
    if (this.filter === null) return true;

    return this.fullName(name).toLowerCase().includes(this.filter.toLowerCase());
  }

  reset(): void {
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
    this.failures.length = 0;
    this.skips.length = 0;
    this.path.length = 0;
    this.scopes.length = 0;
    this.scopes.push(newScope());
    this.bailed = false;
  }
}

function newScope(): Scope {
  return {
    before: [],
    after: [],
    beforeAll: [],
    afterAll: [],
    beforeAllRan: false,
  };
}

const state = new TestState();

export { state, newScope, TestState, type Failure, type Skipped, type Scope };
