/**
 * Formatter options: the defaults, how `mylang.json` and the command line override them,
 * and the checks that turn a mistyped option into a clear error instead of a silent default.
 *
 * Precedence, lowest first:
 *
 *   1. the defaults below
 *   2. the `"prettier"` section of `mylang.json` (or of the file given to `--config`)
 *   3. flags on the command line
 */

import fs from "node:fs";
import path from "node:path";

type QuoteStyle = "double" | "single" | "preserve";
type EndOfLine = "lf" | "crlf";

interface FormatOptions {
  /** Spaces per level of indentation (ignored for the width of a tab when `useTabs`). */
  indent: number;
  /** Indent with tabs instead of spaces. */
  useTabs: boolean;
  /** Lines longer than this are broken at the commas of a bracket that closes on them; 0 never breaks. */
  printWidth: number;
  /** The quote plain strings are written with. `"""` and `$"..."` strings are never touched. */
  quote: QuoteStyle;
  /** `{ a: 1 }` rather than `{a: 1}`. */
  bracketSpacing: boolean;
  /** Runs of empty lines are cut down to this many. */
  maxBlankLines: number;
  /** The line ending written. */
  endOfLine: EndOfLine;
  /** End a non-empty file with exactly one line break. */
  finalNewline: boolean;
}

interface FileSelection {
  /** Which files a directory contributes (globs, relative to the project). */
  include: string[];
  /** Files and directories never touched (globs, relative to the project). */
  ignore: string[];
}

type ProjectConfig = FormatOptions & FileSelection;

const DEFAULT_OPTIONS: FormatOptions = {
  indent: 2,
  useTabs: false,
  printWidth: 100,
  quote: "double",
  bracketSpacing: true,
  maxBlankLines: 1,
  endOfLine: "lf",
  finalNewline: true,
};

const DEFAULT_SELECTION: FileSelection = {
  include: ["**/*.ml"],
  ignore: [
    "node_modules/**",
    "mylang_modules/**",
    ".module/**",
    ".mylang/**",
    "dist/**",
    ".git/**",
  ],
};

/** What `mylang init` writes into `mylang.json`. */
const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  ...DEFAULT_OPTIONS,
  ...DEFAULT_SELECTION,
};

class OptionError extends Error {
  override name = "PrettierOptionError";
}

const KNOWN = new Set<string>([
  ...Object.keys(DEFAULT_OPTIONS),
  ...Object.keys(DEFAULT_SELECTION),
]);

function expectInt(
  name: string,
  value: unknown,
  min: number,
  max: number,
): number {
  const number =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;

  if (
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number < min ||
    number > max
  ) {
    throw new OptionError(
      `prettier option '${name}' must be a whole number from ${min} to ${max}, got ${JSON.stringify(value)}`,
    );
  }

  return number;
}

function expectBool(name: string, value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;

  throw new OptionError(
    `prettier option '${name}' must be true or false, got ${JSON.stringify(value)}`,
  );
}

function expectOneOf<T extends string>(
  name: string,
  value: unknown,
  allowed: readonly T[],
): T {
  if (
    typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
  )
    return value as T;

  throw new OptionError(
    `prettier option '${name}' must be one of ${allowed.join(", ")}, got ${JSON.stringify(value)}`,
  );
}

function expectGlobs(name: string, value: unknown): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value;

  throw new OptionError(
    `prettier option '${name}' must be a list of glob strings`,
  );
}

/**
 * Validate a partial set of options from any source and return it typed. An unknown name
 * is an error: a misspelt option that silently does nothing is the worst kind of setting.
 */
function readOptions(
  raw: Record<string, unknown>,
  source: string,
): Partial<ProjectConfig> {
  const out: Partial<ProjectConfig> = {};

  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;

    if (!KNOWN.has(name)) {
      throw new OptionError(
        `unknown prettier option '${name}' in ${source}; known options: ${[...KNOWN].join(", ")}`,
      );
    }

    switch (name) {
      case "indent":
        out.indent = expectInt(name, value, 1, 16);
        break;
      case "useTabs":
        out.useTabs = expectBool(name, value);
        break;
      case "printWidth":
        out.printWidth = expectInt(name, value, 0, 1000);
        break;
      case "quote":
        out.quote = expectOneOf(name, value, [
          "double",
          "single",
          "preserve",
        ] as const);
        break;
      case "bracketSpacing":
        out.bracketSpacing = expectBool(name, value);
        break;
      case "maxBlankLines":
        out.maxBlankLines = expectInt(name, value, 0, 10);
        break;
      case "endOfLine":
        out.endOfLine = expectOneOf(name, value, ["lf", "crlf"] as const);
        break;
      case "finalNewline":
        out.finalNewline = expectBool(name, value);
        break;
      case "include":
        out.include = expectGlobs(name, value);
        break;
      case "ignore":
        out.ignore = expectGlobs(name, value);
        break;
    }
  }

  return out;
}

interface LoadedConfig {
  config: ProjectConfig;
  /** The file the settings came from, or `null` for the defaults alone. */
  file: string | null;
  /** The directory globs are relative to. */
  root: string;
}

/**
 * The project's settings. With `explicit` the file is read whatever it is called, and its
 * absence is an error; otherwise `mylang.json` is looked for from `start` upwards, the
 * way `mylang` finds its project everywhere else.
 */
function loadConfig(
  start: string,
  explicit: string | null,
  useFile = true,
): LoadedConfig {
  const fromDefaults = (root: string): LoadedConfig => ({
    config: { ...DEFAULT_PROJECT_CONFIG },
    file: null,
    root,
  });

  if (!useFile) return fromDefaults(start);

  let file: string | null = null;

  if (explicit) {
    file = path.resolve(explicit);

    if (!fs.existsSync(file))
      throw new OptionError(`config file not found: ${explicit}`);
  } else {
    for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, "mylang.json");

      if (fs.existsSync(candidate)) {
        file = candidate;
        break;
      }

      if (path.dirname(dir) === dir) break;
    }
  }

  if (!file) return fromDefaults(start);

  let parsed: any;

  try {
    // a config file is small and read once; it is the only thing not streamed
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error: any) {
    throw new OptionError(`cannot read ${file}: ${error?.message ?? error}`);
  }

  // `mylang.json` keeps the settings under "prettier"; a file of its own may hold them bare
  const section =
    parsed && typeof parsed === "object" && "prettier" in parsed
      ? parsed.prettier
      : path.basename(file) === "mylang.json"
        ? {}
        : parsed;

  if (
    section === null ||
    typeof section !== "object" ||
    Array.isArray(section)
  ) {
    throw new OptionError(`"prettier" in ${file} must be an object`);
  }

  return {
    config: { ...DEFAULT_PROJECT_CONFIG, ...readOptions(section, file) },
    file,
    root: path.dirname(file),
  };
}

export {
  DEFAULT_OPTIONS,
  DEFAULT_SELECTION,
  DEFAULT_PROJECT_CONFIG,
  OptionError,
  readOptions,
  loadConfig,
  type FormatOptions,
  type FileSelection,
  type ProjectConfig,
  type QuoteStyle,
  type EndOfLine,
  type LoadedConfig,
};
