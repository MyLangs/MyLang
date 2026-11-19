/**
 * A tokenizer that reads MyLang source a piece at a time.
 *
 * `push(chunk)` takes whatever arrived and returns every token that is now complete; a
 * token cut off by the end of the chunk waits for the next one. The only text held is that
 * unfinished token, so a file of any size is tokenized in the memory of its longest token.
 *
 * It sees exactly what the language's own lexer sees - strings ('...', "...", """...""",
 * $"..."), comments, numbers, names and operators - but keeps every token's text as it was
 * written, and remembers whether whitespace came before it. The formatter only ever
 * changes the space *between* tokens, so the program means the same before and after.
 */

import { OperatorType, TokenList } from "../src/lexer/token/TokenType";

type TokenKind =
  | "word"
  | "number"
  | "string"
  | "template"
  | "triple"
  | "lineComment"
  | "blockComment"
  | "punct"
  | "newline"
  | "other";

interface FmtToken {
  kind: TokenKind;
  /** The token exactly as written. */
  text: string;
  /** Was there whitespace (not a line break) right before it? */
  spaceBefore: boolean;
  line: number;
  column: number;
}

class FormatSyntaxError extends Error {
  override name = "PrettierSyntaxError";

  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`${message} at ${line}:${column}`);
  }
}

/** Every operator and symbol the language knows, longest first for longest-match. */
const PUNCTUATION: string[] = [
  ...new Set<string>([
    ...Object.values(OperatorType),
    ...Object.values(TokenList).filter(
      (symbol) => symbol !== '"' && symbol !== "'" && symbol !== "$",
    ),
  ]),
].sort((a, b) => b.length - a.length);

const LONGEST_PUNCTUATION = PUNCTUATION[0]!.length;

const isWordStart = (c: string) =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isWordPart = (c: string) => isWordStart(c) || (c >= "0" && c <= "9");
const isDigit = (c: string) => c >= "0" && c <= "9";
const isSpace = (c: string) =>
  c === " " || c === "\t" || c === "\f" || c === "\v" || c === " " || c === "﻿";

class StreamTokenizer {
  private buffer = "";
  private line = 1;
  private column = 1;
  private spaceSeen = false;

  /** True only for a token that can genuinely span physical lines. */
  get hasPendingToken(): boolean {
    return /^\s*(?:\/\*|"""|\$"|["'])/.test(this.buffer);
  }

  /** Complete tokens temporarily held for operator look-ahead at a line boundary. */
  flushPending(): FmtToken[] {
    return this.scan(true);
  }

  /** Advance source coordinates over a line that is intentionally not tokenized. */
  skipPhysicalLine(): void {
    this.line++;
    this.column = 1;
    this.spaceSeen = false;
  }

  /** Feed the next piece of text; returns the tokens it completed. */
  push(chunk: string): FmtToken[] {
    this.buffer += chunk;

    return this.scan(false);
  }

  /** No more text: return the rest, or throw if something was left open. */
  end(): FmtToken[] {
    const tokens = this.scan(true);

    if (this.buffer.length > 0) {
      throw new FormatSyntaxError(
        "unexpected end of input",
        this.line,
        this.column,
      );
    }

    return tokens;
  }

  private scan(final: boolean): FmtToken[] {
    const tokens: FmtToken[] = [];
    const text = this.buffer;
    let pos = 0;

    const emit = (kind: TokenKind, end: number) => {
      tokens.push({
        kind,
        text: text.slice(pos, end),
        spaceBefore: this.spaceSeen,
        line: this.line,
        column: this.column,
      });

      this.advance(text, pos, end);
      this.spaceSeen = false;
      pos = end;
    };

    while (pos < text.length) {
      const c = text[pos]!;
      const next = text[pos + 1];

      // `\r\n` is one line break; it needs the next character to be sure
      if (c === "\r") {
        if (next === undefined && !final) break;

        if (next === "\n") {
          tokens.push({
            kind: "newline",
            text: "\n",
            spaceBefore: false,
            line: this.line,
            column: this.column,
          });
          this.line++;
          this.column = 1;
          this.spaceSeen = false;
          pos += 2;
          continue;
        }

        this.spaceSeen = true;
        this.column++;
        pos++;
        continue;
      }

      if (c === "\n") {
        tokens.push({
          kind: "newline",
          text: "\n",
          spaceBefore: false,
          line: this.line,
          column: this.column,
        });
        this.line++;
        this.column = 1;
        this.spaceSeen = false;
        pos++;
        continue;
      }

      if (isSpace(c)) {
        this.spaceSeen = true;
        this.column++;
        pos++;
        continue;
      }

      if (c === "/") {
        if (next === undefined && !final) break;

        if (next === "/") {
          const end = text.indexOf("\n", pos);

          if (end === -1) {
            if (!final) break;

            // a trailing `\r` belongs to the line break, not the comment
            emit(
              "lineComment",
              text.endsWith("\r") ? text.length - 1 : text.length,
            );
            continue;
          }

          emit("lineComment", text[end - 1] === "\r" ? end - 1 : end);
          continue;
        }

        if (next === "*") {
          const end = text.indexOf("*/", pos + 2);

          if (end === -1) {
            if (!final) break;
            throw new FormatSyntaxError(
              "unterminated comment",
              this.line,
              this.column,
            );
          }

          emit("blockComment", end + 2);
          continue;
        }
      }

      if (c === '"' || c === "'" || c === "$") {
        const end = this.stringEnd(text, pos, final);

        if (end === null) break;

        if (end === -1) {
          emit("other", pos + 1);
          continue;
        }

        const kind: TokenKind =
          c === "$"
            ? "template"
            : text.startsWith('"""', pos)
              ? "triple"
              : "string";

        emit(kind, end);
        continue;
      }

      if (isDigit(c)) {
        const end = this.numberEnd(text, pos);

        // one character past it must be visible: `1.` may yet become `1.5`, `1e` `1e-3`
        if (end >= text.length - 1 && !final) break;

        emit("number", end);
        continue;
      }

      if (isWordStart(c)) {
        let end = pos + 1;

        while (end < text.length && isWordPart(text[end]!)) end++;

        if (end === text.length && !final) break;

        emit("word", end);
        continue;
      }

      // an operator may be up to four characters long: wait until they are all here
      if (text.length - pos < LONGEST_PUNCTUATION && !final) break;

      const operator = PUNCTUATION.find((candidate) =>
        text.startsWith(candidate, pos),
      );

      emit(operator ? "punct" : "other", pos + (operator?.length ?? 1));
    }

