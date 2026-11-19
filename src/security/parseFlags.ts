/**
 * Turns the security command-line flags into a `Permissions` policy and `ResourceLimits`.
 *
 *   mylang run app.ml --allow-read=./data --allow-net=api.telegram.org \
 *                     --deny-process --max-memory=256MB --timeout=30s
 *
 * Accepted forms: `--allow-read`, `--allow-read=a,b`, `--deny-net`, `--deny-net=host`,
 * `--allow-all` / `-A`, `--max-memory=<size>`, `--timeout=<duration>`.
 */

import {
  Permissions,
  PERMISSION_KINDS,
  isPermissionKind,
  splitList,
  type Grant,
  type PermissionKind,
} from "./Permissions";
import { ResourceLimits, parseSize, parseDuration } from "./ResourceLimits";
import {
  ResourceCounters,
  COUNTED_KINDS,
  DESCRIPTIONS,
  type ResourceCountLimits,
} from "./ResourceCounters";
import {
  PermissionError,
  PermissionCodeError,
} from "../errors/runtime/PermissionError";

interface SecurityOptions {
  permissions: Permissions;
  limits: ResourceLimits;
  counters: ResourceCounters;
  /** The flags that were recognised, for `--verbose` output and `mylang info`. */
  used: string[];
}

interface ParseFlagsInit {
  /** Directory that relative path grants resolve against. */
  base?: string;
}

/** Commander turns `--allow-read` into `allowRead`; accept both shapes. */
function camel(kind: string): string {
  return kind.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function toGrant(value: unknown): Grant {
  if (value === true || value === "" || value === undefined) return true;
  if (value === false) return false;

  if (Array.isArray(value)) {
    const entries = value.flatMap((entry) => splitList(String(entry)));
    return entries.length === 0 ? true : entries;
  }

  const entries = splitList(String(value));

  return entries.length === 0 ? true : entries;
}

/**
 * Build the security policy from an options object (as produced by commander) or from a
 * raw `argv` slice. Unknown keys are ignored, so it is safe to pass the whole options bag.
 */
function parseSecurityFlags(
  options: Record<string, any> = {},
  init: ParseFlagsInit = {},
): SecurityOptions {
  const allow: Partial<Record<PermissionKind, Grant>> = {};
  const deny: Partial<Record<PermissionKind, Grant>> = {};
  const used: string[] = [];

  const allowAll = options["allowAll"] ?? options["allow-all"] ?? options["A"];

  if (allowAll) {
    used.push("--allow-all");
    for (const kind of PERMISSION_KINDS) allow[kind] = true;
  }

  for (const kind of PERMISSION_KINDS) {
    const allowKey = camel(`allow-${kind}`);
    const denyKey = camel(`deny-${kind}`);

    const allowValue = options[allowKey] ?? options[`allow-${kind}`];
    const denyValue = options[denyKey] ?? options[`deny-${kind}`];

    if (allowValue !== undefined && allowValue !== false) {
      allow[kind] = toGrant(allowValue);
      used.push(
        allowValue === true
          ? `--allow-${kind}`
          : `--allow-${kind}=${toGrantText(allow[kind]!)}`,
      );
    }

    if (denyValue !== undefined && denyValue !== false) {
      deny[kind] = toGrant(denyValue);
      used.push(
        denyValue === true
          ? `--deny-${kind}`
          : `--deny-${kind}=${toGrantText(deny[kind]!)}`,
      );
    }
  }

  const permissions = new Permissions({
    allow,
    deny,
    ...(init.base !== undefined && { base: init.base }),
  });

  const rawMemory = options["maxMemory"] ?? options["max-memory"];
  const rawTimeout = options["timeout"];

  let maxMemory: number | null = null;
  let timeout: number | null = null;

  if (rawMemory !== undefined && rawMemory !== false && rawMemory !== null) {
    maxMemory = parseSize(String(rawMemory));

    if (maxMemory === null) {
      throw new PermissionError(PermissionCodeError.InvalidPermissionValue, {
        option: "--max-memory",
        value: String(rawMemory),
        reason: "expected a size such as 256MB, 512kb or 1g",
      });
    }

    used.push(`--max-memory=${rawMemory}`);
  }

  if (rawTimeout !== undefined && rawTimeout !== false && rawTimeout !== null) {
    timeout = parseDuration(String(rawTimeout));

    if (timeout === null) {
      throw new PermissionError(PermissionCodeError.InvalidPermissionValue, {
        option: "--timeout",
        value: String(rawTimeout),
        reason: "expected a duration such as 30s, 500ms or 2m",
      });
    }

    used.push(`--timeout=${rawTimeout}`);
  }

  // `--max-open-files`, `--max-connections`, `--max-tasks`, `--max-workers`
  const counts: ResourceCountLimits = {};

  for (const kind of COUNTED_KINDS) {
    const flag = DESCRIPTIONS[kind].flag;
    const key = camel(flag.slice(2));
    const raw = options[key] ?? options[flag.slice(2)];

    if (raw === undefined || raw === false || raw === null) continue;

    const parsed = Number(raw);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new PermissionError(PermissionCodeError.InvalidPermissionValue, {
        option: flag,
        value: String(raw),
        reason: "expected a positive whole number",
      });
    }

    counts[kind] = parsed;
    used.push(`${flag}=${parsed}`);
  }

  return {
    permissions,
    limits: new ResourceLimits({ maxMemory, timeout }),
    counters: new ResourceCounters(counts),
    used,
  };
}

function toGrantText(grant: Grant): string {
  return grant === true ? "" : Array.isArray(grant) ? grant.join(",") : "";
}

/**
 * Parse raw `argv` entries (used by the REPL and by embedders that do not go through
 * commander). Returns an options bag in the shape `parseSecurityFlags` expects.
 */
function collectSecurityArgs(argv: string[]): Record<string, any> {
  const options: Record<string, any> = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;

    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    const value = equals === -1 ? true : arg.slice(equals + 1);

    if (name === "allow-all") {
      options["allowAll"] = true;
      continue;
    }

    if (
      name === "max-memory" ||
      name === "timeout" ||
      name.startsWith("max-")
    ) {
      options[camel(name)] = value;
      continue;
    }

    const match = /^(allow|deny)-(.+)$/.exec(name);

    if (match && isPermissionKind(match[2]!)) {
      options[camel(name)] = value;
    }
  }

  return options;
}

export { parseSecurityFlags, collectSecurityArgs, type SecurityOptions };
