/**
 * `mylang prettier [paths...]` - see prettier/README.md.
 *
 * Exit codes, as Prettier uses them:
 *   0  everything is formatted (or was just formatted)
 *   1  `--check` / `--list-different` found files that are not
 *   2  something could not be formatted at all (a syntax error, a bad option, a missing file)
 */

import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { minimatch } from "minimatch";
import {
  createFormatStream,
  formatFile,
  checkFile,
  formatText,
  FormatSyntaxError,
  hasFileIgnore,
  type IgnoreEvent,
} from "./index";
import {
  loadConfig,
  readOptions,
  OptionError,
  type ProjectConfig,
} from "./options";
import { Lexer } from "../src/lexer/Lexer";
import { paintText } from "../src/output/colors";

interface PrettierFlags {
  write?: boolean;
  check?: boolean;
  listDifferent?: boolean;
  stdin?: boolean;
  verify?: boolean;
  config?: string | boolean;
  indent?: string;
  useTabs?: boolean;
  printWidth?: string;
  quote?: string;
  bracketSpacing?: boolean;
  maxBlankLines?: string;
  endOfLine?: string;
  finalNewline?: boolean;
}

/** `name` was given on the command line (not just defaulted by commander)? */
type GivenOnCommandLine = (name: keyof PrettierFlags) => boolean;

const isGlob = (text: string) => /[*?[\]{}]/.test(text);

const toPosix = (file: string) => file.split(path.sep).join("/");

/** Every file under `dir`, walked lazily: nothing is listed ahead of time. */
async function* walk(
  dir: string,
  root: string,
  config: ProjectConfig,
): AsyncGenerator<string> {
  let handle: fs.Dir;

  try {
    handle = await fs.promises.opendir(dir);
  } catch {
    return;
  }

  for await (const entry of handle) {
    const full = path.join(dir, entry.name);
    const relative = toPosix(path.relative(root, full));

    if (isIgnored(relative, config, entry.isDirectory())) continue;

    if (entry.isDirectory()) {
      yield* walk(full, root, config);
    } else if (
      entry.isFile() &&
      config.include.some((glob) => minimatch(relative, glob, { dot: true }))
    ) {
      yield full;
    }
  }
}

function isIgnored(
  relative: string,
  config: ProjectConfig,
  directory: boolean,
): boolean {
  return config.ignore.some(
    (glob) =>
      minimatch(relative, glob, { dot: true }) ||
      (directory && minimatch(relative + "/", glob, { dot: true })) ||
      (directory && minimatch(relative + "/x", glob, { dot: true })),
  );
}

/** The files the arguments name, in order, each once. */
async function* selectFiles(
  targets: string[],
  root: string,
  config: ProjectConfig,
): AsyncGenerator<string> {
  const seen = new Set<string>();

  const once = function* (file: string) {
    const resolved = path.resolve(file);

    if (seen.has(resolved)) return;

    seen.add(resolved);
    yield resolved;
  };

  for (const target of targets.length > 0 ? targets : ["."]) {
    if (isGlob(target)) {
      const pattern = toPosix(target);

      for await (const file of walk(process.cwd(), process.cwd(), {
        ...config,
        include: [pattern],
      })) {
        yield* once(file);
      }

      continue;
    }

    let stat: fs.Stats;

    try {
      stat = await fs.promises.stat(target);
    } catch {
      throw new OptionError(`no such file or directory: ${target}`);
    }

    if (stat.isDirectory()) {
      for await (const file of walk(path.resolve(target), root, config))
        yield* once(file);
    } else {
      // a file named outright is formatted whatever its name, unless it is ignored
      const relative = toPosix(path.relative(root, path.resolve(target)));

      if (!isIgnored(relative, config, false)) yield* once(target);
    }
  }
}

/** The settings for this run: defaults, then the config file, then the flags. */
function resolveConfig(flags: PrettierFlags, given: GivenOnCommandLine) {
  const loaded = loadConfig(
    process.cwd(),
    typeof flags.config === "string" ? flags.config : null,
    flags.config !== false,
  );

  const fromFlags: Record<string, unknown> = {};

  if (given("indent")) fromFlags["indent"] = flags.indent;
  if (given("useTabs")) fromFlags["useTabs"] = flags.useTabs;
  if (given("printWidth")) fromFlags["printWidth"] = flags.printWidth;
  if (given("quote")) fromFlags["quote"] = flags.quote;
  if (given("bracketSpacing"))
    fromFlags["bracketSpacing"] = flags.bracketSpacing;
  if (given("maxBlankLines")) fromFlags["maxBlankLines"] = flags.maxBlankLines;
  if (given("endOfLine")) fromFlags["endOfLine"] = flags.endOfLine;
  if (given("finalNewline")) fromFlags["finalNewline"] = flags.finalNewline;

  return {
    ...loaded,
    config: { ...loaded.config, ...readOptions(fromFlags, "the command line") },
  };
}

/**
 * `--verify`: lex the original and the formatted text with the language's own lexer and
 * insist they are the same tokens. Formatting only ever moves whitespace, so this always
 * holds; the flag exists to prove it on your code. It reads each file whole, because the
 * language's lexer does.
 */
