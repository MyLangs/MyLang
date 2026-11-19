#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import chokidar from "chokidar";
import { packageInt } from "./package/init";
import { packageScripts } from "./package/runScripts";
import { replMyLang } from "./package/replMyLang";
import { installPackage } from "./package/install";
import { uninstallPackage } from "./package/uninstall";
import { showInfo } from "./package/info";
import { run as runFile } from "../src/utils/utils";
import { runTests } from "./package/runTests";
import { runPrettier } from "../prettier/cli";
import { security, integrity, parseSecurityFlags } from "../src/security";
import { PermissionCodeError } from "../src/errors/runtime/PermissionError";
import {
  takeNoColorsFlag,
  disableColors,
  paintText,
} from "../src/output/colors";

// Read before anything prints. `--no-colors` (or `--no-color`) is accepted anywhere on the
// command line, before or after the command, and is removed so no command sees it as an
// option it does not know.
if (takeNoColorsFlag(process.argv)) disableColors();

const pkg = require("../package.json");

const program = new Command();

/**
 * Attach the security flags that every command running MyLang code understands.
 * Without any `--allow-*` flag a program is unrestricted; the first `--allow-*`
 * switches it into a sandbox where everything else is denied.
 */
function withSecurityOptions(command: Command): Command {
  return command
    .option("--allow-all", "grant every permission (same as -A)")
    .option("-A", "grant every permission")
    .option(
      "--allow-read [paths]",
      "allow reading files (optionally only these paths)",
    )
    .option(
      "--allow-write [paths]",
      "allow writing files (optionally only these paths)",
    )
    .option(
      "--allow-net [hosts]",
      "allow network access (optionally only these hosts)",
    )
    .option(
      "--allow-env [names]",
      "allow reading/writing environment variables",
    )
    .option("--allow-process [commands]", "allow starting external processes")
    .option(
      "--allow-sys [operations]",
      "allow system introspection (cpus, memory, user)",
    )
    .option("--allow-worker [paths]", "allow starting workers")
    .option("--deny-read [paths]", "deny reading files")
    .option("--deny-write [paths]", "deny writing files")
    .option("--deny-net [hosts]", "deny network access")
    .option("--deny-env [names]", "deny environment access")
    .option("--deny-process [commands]", "deny starting external processes")
    .option("--deny-sys [operations]", "deny system introspection")
    .option("--deny-worker [paths]", "deny starting workers")
    .option("--max-memory <size>", "abort above this memory usage (e.g. 256MB)")
    .option("--timeout <duration>", "abort after this run time (e.g. 30s)")
    .option("--max-open-files <n>", "most files and watchers held at once")
    .option("--max-connections <n>", "most sockets and servers held at once")
    .option("--max-tasks <n>", "most tasks and child processes running at once")
    .option("--max-workers <n>", "most worker threads running at once")
    .option(
      "--frozen",
      "refuse any remote import that is not already recorded in mylang.lock",
    );
}

/** Install the policy described by the flags. Called once per execution. */
function applySecurity(base: string, options: Record<string, any>) {
  const { permissions, limits, counters, used } = parseSecurityFlags(options, {
    base,
  });

  security.configure(permissions, limits, counters);

  // Remote imports are checked against `mylang.lock` at the project root.
  integrity.configure(base, Boolean(options.frozen));

  if (options.frozen) used.push("--frozen");

  if (options.verbose && used.length > 0) {
    console.error(`\x1b[90msecurity: ${used.join(" ")}\x1b[0m`);
  }
}

/**
 * Write `mylang.lock` when a remote import was recorded during the run.
 * A failure here is reported and does not change the program's own outcome.
 */
function saveLockFile(verbose: boolean) {
  try {
    const written = integrity.flush();

    if (written && verbose) {
      console.error(`\x1b[90mrecorded remote imports in ${written}\x1b[0m`);
    }
  } catch (error) {
    console.error(
      `\x1b[33mcould not write mylang.lock: ${(error as Error)?.message ?? error}\x1b[0m`,
    );
  }
}

program
  .name("mylang")
  .description("CLI for the MyLang programming language")
  .version(pkg.version, "-v, --version", "print MyLang version")
  // read and removed before parsing (see the top of this file); declared for `--help`
  .option(
    "--no-colors",
    "turn colour off everywhere, the program's output included (also --no-color)",
  );

/**
 * A program ended by `--timeout` or `--max-memory` is over, whatever it still had open.
 * Its resources were never released (that is what being aborted means), so an open server
 * or socket would otherwise keep the process alive long after the limit was reported.
 */
