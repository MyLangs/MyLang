# `process`

Running external programs, and asking what this program is allowed to do.

```ml
import "core:process";
```

The import matters more here than elsewhere: `process` is also the name of a predefined
global, so a snippet without the import calls that global instead and reports an unknown
function. Every example below assumes the import above.

Importing this module binds the name `process`, replacing the predefined `process` global
for the rest of that file. That is deliberate: asking for a module by name is explicit.
The information the old global exposed is in `os` and `os/system`.

## Suspension

| Method | Suspends | Description |
| --- | --- | --- |
| `process.run(command, args, options)` | yes | run to completion and collect the output |
| `process.spawn(command, args, options)` | — | start a child to talk to while it runs |
| `process.pipeline(stages, options)` | yes | run several programs, each feeding the next |
| `child.write(data)` | yes | send to the child's standard input |
| `child.read()` | yes | what the child has written, parking if nothing yet |
| `child.readError()` | yes | the same for standard error |
| `child.output()` | yes | everything the child writes, until it exits |
| `child.wait()` | yes | park until it exits, then `{ code, signal, success }` |
| `child.close()` | yes | kill it if still running (idempotent) |
| `child.closeInput()` | — | tell the child there is no more input |
| `child.kill(signal)` | — | `"SIGTERM"` by default |
| `child.running()` / `child.exitCode()` | — | current state |
| `child.pid` / `child.command` | — | fields |
| `process.pid()` | — | this program's process id |
| `process.exit(code)` | — | end the program (needs `--allow-sys`) |
| `process.permissions()` | — | what this program is allowed to do |
| `process.can(kind, target)` | — | may it? never throws |

Waiting for a child parks only the task that asked, so the rest of the program keeps
running. Use `spawn` to run several commands at once.

## `run` versus `spawn`

- `process.run` is for a command that produces a result: it waits, then hands back
  `{ code, signal, success, stdout, stderr }` with both streams as `bytes`.
- `process.spawn` is for a command you talk to: write to its input, read its output while
  it runs, kill it if it misbehaves.
- `process.pipeline` is for several commands at once, where each one's output is the next
  one's input.

`run` options: `input` (data for standard input), `timeout` (milliseconds; the command is
killed and an error raised), `cwd`, `env`, `shell`.

## Permissions

| Operation | Needs |
| --- | --- |
| `run`, `spawn` | `--allow-process`, which may name the commands allowed |
| `pipeline` | `--allow-process` for **every** stage |
| `options.cwd` | `--allow-read` for that directory |
| `options.env` | `--allow-env` |
| `process.exit` | `--allow-sys` |
| `permissions`, `can`, `pid` | nothing |

```
mylang run build.ml --allow-process=git,npm
```

Asking what is allowed never needs a permission: a program that knows it cannot reach the
network can say so instead of failing halfway through.

## Resources

A running child carries `symbol.dispose`, so `defer` guarantees no stray process is left
behind when a block exits early:

```ml
func convert(file) {
  var child = defer process.spawn("ffmpeg", ["-i", file, "out.mp4"]);

  if (child.wait().code != 0) {
    throw "conversion failed";       // the child is already gone
  }

  return "out.mp4";
}
```

## Examples

### Running a command

```ml
import "core:process";

var result = process.run("git", ["status", "--short"]);

if (!result.success) {
  throw "git failed: " + result.stderr.toString();
}

coreio.print(result.stdout.toString());
```

### Piping data through a command

```ml
import "core:process";

var sorted = process.run("sort", ["-u"], { input: "b\na\nb\n" });

coreio.print(sorted.stdout.toString());    // a\nb\n
```

### A pipeline

This is the shell's `a | b | c`. Each stage's output goes straight into the next one's
input, so a large stream passes through without anything collecting it:

```ml
import "core:process";

var authors = process.pipeline([
  ["git", ["log", "--format=%an"]],
  ["sort"],
  ["uniq", ["-c"]],
  ["sort", ["-rn"]]
]);

coreio.print(authors.stdout.toString());
```

A stage is `[command, args]`, or just `command` when it takes none. The result is
`{ code, stdout, stderr, stages }`: the exit code and output of the **last** stage, the
errors from every stage together, and a per-stage list of codes — a pipeline where an
early stage failed still produces output, so the codes are worth seeing:

```ml
import "core:process";

var out = process.pipeline(
  [["cat"], ["grep", ["absent"]], ["wc", ["-l"]]],
  { input: "nothing matching\n" }
);

coreio.print(out.stages);
// [{command: "cat", code: 0}, {command: "grep", code: 1}, {command: "wc", code: 0}]
```

Every stage is checked against `--allow-process` before anything starts, so a grant naming
commands covers a pipeline only if it names all of them, and a refused pipeline starts
nothing at all.

### Talking to a long-running child

```ml
import "core:process";

var child = defer process.spawn("python3", ["-u", "worker.py"]);

child.write("job 1\n");
coreio.print(child.read().toString());

child.write("job 2\n");
coreio.print(child.read().toString());

child.closeInput();
child.wait();
```

### Several commands at once

```ml
var jobs = [];

for (var repo in repos) {
  jobs[length(jobs)] = spawn process.run("git", ["-C", repo, "fetch"]);
}

for (var job in jobs) {
  var done = wait job;
  coreio.print(done.result.code);
}
```

### Not hanging on a command that hangs

```ml
try {
  process.run("some-tool", [], { timeout: 5000 });
} catch (e) {
  coreio.print("gave up:", e.message);
}
```

### Checking the policy before doing the work

```ml
import "core:process";

if (!process.can("net")) {
  coreio.print("running offline; skipping the update check");
} else {
  checkForUpdates();
}
```

## Notes

- `process.pipeline` holds no stage's output except the last one's, which is what makes it
  usable on a stream far larger than memory. Building the same thing out of `run` calls
  would hold every intermediate result at once.

- `shell: true` turns the arguments into a command line, which is how an injected argument
  becomes an injected command. Prefer passing arguments as an array — that never involves
  a shell.
- A non-zero exit is reported in `result.code`, not as an error. Only a command that could
  not be started at all raises.
- `os.system(command)` runs a command line through a shell and is the older, blunter
  interface; `process.run` is the safe one.
