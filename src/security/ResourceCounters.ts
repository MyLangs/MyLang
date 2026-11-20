import {
  PermissionError,
  PermissionCodeError,
} from "../errors/runtime/PermissionError";

/**
 * Caps on *how many* of a thing a program may hold at once
 * (`--max-open-files`, `--max-connections`, `--max-tasks`, `--max-workers`).
 *
 * Memory and time limits do not catch resource exhaustion: a program can open ten thousand
 * sockets, or spawn tasks until the scheduler drowns, while using very little memory and
 * no unusual amount of CPU. These counters bound the shape of a program rather than its
 * appetite, which is what makes a sandbox survivable for whatever is running next to it.
 *
 * A counter is only consulted when a limit for it was given, so an unrestricted program
 * pays one map lookup per resource.
 */

/** The things that are counted. */
type CountedKind = "file" | "connection" | "task" | "worker";

const COUNTED_KINDS: readonly CountedKind[] = [
  "file",
  "connection",
  "task",
  "worker",
];

/** What each kind is called in a message, and which flag raises it. */
const DESCRIPTIONS: Record<CountedKind, { noun: string; flag: string }> = {
  file: { noun: "open file", flag: "--max-open-files" },
  connection: { noun: "network connection", flag: "--max-connections" },
  task: { noun: "running task", flag: "--max-tasks" },
  worker: { noun: "worker thread", flag: "--max-workers" },
};

function isCountedKind(value: string): value is CountedKind {
  return (COUNTED_KINDS as readonly string[]).includes(value);
}

type Limits = Partial<Record<CountedKind, number | null>>;

class ResourceCounters {
  private readonly limits = new Map<CountedKind, number>();
  private readonly held = new Map<CountedKind, number>();
  private readonly peak = new Map<CountedKind, number>();

  constructor(limits: Limits = {}) {
    for (const kind of COUNTED_KINDS) {
      const limit = limits[kind];

      if (typeof limit === "number" && limit > 0) this.limits.set(kind, limit);
    }
  }

  /** The limits as plain data, so another thread can be held to the same ones. */
  serialize(): Limits {
    const out: Limits = {};

    for (const [kind, limit] of this.limits) out[kind] = limit;

    return out;
  }

  get unlimited(): boolean {
    return this.limits.size === 0;
  }

  /** How many of `kind` the program holds right now. */
  count(kind: CountedKind): number {
    return this.held.get(kind) ?? 0;
  }

  limit(kind: CountedKind): number | null {
    return this.limits.get(kind) ?? null;
  }

  /**
   * Take one of `kind`. Throws `PermissionError` when that would pass the limit, leaving
   * the count untouched, so a refused acquire never has to be released.
   */
  acquire(kind: CountedKind): void {
    const current = this.count(kind);
    const limit = this.limits.get(kind);

    if (limit !== undefined && current >= limit) {
      const { noun, flag } = DESCRIPTIONS[kind];

      throw new PermissionError(PermissionCodeError.ResourceLimitExceeded, {
        noun,
        limit,
        flag,
      });
    }

    const next = current + 1;

    this.held.set(kind, next);

    if (next > (this.peak.get(kind) ?? 0)) this.peak.set(kind, next);
  }

  /** Give one back. Never goes below zero, so a double release is harmless. */
  release(kind: CountedKind): void {
    const current = this.count(kind);

    if (current > 0) this.held.set(kind, current - 1);
  }

  describe(): Record<string, string> {
    const summary: Record<string, string> = {};

    for (const kind of COUNTED_KINDS) {
      const limit = this.limits.get(kind);

      summary[kind] =
        limit === undefined
          ? `${this.count(kind)} (unlimited)`
          : `${this.count(kind)} of ${limit}`;
    }

    return summary;
  }

  /** Forget every count (used between REPL runs). */
  reset(): void {
    this.held.clear();
    this.peak.clear();
  }
}

export {
  ResourceCounters,
  COUNTED_KINDS,
  isCountedKind,
  DESCRIPTIONS,
  type CountedKind,
  type Limits as ResourceCountLimits,
};