function isResourceLimit(err: unknown): boolean {
  const limits: string[] = [
    PermissionCodeError.TimeLimitExceeded,
    PermissionCodeError.MemoryLimitExceeded,
    // A count limit leaves whatever the program had already opened still open. Without
    // this the limit was reported and the process then sat there for ever, held alive by
    // the sockets or files it was refused more of.
    PermissionCodeError.ResourceLimitExceeded,
  ];

  // The error may arrive wrapped: a limit reached inside an assignment or a call comes
  // back as that expression's error with the original underneath, so the chain has to be
  // walked rather than only its first link examined.
  let current: any = err;

  for (let depth = 0; current && depth < 10; depth++) {
    if (limits.includes(current.code)) return true;

    if (typeof current.message === "string") {
      for (const code of limits) {
        if (current.message.includes(code)) return true;
      }
    }

    current = current.cause ?? current.error ?? null;
  }

  return false;
}

function logError(err: unknown, verbose: boolean) {
  if (verbose && err instanceof Error && err.stack) {
    console.error(err.stack);
  } else {
    console.error(
      paintText("31", String(err instanceof Error ? err.message : err)),
    );
  }
}

/**
 * Runs a single execution pass of the given file.
 *
 * The program finishes asynchronously (the main task settles on the scheduler), so the
 * returned promise is what carries a runtime failure - a resource limit, a permission
 * error or an uncaught throw. Callers must handle it, or Node reports it as an unhandled
 * rejection and prints a stack trace instead of the error.
 */
function executeFile(
  file: string,
  options: Record<string, any>,
): Promise<unknown> {
  const base = path.join(process.cwd(), path.parse(file).dir);

  applySecurity(process.cwd(), options);

  return runFile(fs.readFileSync(file).toString(), {
    base,
    main: path.join(process.cwd(), file),
    options,
  });
}

/**
 * Shared implementation for both `mylang <file>` and `mylang run <target>`.
 * Handles optional --watch and consistent error reporting.
 */
function runTarget(file: string, options: Record<string, any>) {
  if (options.watch !== undefined && options.watch !== false) {
    const watchPath =
      typeof options.watch === "string" && options.watch.length > 0
        ? options.watch
        : file;
    const delay = parseInt(options.delay, 10);
    let timeout: NodeJS.Timeout | null = null;

    console.info(
      `\x1b[32mWatching '${watchPath}' (delay ${delay}ms)...\x1b[0m`,
    );

    const runOnce = () => {
      console.clear();
      console.log(`\x1b[32mRunning '${file}'\x1b[0m`);
      try {
        executeFile(file, options).then(
          () => console.info(`\x1b[36mDone.\x1b[0m`),
          (err) => logError(err, options.verbose),
        );
      } catch (err) {
        logError(err, options.verbose);
      }
    };

    runOnce();

    chokidar.watch(watchPath).on("change", () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(runOnce, delay);
    });
    return;
  }

  try {
    executeFile(file, options).then(
      () => saveLockFile(options.verbose),
      (err) => {
        saveLockFile(options.verbose);
        logError(err, options.verbose);
        process.exitCode = 1;

        if (isResourceLimit(err)) process.exit(1);
      },
    );
  } catch (err) {
    logError(err, options.verbose);
    process.exitCode = 1;

    if (isResourceLimit(err)) process.exit(1);
  }
}

withSecurityOptions(
  program
    .argument(
      "[file]",
      "MyLang file to run (shorthand for `mylang run <file>`)",
    )
    .option(
      "--watch [path]",
      "re-run on file changes (watches the file itself unless a path is given)",
    )
    .option("--delay <ms>", "debounce delay in ms before re-running", "1000")
    .option("--no-cache", "disable execution cache")
    .option("--verbose", "print full error stacks"),
).action((file, _options, command: Command) => {
  if (!file) {
    program.help();
    return;
  }

  // `optsWithGlobals` merges the options declared on the parent program with the
  // command's own: the security flags are declared on both, and commander stores a
  // parsed value on whichever declaration it matched first.
  runTarget(file, command.optsWithGlobals());
});

withSecurityOptions(
  program
    .command("run")
    .description("run a .ml file, or a named script from mylang.json")
    .argument("[target]", "file path or script name (omit to list scripts)")
    .argument(
      "[args...]",
      "arguments passed to the script (use -- before them)",
    )
    .option(
      "--watch [path]",
      "re-run on file changes (watches the file itself unless a path is given)",
    )
    .option("--delay <ms>", "debounce delay in ms before re-running", "1000")
    .option("--no-cache", "disable execution cache")
    .option("--verbose", "print full error stacks"),
).action(async (target, args, _options, command: Command) => {
  const options = command.optsWithGlobals();

  try {
    if (target && fs.existsSync(target) && fs.statSync(target).isFile()) {
      runTarget(target, options);
      return;
    }

    await packageScripts(target, args);
  } catch (err) {
    logError(err, options.verbose);
    process.exitCode = process.exitCode || 1;
  }
});

