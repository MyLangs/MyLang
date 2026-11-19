/**
 * Colour in everything MyLang prints, and the one switch that turns it off.
 *
 * `mylang --no-colors ...` (or `--no-color`) turns colour off for the whole run:
 *
 *   - the interpreter's own messages, warnings and errors;
 *   - the test runner, the CLI and every library that prints;
 *   - what the program itself prints - even a colour code it built by hand - because the
 *     process's standard output and error drop colour codes on the way out;
 *   - workers and child processes, which inherit `MYLANG_NO_COLORS` and `NO_COLOR`.
 *
 * Functions whose whole purpose is colour (`utils/colors`, `coreio.colorize`) return the
 * text unchanged instead, and the first time one of them is asked for colour a single
 * warning says why - once per run, not once per call, so a loop does not flood the output.
 *
 * `NO_COLOR` on its own keeps the meaning it always had: the CLI and the test runner stop
 * colouring their own output, and a program's explicit colours are left to the program.
 */

const ENV_FLAG = "MYLANG_NO_COLORS";

let switchedOff = false;
let warned = false;
let streamsPatched = false;

/** Was colour turned off for this run (`--no-colors`, here or in a parent)? */
function colorsDisabled(): boolean {
  return switchedOff || process.env[ENV_FLAG] === "1";
}

/** Should MyLang's own output be coloured right now? */
function colorsEnabled(): boolean {
  return !colorsDisabled() && !process.env["NO_COLOR"];
}

/** `text` wrapped in the SGR colour `code` ("31", "1;33", ...), or plain when colour is off. */
function paintText(code: string, text: string): string {
  return colorsEnabled() ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/**
 * `text` without its colour codes (`ESC [ ... m`). Other escape sequences - moving the
 * cursor, clearing the screen - are not colour and are kept.
 */
function stripColors(text: string): string {
  if (!text.includes("\x1b[")) return text;

  let out = "";
  let i = 0;

  while (i < text.length) {
    if (text[i] === "\x1b" && text[i + 1] === "[") {
      let j = i + 2;

      // parameter bytes: digits, `;` and `:`
      while (j < text.length && /[0-9;:]/.test(text[j]!)) j++;

      if (text[j] === "m") {
        i = j + 1;
        continue;
      }
    }

    out += text[i];
    i++;
  }

  return out;
}

/** Wrap one standard stream so colour codes never leave the process. */
function patchStream(stream: NodeJS.WriteStream): void {
  const original = stream.write.bind(stream) as (...args: any[]) => boolean;

  (stream as any).write = (chunk: any, ...rest: any[]): boolean => {
    if (typeof chunk === "string") {
      return original(stripColors(chunk), ...rest);
    }

    // a buffer holding an escape byte is decoded, cleaned and sent as text
    if (chunk instanceof Uint8Array && chunk.includes(0x1b)) {
      const encoding = (
        typeof rest[0] === "string" ? rest[0] : "utf8"
      ) as BufferEncoding;

      return original(
        stripColors(Buffer.from(chunk).toString(encoding)),
        ...rest,
      );
    }

    return original(chunk, ...rest);
  };
}

/**
 * Turn colour off for the rest of the run. Idempotent. Called by the CLI before anything
 * is printed, and safe to call from inside a worker that inherited the switch.
 */
function disableColors(): void {
  switchedOff = true;

  process.env[ENV_FLAG] = "1";
  process.env["NO_COLOR"] = "1";

  // FORCE_COLOR would override NO_COLOR in a child, and Node warns when both are set
  delete process.env["FORCE_COLOR"];

  try {
    // chalk keeps its own idea of colour support, decided when it was loaded
    const chalk = require("chalk");

    if (chalk) chalk.level = 0;
  } catch {
    // chalk is optional here
  }

  if (!streamsPatched) {
    streamsPatched = true;
    patchStream(process.stdout);
    patchStream(process.stderr);
  }
}

/**
 * Say, once per run, that a colour function returned plain text because colour is off.
 * `where` names the function, so the warning points at what the program called.
 */
function noteColorsDisabled(where: string): void {
  if (warned) return;

  warned = true;

  // lazily required: the warning module prints through this one
  const { emitWarning } =
    require("../errors/utils/WarningError") as typeof import("../errors/utils/WarningError");

  emitWarning(
    `colours are turned off (--no-colors): ${where} and every other colour function return plain text`,
    { name: "ColorsDisabled", code: "WARN004" },
  );
}

/**
 * For a library function that produces coloured text: the text as it should be returned
 * right now. With colour on it is `text` itself; with colour off it is stripped, and the
 * one-time warning is given if there was anything to strip.
 */
function colourResult(text: unknown, where: string): unknown {
  if (typeof text !== "string" || !colorsDisabled()) return text;

  const plain = stripColors(text);

  if (plain !== text) noteColorsDisabled(where);

  return plain;
}

/** Read the switch from the command line and remove it, so no command sees an unknown flag. */
function takeNoColorsFlag(argv: string[]): boolean {
  // everything after `--` belongs to the program being run, never to MyLang
  const end = argv.indexOf("--", 2);
  const last = end === -1 ? argv.length : end;
  const positions: number[] = [];

  for (let i = 2; i < last; i++) {
    if (argv[i] === "--no-colors" || argv[i] === "--no-color")
      positions.push(i);
  }

  for (const index of positions.reverse()) argv.splice(index, 1);

  return positions.length > 0;
}

/** Forget the one-time warning. For tests of this module only. */
function resetColorWarning(): void {
  warned = false;
}

export {
  colorsEnabled,
  colorsDisabled,
  paintText,
  stripColors,
  disableColors,
  noteColorsDisabled,
  colourResult,
  takeNoColorsFlag,
  resetColorWarning,
};
