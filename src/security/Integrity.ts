import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PermissionError,
  PermissionCodeError,
} from "../errors/runtime/PermissionError";

/**
 * Integrity of remote imports (`mylang.lock`).
 *
 * `import "https://…/mod.ml"` fetches code and runs it. Without a record of what that URL
 * served the first time, the same program can run different code tomorrow - because the
 * server changed its mind, or because someone else did. That is the whole of a
 * supply-chain problem, and a hash fixes it.
 *
 * The lock file lives next to `mylang.json`, at the project root:
 *
 *     {
 *       "remote": {
 *         "https://example.com/mod.ml": "sha256-6c9a…"
 *       }
 *     }
 *
 * On the first fetch the hash is recorded. On every later fetch it is compared, and a
 * mismatch refuses the import rather than running the new code. `--frozen` refuses
 * anything that is not already in the lock file, which is what a build or a CI run wants.
 *
 * No syntax is involved: the lock file is data, and the program that uses it is unchanged.
 */

const LOCK_FILE = "mylang.lock";

interface LockData {
  remote: Record<string, string>;
}

function hashOf(content: string | Buffer): string {
  return "sha256-" + createHash("sha256").update(content).digest("hex");
}

class Integrity {
  private root: string | null = null;
  private data: LockData = { remote: {} };
  private frozen = false;
  private dirty = false;
  private loaded = false;

  /** Point the mechanism at a project root. Called once, from the CLI. */
  configure(root: string | null, frozen = false): void {
    this.root = root;
    this.frozen = frozen;
    this.data = { remote: {} };
    this.dirty = false;
    this.loaded = false;
  }

  get enabled(): boolean {
    return this.root !== null;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  private get path(): string {
    return join(this.root!, LOCK_FILE);
  }

  private load(): void {
    if (this.loaded || this.root === null) return;

    this.loaded = true;

    if (!existsSync(this.path)) return;

    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));

      if (parsed && typeof parsed.remote === "object" && parsed.remote) {
        this.data.remote = { ...parsed.remote };
      }
    } catch {
      // a damaged lock file is treated as empty rather than stopping the program;
      // every URL in it is then re-recorded, and `--frozen` still refuses them
    }
  }

  /** The hash recorded for `url`, or `null`. */
  recorded(url: string): string | null {
    this.load();

    return this.data.remote[url] ?? null;
  }

  /**
   * Check what a URL served against the lock file.
   *
   * Throws when the content does not match what was recorded, or when the URL is unknown
   * and the run is frozen. Records the hash when the URL is new.
   */
  verify(url: string, content: string | Buffer): void {
    if (this.root === null) return;

    this.load();

    const actual = hashOf(content);
    const expected = this.data.remote[url];

    if (expected === undefined) {
      if (this.frozen) {
        throw new PermissionError(PermissionCodeError.IntegrityMissing, {
          url,
          actual,
          file: LOCK_FILE,
        });
      }

      this.data.remote[url] = actual;
      this.dirty = true;

      return;
    }

    if (expected !== actual) {
      throw new PermissionError(PermissionCodeError.IntegrityMismatch, {
        url,
        expected,
        actual,
        file: LOCK_FILE,
      });
    }
  }

  /**
   * Write the lock file when new URLs were recorded. Called when the program finishes;
   * failing to write is reported by the caller, never by stopping the program.
   */
  flush(): string | null {
    if (this.root === null || !this.dirty) return null;

    const ordered = Object.keys(this.data.remote)
      .sort()
      .reduce<Record<string, string>>((all, key) => {
        all[key] = this.data.remote[key]!;
        return all;
      }, {});

    writeFileSync(
      this.path,
      JSON.stringify({ remote: ordered }, null, 2) + "\n",
      "utf8",
    );

    this.dirty = false;

    return this.path;
  }

  describe(): Record<string, string> {
    this.load();

    return {
      lockFile: this.root === null ? "disabled" : this.path,
      frozen: this.frozen ? "yes" : "no",
      recorded: String(Object.keys(this.data.remote).length),
    };
  }
}

const integrity = new Integrity();

export { integrity, Integrity, hashOf, LOCK_FILE };
