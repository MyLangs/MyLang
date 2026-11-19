// Check every README's "Suspends" column against the compiled implementation.
//
// A documented method suspends if calling it can park the task. Three things park: the
// coroutine helpers (hostAwait, park, sleep, lift), the kernel's host bridges (fromCallback
// and friends), and a yield of something that itself parks - which has to be followed
// through a library's private helpers to be answered.
//
// Two things must NOT be counted:
//
//  * The helpers that run a user callback (executeCallback, runHooks, ...). Whether those
//    park is up to the callback, not the method, so `arrays.map` is documented as not
//    suspending and that is right.
//  * Anything inside a nested member class. A constructor like `time.Stopwatch` returns an
//    object whose members park, but constructing it does not, and its whole object literal
//    sits inside the constructor's own source.
const fs = require("node:fs");
const path = require("node:path");

const root = require("node:path").resolve(__dirname, "..");

/** Yielding one of these parks the task. */
const PARKS = new Set([
  "hostAwait",
  "park",
  "sleep",
  "tick",
  "fromCallback",
  "fromMultiCallback",
  "fromEvent",
  "collectStream",
  "writeStream",
  "waitExit",
  "waitForEnd",
  "waitForIdle",
  "wait",
]);

/** Yielding one of these runs the caller's own callback; parking is the callback's business. */
const USER_CODE = new Set([
  // `lift` and `callNative` park only when what they are given is itself asynchronous -
  // which, where they appear, is the caller's own callback
  "lift",
  "callNative",
  "executeCallback",
  "executeListener",
  "executePhaseListeners",
  "executeNextMiddleware",
  "runHooks",
  "runAfterAll",
  "fireCallback",
]);

/**
 * Keep only the part of a builder's source that belongs to the builder itself.
 *
 * These libraries are written the same way throughout: a builder does its own work, then
 * hands back a value whose members are nested builder classes. So everything from the
 * first nested `class` onwards belongs to a member - `pool.run` parks, `workers.pool`
 * does not - and counting a member's `yield` as the outer call's is what made a
 * constructor look like it waits on the host.
 */
function withoutNestedClasses(source) {
  // Also cut at `createResource(`: everything inside that call is the resource's members
  // and its release callback, which run later - `close: () => Promise.all(...)` is what
  // closing does, not what building did.
  const cuts = [source.indexOf("class "), source.indexOf("createResource")].filter(
    (at) => at !== -1,
  );

  return cuts.length === 0 ? source : source.slice(0, Math.min(...cuts));
}

/**
 * Does calling `fn` park? Follows `yield this.helper(...)` into the class's own methods.
 * Returns true, false, or "callback" when it depends on a callback the caller supplied.
 */
function parks(fn, owner, seen = new Set()) {
  if (typeof fn !== "function") return null;

  const source = withoutNestedClasses(String(fn));
  let dependsOnCallback = false;

  for (const match of source.matchAll(/yield\s+(?:\(0,\s*)?([\w.$]+)/g)) {
    const full = match[1];
    const name = full.split(".").pop();

    if (PARKS.has(name)) return true;

    if (USER_CODE.has(name)) {
      dependsOnCallback = true;
      continue;
    }

    // `yield new Something(...).call()` - another builder, which may park
    if (name === "new" || /\bnew\s+\w+/.test(source.slice(match.index, match.index + 60))) {
      return true;
    }

    // `yield this.helper(...)` - follow it
    if (full.startsWith("this.") && owner && !seen.has(name)) {
      seen.add(name);

      const helper = owner.prototype ? owner.prototype[name] : undefined;
      const nested = parks(helper, owner, seen);

      if (nested === true) return true;
      if (nested === "callback") dependsOnCallback = true;
    }
  }

  // A promise handed back is waited on by the interpreter just the same - but only one
  // this call actually returns, not one built inside a callback it registered.
  if (/return\s+(new Promise|Promise\s*\.\s*(all|race|resolve))/.test(source)) return true;

  return dependsOnCallback ? "callback" : false;
}

/** The source of a `{ ... }` block starting at `open`, counting braces outside strings. */
function blockAt(source, open) {
  let depth = 0;
  let quote = null;

  for (let i = open; i < source.length; i++) {
    const ch = source[i];

    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;

      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;

      if (depth === 0) return source.slice(open, i + 1);
    }
  }

  return source.slice(open);
}

/**
 * The members a builder hands back, as `name -> source`.
 *
 * A returned value's methods are written `name: class extends Base { *call() {...} }`
 * inside the builder, so a documented row like `socket.read(n)` is checkable the same way
 * a top-level method is - which matters, because those rows are most of the tables.
 */
function membersOf(source) {
  const found = new Map();

  for (const m of source.matchAll(/(\w+):\s*class\s+extends\s+\w+\s*\{/g)) {
    const open = source.indexOf("{", m.index + m[0].length - 1);

    found.set(m[1], blockAt(source, open));
  }

  return found;
}

/** Does this member's `call` park? Same rules, applied to one extracted block. */
function memberParks(block) {
  const body = block.indexOf("class ", 1) === -1 ? block : block.slice(0, block.indexOf("class ", 1));
  let dependsOnCallback = false;

  for (const match of body.matchAll(/yield\s+(?:\(0,\s*)?([\w.$]+)/g)) {
    const name = match[1].split(".").pop();

    if (PARKS.has(name)) return true;
    if (USER_CODE.has(name)) dependsOnCallback = true;
    else if (name === "new") return true;
  }

  if (/return\s+(new Promise|Promise\s*\.\s*(all|race|resolve))/.test(body)) return true;

  return dependsOnCallback ? "callback" : false;
}

function* readmes(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) yield* readmes(full);
    else if (entry.name === "README.md") yield full;
  }
}

