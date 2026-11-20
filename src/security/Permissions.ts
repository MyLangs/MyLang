import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve as resolvePath,
  sep,
} from "node:path";
import { realpathSync } from "node:fs";
import {
  PermissionError,
  PermissionCodeError,
} from "../errors/runtime/PermissionError";

/**
 * Permission model of MyLang2.
 *
 * A program runs under a `Permissions` policy that is built once, from the CLI flags, and
 * then consulted by every library that touches the outside world (`fs`, `net/http`, `tcp`,
 * `udp`, `dns`, `ws`, `process`, `os`, `workers`, `archive`, ...).
 *
 * Modes
 * -----
 *   unrestricted - no `--allow-*` flag was given: everything is permitted except the kinds
 *                  explicitly denied with `--deny-*`. This is the default, so existing
 *                  programs keep working unchanged.
 *   sandbox      - at least one `--allow-*` flag was given: every kind is denied unless it
 *                  was explicitly allowed. `--deny-*` always wins over `--allow-*`.
 *
 * A kind may be allowed wholesale (`--allow-read`) or narrowed to a list
 * (`--allow-read=./data,./tmp`, `--allow-net=api.telegram.org`).
 */

type PermissionKind =
  "read" | "write" | "net" | "env" | "process" | "sys" | "worker";

const PERMISSION_KINDS: readonly PermissionKind[] = [
  "read",
  "write",
  "net",
  "env",
  "process",
  "sys",
  "worker",
];

type Grant = boolean | string[];

interface PermissionsInit {
  /** Explicit allow lists, keyed by kind. */
  allow?: Partial<Record<PermissionKind, Grant>>;
  /** Explicit deny lists, keyed by kind. Deny always wins. */
  deny?: Partial<Record<PermissionKind, Grant>>;
  /** Directory that relative path grants are resolved against (defaults to cwd). */
  base?: string;
}

function isPermissionKind(value: string): value is PermissionKind {
  return (PERMISSION_KINDS as readonly string[]).includes(value);
}

/** Split `a,b , c` into `["a", "b", "c"]`, dropping empties. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** `/a/b` contains `/a/b` and `/a/b/c`, but not `/a/bc`. */
function isInside(parent: string, child: string): boolean {
  if (parent === child) return true;

  const prefix = parent.endsWith(sep) ? parent : parent + sep;

  return child.startsWith(prefix);
}

/**
 * The path with every symbolic link resolved.
 *
 * Comparing paths as text is not enough: a link inside an allowed directory can point
 * anywhere, so `--allow-read=./data` plus `./data/link` would otherwise hand out the whole
 * file system. Both the grants and the targets are resolved through this, so a link is
 * judged by where it actually leads.
 *
 * A path that does not exist yet (the usual case for a write) has no real path of its own,
 * so the nearest existing ancestor is resolved and the remaining segments are appended -
 * which is what decides where the file would be created.
 */
function resolveLinks(full: string): string {
  try {
    return realpathSync(full);
  } catch {
    // does not exist yet: fall through and resolve as much of it as does
  }

  const tail: string[] = [basename(full)];
  let dir = dirname(full);

  for (;;) {
    try {
      return join(realpathSync(dir), ...tail.slice().reverse());
    } catch {
      const parent = dirname(dir);

      if (parent === dir) return full;

      tail.push(basename(dir));
      dir = parent;
    }
  }
}

/**
 * Split a net target into host and (optional) port.
 * Accepts `host`, `host:port`, `[v6]:port` and full URLs (`https://host/path`).
 */
function parseNetTarget(target: string): { host: string; port: string | null } {
  let value = String(target).trim();

  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.exec(value);

  if (schemeMatch) {
    try {
      const url = new URL(value);

      return {
        host: url.hostname.toLowerCase(),
        port: url.port ? url.port : null,
      };
    } catch {
      value = value.slice(schemeMatch[0].length);
    }
  }

  const slash = value.indexOf("/");
  if (slash !== -1) value = value.slice(0, slash);

  if (value.startsWith("[")) {
    const close = value.indexOf("]");

    if (close !== -1) {
      const host = value.slice(1, close).toLowerCase();
      const rest = value.slice(close + 1);

      return {
        host,
        port: rest.startsWith(":") ? rest.slice(1) : null,
      };
    }
  }

  const colon = value.lastIndexOf(":");

  if (colon !== -1 && value.indexOf(":") === colon) {
    return {
      host: value.slice(0, colon).toLowerCase(),
      port: value.slice(colon + 1) || null,
    };
  }

  return { host: value.toLowerCase(), port: null };
}

class Permissions {
  public readonly sandboxed: boolean;

  private readonly allow: Map<PermissionKind, Grant> = new Map();
  private readonly denied: Map<PermissionKind, Grant> = new Map();
  private readonly base: string;

  constructor(init: PermissionsInit = {}) {
    this.base = init.base ?? process.cwd();

    for (const kind of PERMISSION_KINDS) {
      const grant = init.allow?.[kind];
      if (grant !== undefined)
        this.allow.set(kind, this.normalize(kind, grant));

      const refusal = init.deny?.[kind];
      if (refusal !== undefined)
        this.denied.set(kind, this.normalize(kind, refusal));
    }

    this.sandboxed = this.allow.size > 0;
  }

