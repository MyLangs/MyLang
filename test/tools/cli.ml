// Shared by the tool tests: run the real `mylang` command line and collect what it did.
//
// Every tool test goes through the CLI the way a user would, as a child process, so what
// is checked is the command, its flags, its exit code and its output - not a function
// that the command happens to call.

import "core:process";
import "core:path";
import "core:arrays";

var entry = path.resolve("dist", "bin", "index.js");

// colour switches inherited from whoever runs the suite would change what is printed
var cleanEnv = { NO_COLOR: "", MYLANG_NO_COLORS: "" };

func mylang(args, options) {
  var settings = options || {};
  var run = { env: cleanEnv, timeout: 60000 };

  if ("cwd" in settings) { run.cwd = settings.cwd; }
  if ("input" in settings) { run.input = settings.input; }
  if ("env" in settings) {
    for (var key in settings.env) { run.env[key] = settings.env[key]; }
  }

  var result = process.run("node", arrays.concat([entry], args), run);

  return {
    code: result.code,
    out: result.stdout.toString(),
    err: result.stderr.toString()
  };
}

export(mylang, entry);
