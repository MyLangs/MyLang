/**
 * The security context of the running program.
 *
 * There is exactly one interpreter per process (see `runtime`), so the policy lives in a
 * module-level singleton that every built-in library consults through the small helpers
 * below. Libraries never build their own policy and never see the CLI flags.
 *
 *   import { security } from "../../src/security";
 *
 *   security.read(filePath);          // throws PermissionError when not allowed
 *   security.net(`${host}:${port}`);
 *   if (security.can("process")) ...  // never throws
 */

import { Permissions, type PermissionKind } from "./Permissions";
import { ResourceLimits } from "./ResourceLimits";
import { ResourceCounters, type CountedKind } from "./ResourceCounters";
import { type PermissionError } from "../errors/runtime/PermissionError";

class SecurityContext {
  private _permissions: Permissions = Permissions.unrestricted();
  private _limits: ResourceLimits = new ResourceLimits();
  private _counters: ResourceCounters = new ResourceCounters();

  get permissions(): Permissions {
    return this._permissions;
  }

  get limits(): ResourceLimits {
    return this._limits;
  }

  get counters(): ResourceCounters {
    return this._counters;
  }

  /** Install the policy built from the CLI flags. Called once, before the program starts. */
  configure(
    permissions: Permissions,
    limits: ResourceLimits,
    counters: ResourceCounters = new ResourceCounters(),
  ): void {
    this._permissions = permissions;
    this._limits = limits;
    this._counters = counters;
  }

  /** Drop every restriction (used between REPL runs and by embedders). */
  reset(): void {
    this._permissions = Permissions.unrestricted();
    this._limits = new ResourceLimits();
    this._counters = new ResourceCounters();
  }

  /** Take one resource of `kind`, or throw when the program already holds its limit. */
  acquire(kind: CountedKind): void {
    this._counters.acquire(kind);
  }

  /** Give one back. Safe to call twice. */
  release(kind: CountedKind): void {
    this._counters.release(kind);
  }

  /** Never throws: `true` when `target` is permitted for `kind`. */
  can(kind: PermissionKind, target?: string): boolean {
    return this._permissions.query(kind, target);
  }

  /** Throws `PermissionError` unless `target` is permitted for `kind`. */
  check(kind: PermissionKind, target?: string): void {
    this._permissions.check(kind, target);
  }

  read(path: string): void {
    this._permissions.check("read", path);
  }

  write(path: string): void {
    this._permissions.check("write", path);
  }

  /** `host`, `host:port` or a full URL. */
  net(target: string): void {
    this._permissions.check("net", target);
  }

  env(name?: string): void {
    this._permissions.check("env", name);
  }

  process(command?: string): void {
    this._permissions.check("process", command);
  }

  sys(operation?: string): void {
    this._permissions.check("sys", operation);
  }

  worker(target?: string): void {
    this._permissions.check("worker", target);
  }

  /** The violated resource limit, or `null`. Used by the scheduler. */
  violation(now?: number): PermissionError | null {
    return this._limits.violation(now);
  }

  /**
   * Throw unless a buffer of `bytes` still fits inside `--max-memory`.
   * Called by anything that allocates a buffer whose size the program chose.
   */
  allocation(bytes: number): void {
    const violation = this._limits.checkAllocation(bytes);

    if (violation) throw violation;
  }
}

const security = new SecurityContext();

export { security, SecurityContext };
export { Permissions, PERMISSION_KINDS, parseNetTarget } from "./Permissions";
export type { PermissionKind } from "./Permissions";
export {
  ResourceCounters,
  COUNTED_KINDS,
  type CountedKind,
} from "./ResourceCounters";
export {
  ResourceLimits,
  parseSize,
  parseDuration,
  formatBytes,
  formatDuration,
} from "./ResourceLimits";
export { integrity, hashOf, LOCK_FILE } from "./Integrity";
export { parseSecurityFlags, collectSecurityArgs } from "./parseFlags";
export type { SecurityOptions } from "./parseFlags";