  /** A policy that permits everything: used when no security flags were given at all. */
  static unrestricted(base?: string): Permissions {
    return new Permissions(base === undefined ? {} : { base });
  }

  /** Human-readable description of the policy, for `mylang info` and error hints. */
  describe(): Record<string, string> {
    const summary: Record<string, string> = {};

    for (const kind of PERMISSION_KINDS) {
      const refusal = this.denied.get(kind);

      if (refusal === true) {
        summary[kind] = "denied";
        continue;
      }

      const grant = this.allow.get(kind);

      if (grant === true) summary[kind] = "allowed";
      else if (Array.isArray(grant)) summary[kind] = grant.join(", ");
      else summary[kind] = this.sandboxed ? "denied" : "allowed";

      if (Array.isArray(refusal) && refusal.length > 0) {
        summary[kind] += ` (except ${refusal.join(", ")})`;
      }
    }

    return summary;
  }

  /**
   * The policy as plain data, so another thread can rebuild exactly this one.
   *
   * The stored grants are already normalized - absolute paths, lowercased hosts - and
   * normalizing them again changes nothing, so a rebuilt policy decides every check the
   * same way this one does. Coarse booleans would not do: a worker given `read: true`
   * because `--allow-read=./data` was set would be able to read anything.
   */
  serialize(): PermissionsInit {
    const allow: Partial<Record<PermissionKind, Grant>> = {};
    const deny: Partial<Record<PermissionKind, Grant>> = {};

    for (const [kind, grant] of this.allow) {
      allow[kind] = Array.isArray(grant) ? grant.slice() : grant;
    }

    for (const [kind, grant] of this.denied) {
      deny[kind] = Array.isArray(grant) ? grant.slice() : grant;
    }

    return { base: this.base, allow, deny };
  }

  /** Is `target` permitted for `kind`? Never throws. */
  query(kind: PermissionKind, target?: string): boolean {
    const refusal = this.denied.get(kind);

    if (refusal === true) return false;

    if (Array.isArray(refusal) && this.matches(kind, refusal, target)) {
      return false;
    }

    const grant = this.allow.get(kind);

    if (grant === true) return true;

    if (Array.isArray(grant)) return this.matches(kind, grant, target);

    return !this.sandboxed;
  }

  /** Throw a `PermissionError` unless `target` is permitted for `kind`. */
  check(kind: PermissionKind, target?: string, files?: string[]): void {
    if (this.query(kind, target)) return;

    const shown = target === undefined ? kind : this.display(kind, target);

    throw new PermissionError(PermissionCodeError.PermissionDenied, {
      kind,
      target: shown,
      hint:
        kind === "read" || kind === "write"
          ? `=${shown}`
          : kind === "net"
            ? `=${parseNetTarget(shown).host}`
            : "",
      ...(files && { files }),
    });
  }

  /** Resolve a path the way the policy stores it, so messages and grants line up. */
  resolve(target: string): string {
    return isAbsolute(target) ? target : resolvePath(this.base, target);
  }

  /**
   * The path a grant is actually compared against: absolute, with `.` and `..` collapsed
   * and every symbolic link followed.
   */
  resolveForCheck(target: string): string {
    return resolveLinks(this.resolve(target));
  }

  private display(kind: PermissionKind, target: string): string {
    return kind === "read" || kind === "write"
      ? this.resolveForCheck(target)
      : target;
  }

  private normalize(kind: PermissionKind, grant: Grant): Grant {
    if (typeof grant === "boolean") return grant;

    const entries = grant
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);

    if (entries.length === 0) return true;

    if (kind === "read" || kind === "write") {
      return entries.map((entry) => resolveLinks(this.resolve(entry)));
    }

    if (kind === "net") {
      return entries.map((entry) => {
        const { host, port } = parseNetTarget(entry);
        return port ? `${host}:${port}` : host;
      });
    }

    return entries.map((entry) => entry.toLowerCase());
  }

  private matches(
    kind: PermissionKind,
    entries: string[],
    target?: string,
  ): boolean {
    if (target === undefined) return entries.length > 0;

    if (kind === "read" || kind === "write") {
      const full = this.resolveForCheck(target);

      return entries.some((entry) => isInside(entry, full));
    }

    if (kind === "net") {
      const asked = parseNetTarget(target);

      return entries.some((entry) => {
        const allowed = parseNetTarget(entry);

        if (allowed.host !== asked.host && allowed.host !== "*") return false;

        return allowed.port === null || allowed.port === asked.port;
      });
    }

    const asked = String(target).toLowerCase();

    return entries.some((entry) => entry === asked || entry === "*");
  }
}

export {
  Permissions,
  resolveLinks,
  PERMISSION_KINDS,
  isPermissionKind,
  parseNetTarget,
  splitList,
  type PermissionKind,
  type PermissionsInit,
  type Grant,
};
