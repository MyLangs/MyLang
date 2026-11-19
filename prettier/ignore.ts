/**
 * Streaming support for @mylang/prettier-ignore comments.
 *
 * A whole-file marker is recognized as the first non-whitespace line, and preserves
 * the original file byte-for-byte (including CRLF and a possible BOM). Other markers
 * protect physical source lines; they are never sent through the formatter.
 *
 * Only one unfinished physical line is buffered at once. The initial run of blank
 * lines is delayed until it is known whether the whole file is ignored.
 */
import { StreamTokenizer, type FmtToken } from "./tokenizer";
import { LineFormatter } from "./formatter";
import type { FormatOptions } from "./options";

export type IgnoreEvent =
  | { kind: "file" }
  | { kind: "line"; line: number }
  | { kind: "block"; startLine: number; endLine: number };

export type IgnoreReporter = (event: IgnoreEvent) => void;

// The entire physical line must be a comment: never confuse "ignore-next-line"
// with the whole-file "ignore" marker.
const DIRECTIVE =
  /^[\uFEFF\u00A0 \t\f\v]*\/\/[ \t]*@mylang\/prettier-(ignore(?:-next-line|-start|-end)?)[ \t]*$/;

function directive(line: string): string | null {
  return DIRECTIVE.exec(line)?.[1] ?? null;
}

/** Used by --verify, which already holds its source in memory. */
export function hasFileIgnore(text: string): boolean {
  const first = text.replace(/^[\uFEFF\s]*/, "").split(/\r?\n/, 1)[0] ?? "";
  return directive(first) === "ignore";
}

export class IgnoreFormatter {
  private readonly tokenizer = new StreamTokenizer();
  private readonly formatter: LineFormatter;
  private pending = "";
  private leading = "";
  private initial = true;
  private ignoredFile = false;
  private nextLine = false;
  private blockStart: number | null = null;
  private lineNumber = 1;

  constructor(
    options: FormatOptions,
    private readonly report?: IgnoreReporter,
  ) {
    this.formatter = new LineFormatter(options);
  }

  /** Feed a decoded chunk; output is whatever is now final. */
  push(chunk: string): string {
    this.pending += chunk;
    let out = "";

    for (;;) {
      const end = this.pending.indexOf("\n");
      if (end === -1) break;

      const hasCR = end > 0 && this.pending[end - 1] === "\r";
      const line = this.pending.slice(0, hasCR ? end - 1 : end);
      const eol = hasCR ? "\r\n" : "\n";
      this.pending = this.pending.slice(end + 1);
      out += this.consumeLine(line, eol);
    }

    return out;
  }

  /** Flush the final line, including a file that does not end in a newline. */
  end(): string {
    let out = "";
    if (this.pending.length > 0) out += this.consumeLine(this.pending, "");
    this.pending = "";

    if (this.ignoredFile) return out;

    if (this.initial) {
      this.initial = false;
      out += this.formatted(this.leading);
      this.leading = "";
    }

    if (this.blockStart !== null) {
      this.report?.({
        kind: "block",
        startLine: this.blockStart,
        endLine: this.lineNumber - 1,
      });
    }

    out += this.formattedEnd();
    return out;
  }

  private formatted(text: string): string {
    let out = "";
    for (const token of this.tokenizer.push(text))
      out += this.formatter.write(token);
    return out;
  }

  private formattedEnd(): string {
    let out = "";
    for (const token of this.tokenizer.end())
      out += this.formatter.write(token);
    return out + this.formatter.end();
  }

  private raw(line: string, eol: string): string {
    // The ignored source must NOT be tokenized: it can deliberately contain invalid
    // syntax. Try an independent lexer only to track bracket indentation afterwards.
    let tokens: FmtToken[] = [];
    try {
      const reader = new StreamTokenizer();
      tokens = reader.push(line + "\n");
      tokens.push(...reader.end());
    } catch {
      // Invalid ignored code is allowed; do not let it break formatting.
    }
    let out = "";
    for (const token of this.tokenizer.flushPending())
      out += this.formatter.write(token);
    if (eol) this.tokenizer.skipPhysicalLine();
    return out + this.formatter.writeRawLine(line, eol, tokens);
  }

  private consumeLine(line: string, eol: string): string {
    const number = this.lineNumber++;
    const full = line + eol;
    if (this.ignoredFile) return full;

    if (this.initial) {
      if (/^[\uFEFF\s]*$/.test(line)) {
        this.leading += full;
        return "";
      }
      this.initial = false;
      if (directive(line) === "ignore") {
        this.ignoredFile = true;
        this.report?.({ kind: "file" });
        const all = this.leading + full;
        this.leading = "";
        return all;
      }
      const initial = this.formatted(this.leading);
      this.leading = "";
      return initial + this.consumeContent(line, eol, number);
    }
    return this.consumeContent(line, eol, number);
  }

  private consumeContent(line: string, eol: string, number: number): string {
    // A comment-like physical line inside a multiline string / block comment is
    // NOT a directive. The tokenizer retains the still-open multiline token.
    const marker = this.tokenizer.hasPendingToken ? null : directive(line);

    if (this.blockStart !== null) {
      const out = this.raw(line, eol);
      if (marker === "ignore-end") {
        this.report?.({
          kind: "block",
          startLine: this.blockStart,
          endLine: number,
        });
        this.blockStart = null;
      }
      return out;
    }

    if (this.nextLine) {
      this.nextLine = false;
      this.report?.({ kind: "line", line: number });
      return this.raw(line, eol);
    }

    if (marker === "ignore-next-line") {
      this.nextLine = true;
      return this.raw(line, eol);
    }
    if (marker === "ignore-start") {
      this.blockStart = number;
      return this.raw(line, eol);
    }
    if (marker === "ignore-end") {
      // Unmatched end marker is a normal source comment.
      return this.formatted(line + eol);
    }
    // Whole-file ignore only has meaning as the first non-whitespace line.
    return this.formatted(line + eol);
  }
}