    this.buffer = text.slice(pos);

    return tokens;
  }

  /**
   * Where the string starting at `pos` ends (exclusive), following the language's lexer:
   * `'...'` and `"..."` stay on one line, `"""..."""` and `$"..."` may span lines, and a
   * backslash always takes the next character with it. `null` means more text is needed;
   * `-1` means the `$` does not start a string at all.
   */
  private stringEnd(text: string, pos: number, final: boolean): number | null {
    const c = text[pos]!;
    let quote = c;
    let i = pos + 1;
    let multiline = false;

    if (c === "$") {
      if (pos + 1 >= text.length) return final ? -1 : null;
      if (text[pos + 1] !== '"') return -1;

      quote = '"';
      i = pos + 2;
      multiline = true;
    } else if (c === '"') {
      if (text.length - pos < 3 && !final) return null;

      if (text.startsWith('"""', pos)) {
        for (let j = pos + 3; j < text.length; j++) {
          if (text[j] === "\\") {
            j++;
            continue;
          }

          if (text.startsWith('"""', j)) return j + 3;
        }

        if (!final) return null;
        throw new FormatSyntaxError(
          'unterminated """ string',
          this.line,
          this.column,
        );
      }
    }

    for (; i < text.length; i++) {
      const ch = text[i]!;

      if (ch === "\\") {
        if (i + 1 >= text.length) break;
        i++;
        continue;
      }

      if (ch === quote) return i + 1;

      if (ch === "\n" && !multiline) {
        throw new FormatSyntaxError(
          "unterminated string",
          this.line,
          this.column,
        );
      }
    }

    if (!final) return null;

    throw new FormatSyntaxError("unterminated string", this.line, this.column);
  }

  /** Where the number starting at `pos` ends: digits, letters (hex, `n`, `e`), `_`, a decimal point, an exponent sign. */
  private numberEnd(text: string, pos: number): number {
    const prefix = text.slice(pos, pos + 2).toLowerCase();
    const based = prefix === "0x" || prefix === "0b" || prefix === "0o";
    let end = pos + 1;
    let seenDot = false;

    while (end < text.length) {
      const ch = text[end]!;

      if (isWordPart(ch)) {
        end++;
        continue;
      }

      if (
        ch === "." &&
        !seenDot &&
        !based &&
        end + 1 < text.length &&
        isDigit(text[end + 1]!)
      ) {
        seenDot = true;
        end++;
        continue;
      }

      const before = text[end - 1]!;

      if (
        (ch === "+" || ch === "-") &&
        !based &&
        (before === "e" || before === "E")
      ) {
        end++;
        continue;
      }

      break;
    }

    return end;
  }

  private advance(text: string, from: number, to: number): void {
    for (let i = from; i < to; i++) {
      if (text[i] === "\n") {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
    }
  }
}

export {
  StreamTokenizer,
  FormatSyntaxError,
  PUNCTUATION,
  type FmtToken,
  type TokenKind,
};