let checked = 0;
let memberChecked = 0;
const memberClaims = new Map();
const wrong = [];
const callbackRows = [];

for (const readme of readmes(path.join(root, "library"))) {
  const dir = path.dirname(readme);
  const compiled = path.join(root, "dist", path.relative(root, dir), "index.js");

  if (!fs.existsSync(compiled)) continue;

  let mod;

  try {
    mod = require(compiled);
  } catch {
    continue;
  }

  const target = mod && mod.init ? mod.init : mod;
  const lib = path.basename(dir);
  const text = fs.readFileSync(readme, "utf8");

  for (const row of text.matchAll(
    /^\|\s*`([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)\(([^`]*)\)`\s*\|\s*([^|]*?)\s*\|/gm,
  )) {
    const [, obj, method, , claim] = row;

    if (obj !== lib) continue;

    const builder = target && target[method];

    if (typeof builder !== "function" || !builder.prototype) continue;

    const verdict = parks(builder.prototype.call, builder);

    if (verdict === null) continue;


    checked++;

    const said = claim.replace(/[*_`]/g, "").trim().toLowerCase();
    const claimsYes = said.startsWith("yes");
    const line = text.slice(0, row.index).split("\n").length;
    const where = `${path.relative(root, readme)}:${line}  ${lib}.${method}`;

    if (verdict === "callback") {
      if (claimsYes) callbackRows.push(`${where} — documented as suspending; it only suspends if the callback does`);

      continue;
    }

    if (claimsYes !== verdict) {
      wrong.push(
        `${where} — documented as ${claimsYes ? "suspending" : "NOT suspending"}, but it ${verdict ? "does park" : "does not park"}`,
      );
    }
  }
}

// Member rows: `socket.read(n)`, `server.accept()`, `pool.run(v)` and the like. The object
// name is not the library's, so each is matched against the members of whichever builder
// in this library actually defines it.
for (const readme of readmes(path.join(root, "library"))) {
  const dir = path.dirname(readme);
  const compiled = path.join(root, "dist", path.relative(root, dir), "index.js");

  if (!fs.existsSync(compiled)) continue;

  let mod;

  try {
    mod = require(compiled);
  } catch {
    continue;
  }

  const target = mod && mod.init ? mod.init : mod;
  const lib = path.basename(dir);
  const text = fs.readFileSync(readme, "utf8");

  // every member of every builder this library exports, by name
  const all = new Map();

  for (const key of Object.keys(target || {})) {
    const builder = target[key];

    if (typeof builder !== "function" || !builder.prototype || typeof builder.prototype.call !== "function") {
      continue;
    }

    for (const [name, block] of membersOf(String(builder.prototype.call))) {
      if (!all.has(name)) all.set(name, { block, owner: key });
    }
  }

  for (const row of text.matchAll(
    /^\|\s*`([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)\(([^`]*)\)`\s*\|\s*([^|]*?)\s*\|/gm,
  )) {
    const [, obj, method, , claim] = row;

    if (obj === lib) continue;

    const member = all.get(method);

    if (!member) continue;

    const verdict = memberParks(member.block);

    memberChecked++;

    const said = claim.replace(/[*_`]/g, "").trim().toLowerCase();
    const claimsYes = said.startsWith("yes");
    const line = text.slice(0, row.index).split("\n").length;
    const where = `${path.relative(root, readme)}:${line}  ${obj}.${method} (${lib}.${member.owner})`;

    if (verdict === "callback") {
      if (claimsYes) callbackRows.push(`${where} — documented as suspending; it only suspends if the callback does`);

      continue;
    }

    // `accept()` parks and `accept(handler)` does not, and both are documented: a method
    // written as several rows is right if any of its rows matches what the code does.
    const key = `${readme}|${obj}.${method}`;
    const seen = memberClaims.get(key) || { rows: [], verdict };

    seen.rows.push({ claimsYes, where });
    memberClaims.set(key, seen);
  }
}

for (const { rows, verdict } of memberClaims.values()) {
  if (rows.some((row) => row.claimsYes === verdict)) continue;

  const first = rows[0];

  wrong.push(
    `${first.where} — documented as ${first.claimsYes ? "suspending" : "NOT suspending"}, but it ${verdict ? "does park" : "does not park"}`,
  );
}

console.log(`${checked} library methods and ${memberChecked} methods on returned values checked`);
console.log(`${wrong.length} wrong, ${callbackRows.length} depend on a callback\n`);

process.exitCode = wrong.length > 0 ? 1 : 0;

for (const w of wrong) console.log("WRONG   " + w);
if (callbackRows.length) console.log();
for (const c of callbackRows) console.log("NOTE    " + c);
