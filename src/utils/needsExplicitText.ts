/**
 * Values whose text form has to be asked for.
 *
 * Several libraries expose `toString` as a native builder class rather than as a plain
 * member - `bytes`, `time.Duration`, `time.Stopwatch`, a parsed url - because producing
 * the text is work, and in the case of `bytes` because *which* text it is depends on an
 * encoding the caller chooses.
 *
 * Nothing stops the host from trying to coerce such a value anyway: `"size: " + data`
 * and `$"{data}"` both reach for `toString`, find a class, and call it without `new`. The
 * host then reports `Class constructor toString cannot be invoked without 'new'`, which
 * names nothing in the program and reads like an interpreter crash. The two places that
 * can coerce a value - the binary operators and string interpolation - ask this first and
 * say what to do instead.
 */

import { isSubclassOfByName } from "./isSubclassOfByName";

function needsExplicitText(value: any): boolean {
  if (value === null || value === undefined) return false;

  if (typeof value !== "object" && typeof value !== "function") return false;

  return isSubclassOfByName(value.toString, "FunctionBuilder");
}

export { needsExplicitText };