function verifyEquivalent(original: string, formatted: string): string | null {
  const before = new Lexer(original).analyze();
  const after = new Lexer(formatted).analyze();

  if (before.errors.length > 0) return null;

  if (after.errors.length > 0)
    return `formatting produced code that does not lex: ${after.errors[0]!.message}`;

  if (before.tokens.length !== after.tokens.length) {
    return `token count changed from ${before.tokens.length} to ${after.tokens.length}`;
  }

  for (let i = 0; i < before.tokens.length; i++) {
    const a = before.tokens[i]!;
    const b = after.tokens[i]!;

    if (a.type !== b.type || a.value !== b.value) {
      return `token ${i + 1} changed from ${JSON.stringify(a.value)} to ${JSON.stringify(b.value)}`;
    }
  }

  return null;
}

function describeError(file: string, error: unknown): string {
  const message =
    error instanceof FormatSyntaxError || error instanceof OptionError
      ? error.message
      : ((error as Error)?.message ?? String(error));

  return paintText("31", `[error] ${file}: ${message}`);
}

const relative = (file: string) =>
  toPosix(path.relative(process.cwd(), file)) || file;

// Diagnostics always go to stderr: --list-different and stdout formatting
// must keep their stdout machine-readable.
const reportIgnore =
  (file: string) =>
  (event: IgnoreEvent): void => {
    const name = relative(file);
    if (event.kind === "file") {
      console.error(paintText("90", `[skip] ${name}: file ignored`));
    } else if (event.kind === "line") {
      console.error(
        paintText("90", `[skip] ${name}:${event.line}: line ignored`),
      );
    } else {
      console.error(
        paintText(
          "90",
          `[skip] ${name}:${event.startLine}-${event.endLine}: block ignored`,
        ),
      );
    }
  };

async function runPrettier(
  targets: string[],
  flags: PrettierFlags,
  given: GivenOnCommandLine,
): Promise<number> {
  let resolved;

  try {
    resolved = resolveConfig(flags, given);
  } catch (error) {
    console.error(paintText("31", `[error] ${(error as Error).message}`));
    return 2;
  }

  const { config, root } = resolved;

  const modes = [flags.write, flags.check, flags.listDifferent].filter(
    Boolean,
  ).length;

  if (modes > 1) {
    console.error(
      paintText(
        "31",
        "[error] --write, --check and --list-different cannot be combined",
      ),
    );
    return 2;
  }

  // standard input to standard output, streamed end to end
  if (flags.stdin) {
    try {
      await pipeline(
        process.stdin,
        createFormatStream(config),
        async function* (source) {
          for await (const chunk of source) {
            if (!process.stdout.write(chunk)) {
              await new Promise((resolve) =>
                process.stdout.once("drain", resolve),
              );
            }
          }
        },
      );
      return 0;
    } catch (error) {
      console.error(describeError("<stdin>", error));
      return 2;
    }
  }

  let failures = 0;
  let unformatted = 0;
  let changed = 0;
  let total = 0;

  try {
    for await (const file of selectFiles(targets, root, config)) {
      total++;

      try {
        if (flags.verify) {
          const original = await fs.promises.readFile(file, "utf8");

          if (hasFileIgnore(original)) {
            reportIgnore(file)({ kind: "file" });
            continue;
          }

          const problem = verifyEquivalent(
            original,
            formatText(original, config),
          );

          if (problem) throw new Error(`--verify: ${problem}`);
        }

        if (flags.write) {
          if (await formatFile(file, config, reportIgnore(file))) {
            changed++;
            console.log(`${relative(file)} ${paintText("90", "formatted")}`);
          }
        } else if (flags.check || flags.listDifferent) {
          if (!(await checkFile(file, config, reportIgnore(file)))) {
            unformatted++;
            console.log(
              flags.check
                ? paintText("33", `[warn] ${relative(file)}`)
                : relative(file),
            );
          }
        } else {
          await pipeline(
            fs.createReadStream(file),
            createFormatStream(config, reportIgnore(file)),
            async function* (source) {
              for await (const chunk of source) {
                if (!process.stdout.write(chunk)) {
                  await new Promise((resolve) =>
                    process.stdout.once("drain", resolve),
                  );
                }
              }
            },
          );
        }
      } catch (error) {
        failures++;
        console.error(describeError(relative(file), error));
      }
    }
  } catch (error) {
    console.error(describeError(targets.join(" ") || ".", error));
    return 2;
  }

  if (total === 0) {
    console.error(paintText("31", "[error] no files matched"));
    return 2;
  }

  if (flags.write) {
    console.log(
      paintText(
        "90",
        `${changed} of ${total} file${total === 1 ? "" : "s"} formatted`,
      ),
    );
  }

  if (flags.check) {
    if (unformatted > 0) {
      console.log(
        paintText(
          "33",
          `[warn] ${unformatted} file${unformatted === 1 ? " is" : "s are"} not formatted; run mylang prettier --write`,
        ),
      );
    } else if (failures === 0) {
      console.log(paintText("32", "All matched files use MyLang style!"));
    }
  }

  if (failures > 0) return 2;

  return unformatted > 0 ? 1 : 0;
}

export { runPrettier, verifyEquivalent, reportIgnore, type PrettierFlags };
