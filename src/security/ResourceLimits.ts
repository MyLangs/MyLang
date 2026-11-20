import {
  PermissionError,
  PermissionCodeError,
} from "../errors/runtime/PermissionError";

/**
 * Memory and wall-clock limits (`--max-memory`, `--timeout`).
 *
 * Both are enforced from outside interpreted code: when a limit is reached the whole
 * program is aborted through `Scheduler.abort`, so a `try/catch` inside the program can
 * never swallow the violation and keep running.
 *
 * The memory check samples `process.memoryUsage().heapUsed`, which is cheap but not free,
 * so it is rate-limited: it runs at most every `SAMPLE_INTERVAL_MS` and otherwise returns
 * the previous verdict.
 */

const SAMPLE_INTERVAL_MS = 20;

/**
 * How much memory the program is using.
 *
 * `heapUsed` alone is not it: every `bytes` value, every buffer read from a file and every
 * compressed block lives in a `Buffer`, which V8 allocates *outside* its heap. Counting
 * only the heap meant `--max-memory=64MB` would happily watch a program hold hundreds of
 * megabytes of buffers - exactly the memory the libraries produce. `external` covers those
 * (and includes `arrayBuffers`, so they must not be added again).
 */
function currentUsage(): number {
  const usage = process.memoryUsage();

  return usage.heapUsed + usage.external;
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  k: 1024,
  mb: 1024 ** 2,
  m: 1024 ** 2,
  gb: 1024 ** 3,
  g: 1024 ** 3,
};

const TIME_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  sec: 1000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
};

/** `"256MB"`, `"1g"`, `"1048576"` -> bytes. Returns `null` when it cannot be parsed. */
function parseSize(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*$/.exec(String(value));

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = (match[2] || "b").toLowerCase();

  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!(unit in SIZE_UNITS)) return null;

  return Math.floor(amount * SIZE_UNITS[unit]!);
}

/** `"30s"`, `"500ms"`, `"2m"`, `"1000"` (ms) -> milliseconds, or `null`. */
function parseDuration(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*$/.exec(String(value));

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = (match[2] || "ms").toLowerCase();

  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!(unit in TIME_UNITS)) return null;

  return Math.floor(amount * TIME_UNITS[unit]!);
}

function formatBytes(bytes: number): string {
  if (bytes >= SIZE_UNITS["gb"]!)
    return `${(bytes / SIZE_UNITS["gb"]!).toFixed(2)}GB`;
  if (bytes >= SIZE_UNITS["mb"]!)
    return `${(bytes / SIZE_UNITS["mb"]!).toFixed(2)}MB`;
  if (bytes >= SIZE_UNITS["kb"]!)
    return `${(bytes / SIZE_UNITS["kb"]!).toFixed(2)}KB`;

  return `${bytes}B`;
}

function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(2)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;

  return `${ms}ms`;
}

interface ResourceLimitsInit {
  /** Maximum heap the program may use, in bytes. */
  maxMemory?: number | null;
  /** Maximum wall-clock run time, in milliseconds. */
  timeout?: number | null;
}

class ResourceLimits {
  public readonly maxMemory: number | null;
  public readonly timeout: number | null;

  private startedAt = 0;
  private lastSampleAt = 0;
  private running = false;

  constructor(init: ResourceLimitsInit = {}) {
    this.maxMemory = init.maxMemory ?? null;
    this.timeout = init.timeout ?? null;
  }

  /** True when neither limit is set, so callers can skip the checks entirely. */
  get unlimited(): boolean {
    return this.maxMemory === null && this.timeout === null;
  }

  /** Start (or restart) the clock. Called when the main task begins. */
  begin(now = Date.now()): void {
    this.startedAt = now;
    this.lastSampleAt = now;
    this.running = true;
  }

  /** Stop the clock: later checks never report a violation. */
  end(): void {
    this.running = false;
  }

  /** How long the program may still run, or `null` when it is untimed. */
  remaining(now = Date.now()): number | null {
    if (this.timeout === null) return null;

    return Math.max(0, this.startedAt + this.timeout - now);
  }

  /**
   * Returns the violated limit as an error, or `null` when everything is within bounds.
   * Cheap enough to call at every scheduler step.
   */
  violation(now = Date.now()): PermissionError | null {
    if (!this.running || this.unlimited) return null;

    if (this.timeout !== null && now - this.startedAt >= this.timeout) {
      return new PermissionError(PermissionCodeError.TimeLimitExceeded, {
        limit: formatDuration(this.timeout),
      });
    }

    if (
      this.maxMemory !== null &&
      now - this.lastSampleAt >= SAMPLE_INTERVAL_MS
    ) {
      this.lastSampleAt = now;

      const used = currentUsage();

      if (used > this.maxMemory) {
        return new PermissionError(PermissionCodeError.MemoryLimitExceeded, {
          used: formatBytes(used),
          limit: formatBytes(this.maxMemory),
        });
      }
    }

    return null;
  }

  /** What the program is using right now, by the same measure the limit uses. */
  usage(): number {
    return currentUsage();
  }

  /**
   * Refuse an allocation that would take the program past its limit, before it is made.
   *
   * The periodic sample above cannot catch a single huge buffer: a program can ask for
   * half a gigabyte between two samples and have it before the next one. Anything that
   * allocates a buffer whose size the program chose (`bytes.alloc`, reading a file,
   * decompressing) asks here first, so the limit holds for one large allocation as well
   * as for many small ones.
   */
  checkAllocation(bytes: number): PermissionError | null {
    if (!this.running || this.maxMemory === null) return null;

    if (!Number.isFinite(bytes) || bytes <= 0) return null;

    const projected = currentUsage() + bytes;

    if (projected <= this.maxMemory) return null;

    return new PermissionError(PermissionCodeError.MemoryLimitExceeded, {
      used: `${formatBytes(projected)} after a ${formatBytes(bytes)} allocation`,
      limit: formatBytes(this.maxMemory),
    });
  }

  describe(): Record<string, string> {
    return {
      maxMemory:
        this.maxMemory === null ? "unlimited" : formatBytes(this.maxMemory),
      timeout:
        this.timeout === null ? "unlimited" : formatDuration(this.timeout),
    };
  }
}

export {
  ResourceLimits,
  parseSize,
  parseDuration,
  formatBytes,
  formatDuration,
  type ResourceLimitsInit,
};
