// Does every documented `value.method(...)` name exist in the compiled libraries?
//
// A README documents two kinds of method: the library's own (`tcp.connect`) and those of
// the values it hands back (`socket.read`, `ctx.send`, `response.json`). The first kind is
// checked by name against the library's exports in check-suspends.js; this checks the
// second, which is where documentation drifts furthest, because nothing fails when a
// README invents a method that was never written.
//
// It knows names, not which object owns them: a name defined anywhere under dist/library
// counts, because a value documented by one library is often built by another - tcp's
// socket comes from net/socket. So it catches an invented name and not a real name put on
// the wrong object. That is worth saying plainly: it found `chan.tryReceive`, which never
// existed, but not `res.send`, which exists on the context rather than on `res`. For the
// second kind, the tests are the guard.
//
//   node tools/check-members.js
const fs = require("node:fs"), path = require("node:path");
const root = require("node:path").resolve(__dirname, "..");

function* readmes(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) yield* readmes(f);
    else if (e.name === "README.md") yield f;
  }
}

// Every member name defined anywhere under dist/library: a value documented by one
// library is often built by another (tcp's socket comes from net/socket).
const allNames = new Set();
(function collect(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) collect(f);
    else if (e.name.endsWith(".js")) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/(\w+):\s*class\s+extends/g)) allNames.add(m[1]);
      for (const m of src.matchAll(/^\s*(\w+):\s/gm)) allNames.add(m[1]);
    }
  }
})(path.join(root, "dist/library"));

let checked = 0; const missing = [];
for (const readme of readmes(path.join(root, "library"))) {
  const dir = path.dirname(readme);
  const distDir = path.join(root, "dist", path.relative(root, dir));
  if (!fs.existsSync(distDir)) continue;
  // every member name defined anywhere in this library's compiled files
  const names = allNames;
  const lib = path.basename(dir);
  const text = fs.readFileSync(readme, "utf8");
  for (const row of text.matchAll(/^\|\s*`([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)\(/gm)) {
    const [, obj, method] = row;
    if (obj === lib) continue;
    checked++;
    if (!names.has(method)) {
      const line = text.slice(0, row.index).split("\n").length;
      missing.push(`${path.relative(root, readme)}:${line}  ${obj}.${method} — no such member in ${lib}`);
    }
  }
}
console.log(`${checked} documented member rows checked, ${missing.length} name nothing that exists\n`);

for (const m of missing) console.log(m);

process.exitCode = missing.length > 0 ? 1 : 0;