withSecurityOptions(
  program
    .command("test")
    .description("run *.test.ml files (defaults to ./test)")
    .argument("[target]", "a test file or a directory of test files")
    .option("--filter <text>", "only run tests whose name contains this text")
    .option("--bail", "stop at the first failure")
    .option("--no-color", "disable coloured output")
    .option("--verbose", "print every test, not only the failures")
    .option(
      "--jobs <n>",
      'run this many test files at once ("auto" picks a number for this machine)',
    ),
).action(async (target, _options, command: Command) => {
  const options = command.optsWithGlobals();

  try {
    applySecurity(process.cwd(), options);

    const failed = await runTests(target, options);

    if (failed > 0) process.exitCode = 1;
  } catch (err) {
    logError(err, options.verbose);
    process.exitCode = 1;
  }
});

program
  .command("prettier")
  .alias("fmt")
  .description(
    'format .ml files (settings from the "prettier" section of mylang.json)',
  )
  .argument(
    "[paths...]",
    "files, directories or globs (default: the current directory)",
  )
  .option("-w, --write", "rewrite the files in place")
  .option("-c, --check", "only check; exit 1 if a file is not formatted")
  .option("-l, --list-different", "print the files that are not formatted")
  .option("--stdin", "format standard input to standard output")
  .option(
    "--verify",
    "prove each result lexes to the same tokens as the original",
  )
  .option(
    "--config <file>",
    "read settings from this file instead of mylang.json",
  )
  .option("--no-config", "ignore mylang.json and use the defaults")
  .option("--indent <n>", "spaces per indentation level")
  .option("--use-tabs", "indent with tabs")
  .option(
    "--print-width <n>",
    "break longer lines where a bracket allows it (0 never)",
  )
  .option("--quote <style>", "double, single or preserve")
  .option("--no-bracket-spacing", "write {a: 1} rather than { a: 1 }")
  .option(
    "--max-blank-lines <n>",
    "keep at most this many empty lines in a row",
  )
  .option("--end-of-line <style>", "lf or crlf")
  .option("--no-final-newline", "do not end files with a line break")
  .action(async (paths: string[], options, command: Command) => {
    const given = (name: string) =>
      command.getOptionValueSource(name) === "cli";

    try {
      process.exitCode = await runPrettier(paths, options, given as any);
    } catch (err) {
      logError(err, false);
      process.exitCode = 2;
    }
  });

program
  .command("init")
  .description("initialize a new MyLang project")
  .option("-y, --yes", "accept default settings")
  .option("--no-prettier", "do not add formatter settings to mylang.json")
  .action((options) => {
    try {
      packageInt(options);
    } catch (err) {
      logError(err, options.verbose);
      process.exitCode = 1;
    }
  });

program
  .command("repl")
  .description("start an interactive MyLang REPL")
  .action(async () => {
    try {
      await replMyLang(pkg.version);
    } catch (err) {
      logError(err, false);
      process.exitCode = 1;
    }
  });

program
  .command("install")
  .alias("i")
  .description("install a package (omit name to install all dependencies)")
  .argument("[pkg]", "package name")
  .action(async (pkgName, options) => {
    try {
      await installPackage(pkgName);
    } catch (err) {
      logError(err, options.verbose);
      process.exitCode = 1;
    }
  });

program
  .command("uninstall")
  .aliases(["remove", "rm"])
  .description("remove an installed package")
  .argument("<pkg>", "package (owner:repo or repo)")
  .option("--verbose", "print full error stacks")
  .action(async (pkgName, options) => {
    try {
      await uninstallPackage(pkgName);
    } catch (err) {
      logError(err, options.verbose);
      process.exitCode = 1;
    }
  });

program
  .command("info")
  .description("show info about the current project (from mylang.json)")
  .option("--json", "print as JSON")
  .option("--verbose", "print full error stacks")
  .action(async (options) => {
    try {
      await showInfo(pkg.version, options);
    } catch (err) {
      logError(err, options.verbose);
      process.exitCode = 1;
    }
  });

const cache = program
  .command("cache")
  .description("manage the local execution cache");

cache
  .command("clear")
  .description("remove cached execution data")
  .action(() => {
    const cacheDir = path.join(process.cwd(), ".mylang", "cache");
    if (!fs.existsSync(cacheDir)) {
      console.log("Cache is already empty.");
      return;
    }
    fs.rmSync(cacheDir, { recursive: true, force: true });
    console.log(`\x1b[36mCache cleared (${cacheDir})\x1b[0m`);
  });

program
  .command("version")
  .description("print MyLang version")
  .action(() => console.log(pkg.version));

program.parse(process.argv);
