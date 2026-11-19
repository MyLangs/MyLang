/**
 * The MyLang formatter, as streams.
 *
 *   createFormatStream(options)   a Transform: source text in, formatted text out
 *   formatFile(path, options)     format one file; rewrites it only if it changed
 *   checkFile(path, options)      is this file already formatted?
 *   formatText(text, options)     the same for a string in memory (small inputs, tests)
 *
 * Every path through here is a stream: a file is read in pieces, tokenized in pieces and
 * written in pieces, and the formatted copy is compared with the original in pieces. What
 * is held at once is one line of tokens and one unfinished token - never the file.
 */

import fs from "node:fs";
import path from "node:path";
import { Transform, Writable, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { FormatSyntaxError } from "./tokenizer";
import {
  IgnoreFormatter,
  hasFileIgnore,
  type IgnoreReporter,
  type IgnoreEvent,
} from "./ignore";
import { DEFAULT_OPTIONS, type FormatOptions } from "./options";

/** A Transform stream that formats MyLang source as it flows through. */
function createFormatStream(
  options: FormatOptions = DEFAULT_OPTIONS,
  onIgnore?: IgnoreReporter,
): Transform {
  const decoder = new StringDecoder("utf8");
  const formatter = new IgnoreFormatter(options, onIgnore);
  return new Transform({
    // backpressure works in both directions: a slow writer slows the reader
    highWaterMark: 64 * 1024,

    transform(
      chunk: Buffer | string,
      _encoding: BufferEncoding,
      done: TransformCallback,
    ) {
      try {
        const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
        // Keep the BOM untouched when a whole-file ignore directive is present.
        // The normal formatter strips it after deciding the file is not ignored.
        const out = formatter.push(text);
        done(null, out.length > 0 ? out : undefined);
      } catch (error) {
        done(error as Error);
      }
    },

    flush(done: TransformCallback) {
      try {
        const out = formatter.push(decoder.end()) + formatter.end();
        done(null, out.length > 0 ? out : undefined);
      } catch (error) {
        done(error as Error);
      }
    },
  });
}

/** Format a string held in memory. Uses exactly the same ignore rules as streams. */
function formatText(
  text: string,
  options: FormatOptions = DEFAULT_OPTIONS,
  onIgnore?: IgnoreReporter,
): string {
  const formatter = new IgnoreFormatter(options, onIgnore);
  return formatter.push(text) + formatter.end();
}

/**
 * A writable that compares what is written to it with a file, piece by piece, and
 * remembers whether everything matched. Neither side is ever held whole.
 */
function createComparison(file: string): {
  sink: Writable;
  result: () => Promise<boolean>;
} {
  const fd = fs.openSync(file, "r");
  let position = 0;
  let same = true;

  const sink = new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      if (!same) return done();

      const incoming = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const existing = Buffer.alloc(incoming.length);

      fs.read(
        fd,
        existing,
        0,
        incoming.length,
        position,
        (error, bytesRead) => {
          if (error) return done(error);

          if (bytesRead !== incoming.length || !existing.equals(incoming))
            same = false;

          position += incoming.length;
          done();
        },
      );
    },
  });

  const result = (): Promise<boolean> =>
    new Promise((resolve, reject) => {
      // the original must also end where the formatted copy ended
      fs.fstat(fd, (error, stat) => {
        fs.close(fd, () => undefined);

        if (error) return reject(error);

        resolve(same && stat.size === position);
      });
    });

  return { sink, result };
}

/** Is `file` exactly what formatting it would produce? */
async function checkFile(
  file: string,
  options: FormatOptions = DEFAULT_OPTIONS,
  onIgnore?: IgnoreReporter,
): Promise<boolean> {
  const { sink, result } = createComparison(file);

  await pipeline(
    fs.createReadStream(file),
    createFormatStream(options, onIgnore),
    sink,
  );

  return result();
}

/**
 * Format `file` in place. The formatted copy is streamed to a temporary file next to it
 * and renamed over the original only when it differs, so a file that fails to format, or
 * a run that is interrupted, never leaves a half-written original behind.
 * Returns whether the file changed.
 */
async function formatFile(
  file: string,
  options: FormatOptions = DEFAULT_OPTIONS,
  onIgnore?: IgnoreReporter,
): Promise<boolean> {
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.prettier-tmp`,
  );

  try {
    await pipeline(
      fs.createReadStream(file),
      createFormatStream(options, onIgnore),
      fs.createWriteStream(temporary),
    );

    const { sink, result } = createComparison(file);

    await pipeline(fs.createReadStream(temporary), sink);

    if (await result()) {
      await fs.promises.unlink(temporary);
      return false;
    }

    // keep the original's permissions
    const { mode } = await fs.promises.stat(file);

    await fs.promises.chmod(temporary, mode);
    await fs.promises.rename(temporary, file);

    return true;
  } catch (error) {
    await fs.promises.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export {
  createFormatStream,
  formatText,
  formatFile,
  checkFile,
  FormatSyntaxError,
  hasFileIgnore,
  type IgnoreReporter,
  type IgnoreEvent,
};
