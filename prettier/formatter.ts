/**
 * Turns a stream of tokens into formatted text, one line at a time.
 *
 * What it decides:
 *
 *   - indentation, from the brackets: a line that leaves brackets open indents the lines
 *     after it by one level (however many brackets it opened), and the line that closes
 *     them returns to where the opening line was;
 *   - continuation lines (`.method()`, `&& next`, the line after `x =`) one level deeper;
 *   - the space between every two tokens on a line;
 *   - blank lines: never at the start of a block or the file, never before a closing
 *     bracket, never more than `maxBlankLines` in a row;
 *   - quotes, when `quote` asks for it, choosing the quote that needs fewer escapes;
 *   - lines longer than `printWidth`, broken at the commas of a bracket that opens and
 *     closes on that line, one item per line.
 *
 * What it never does is add, remove or reorder a token. Where a line breaks is the
 * author's choice except for the long-line rule above, which only moves the break between
 * existing tokens - so the program means exactly what it meant before.
 *
 * Only the current line's tokens are held, so memory does not grow with the file.
 */

import { PUNCTUATION, type FmtToken } from "./tokenizer";
import { type FormatOptions } from "./options";

const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);

/** Words after which `(` or `[` is not a call or an index, so a space separates them. */
const SPACED_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "match",
  "catch",
  "return",
  "throw",
  "case",
  "in",
  "typeof",
  "spawn",
  "wait",
  "defer",
  "else",
  "as",
  "var",
  "const",
  "readonly",
  "lazy",
  "try",
  "finally",
  "enum",
  "struct",
  "default",
]);

/** Words after which `-` and `+` begin an operand rather than continue one. */
const EXPRESSION_KEYWORDS = new Set([
  "return",
  "throw",
  "case",
  "in",
  "typeof",
  "else",
  "wait",
  "spawn",
  "defer",
  "var",
  "const",
  "readonly",
  "lazy",
]);

/** Symbols that are never binary operators, whatever surrounds them. */
const NOT_BINARY = new Set([
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  ";",
  ":",
  ".",
  "...",
  "?",
  "!",
  "~",
  "++",
  "--",
]);

/** A line that starts with one of these continues the expression above it. */
const CONTINUES = new Set([
  ".",
  "?",
  ":",
  "&&",
  "||",
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
]);

/** A line that ends with one of these is continued by the next. */
const CONTINUED_BY_NEXT = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "**=",
  "&&=",
  "||=",
  "&=",
  "|=",
  "^=",
  "<<=",
  ">>=",
  ">>>=",
  "&&",
  "||",
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
  "?",
]);

/** Text that must never be produced by joining two tokens without a space. */
const DANGEROUS_JOINS = [...PUNCTUATION, "//", "/*", "*/"];

const isComment = (t: FmtToken) =>
  t.kind === "lineComment" || t.kind === "blockComment";

/** Would writing `a` and `b` with nothing between them read back as different tokens? */
function joinIsDangerous(a: FmtToken, b: FmtToken): boolean {
  if (a.kind === "word" || a.kind === "number") {
    if (b.kind === "word" || b.kind === "number") return true;
  }

  if (a.kind !== "punct" && a.kind !== "other") return false;
  if (b.kind !== "punct" && b.kind !== "other") return false;

  const joined = a.text + b.text;

  return DANGEROUS_JOINS.some(
    (op) =>
      op.length > a.text.length &&
      (joined.startsWith(op) || op.startsWith(joined)),
  );
}

/** A group of brackets opened on one line, closed over the lines that follow. */
interface Group {
  open: number;
  /** The indent of the line that opened it. */
  base: number;
}

class LineFormatter {
  private line: FmtToken[] = [];
  private groups: Group[] = [];
  private blankLines = 0;
  private emittedAny = false;
  /** A protected line already carries its own newline (possibly CRLF). */
  private lastRaw = false;
  private rawEndedWithEol = false;
  /** The last code token of the last line written (comments skipped). */
  private lastToken: FmtToken | null = null;
  private readonly eol: string;

  constructor(private readonly options: FormatOptions) {
    this.eol = options.endOfLine === "crlf" ? "\r\n" : "\n";
  }

  /** Take one token; returns formatted text that is now final (often empty). */
  write(token: FmtToken): string {
    if (token.kind === "newline") {
      return this.flushLine();
    }

    this.line.push(token);

    return "";
  }

  /** The end of the input: the last line, and the final newline. */
  end(): string {
    let out = this.flushLine(true);

    if (this.emittedAny && this.options.finalNewline && !this.lastRaw)
      out += this.eol;

    return out;
  }

  /** Emit an ignored physical line verbatim, while keeping indentation context. */
  writeRawLine(raw: string, originalEol: string, tokens: FmtToken[]): string {
    let out = "";
    const blanks = Math.min(this.blankLines, this.options.maxBlankLines);

    if (this.emittedAny) {
      if (!this.lastRaw || !this.rawEndedWithEol) out += this.eol;
      out += this.eol.repeat(blanks);
    }
    out += raw + originalEol;
    this.blankLines = 0;
    this.emittedAny = true;
    this.lastRaw = true;
    this.rawEndedWithEol = originalEol.length > 0;

    // Track brackets in ignored valid code to preserve the indentation of
    // subsequent formatted lines. Unlexable ignored lines are left untouched.
    const code = tokens.filter((token) => token.kind !== "newline");
    let index = 0;
    let indent = this.currentIndent();
    let base: number | null = null;
    while (
      index < code.length &&
      code[index]!.kind === "punct" &&
      CLOSERS.has(code[index]!.text)
    ) {
      const closed = this.closeOne();
      if (base === null && closed !== null) base = closed;
      index++;
    }
    if (base !== null) indent = base;

    let pending = 0;
    for (; index < code.length; index++) {
      const token = code[index]!;
      if (token.kind !== "punct") continue;
      if (OPENERS.has(token.text)) pending++;
      else if (CLOSERS.has(token.text)) {
        if (pending > 0) pending--;
        else this.closeOne();
      }
    }
    if (pending > 0) this.groups.push({ open: pending, base: indent });
    for (let i = code.length - 1; i >= 0; i--) {
      if (!isComment(code[i]!)) {
        this.lastToken = code[i]!;
        break;
      }
    }
    return out;
  }

  // ----------------------------------------------------------------- lines

  private flushLine(atEnd = false): string {
    const tokens = this.line;

    this.line = [];

    if (tokens.length === 0) {
      if (!atEnd) this.blankLines++;
      return "";
    }

    const first = tokens[0]!;
    const startsWithCloser = first.kind === "punct" && CLOSERS.has(first.text);

    // --- indentation, from the groups of brackets left open by earlier lines
    let indent = this.currentIndent();
    let touchedBase: number | null = null;
    let index = 0;

    while (
      index < tokens.length &&
      tokens[index]!.kind === "punct" &&
      CLOSERS.has(tokens[index]!.text)
    ) {
      const base = this.closeOne();

      if (base !== null && touchedBase === null) touchedBase = base;

      index++;
    }

    if (touchedBase !== null) {
      indent = touchedBase;
    } else if (!startsWithCloser && this.isContinuation(first)) {
      indent += 1;
    }

    // the rest of the line: openers count towards one new group, closers close
    let pending = 0;

    for (; index < tokens.length; index++) {
      const token = tokens[index]!;

      if (token.kind !== "punct") continue;

      if (OPENERS.has(token.text)) {
        pending++;
      } else if (CLOSERS.has(token.text)) {
        if (pending > 0) pending--;
        else this.closeOne();
      }
    }

    if (pending > 0) this.groups.push({ open: pending, base: indent });

    // --- blank lines before this one
    let blanks = Math.min(this.blankLines, this.options.maxBlankLines);

    this.blankLines = 0;

    const afterOpener =
      this.lastToken !== null &&
      this.lastToken.kind === "punct" &&
      OPENERS.has(this.lastToken.text);

    if (!this.emittedAny || startsWithCloser || afterOpener) blanks = 0;

    // --- the text
    const lines = this.layout(tokens, indent);

    let out = "";

    if (this.emittedAny)
      out += this.eol.repeat(
        (this.lastRaw && this.rawEndedWithEol ? 0 : 1) + blanks,
      );

    out += lines.join(this.eol);

    this.emittedAny = true;
    this.lastRaw = false;

    for (let i = tokens.length - 1; i >= 0; i--) {
      if (!isComment(tokens[i]!)) {
        this.lastToken = tokens[i]!;
        break;
      }
    }

    return out;
  }

  private currentIndent(): number {
    const top = this.groups[this.groups.length - 1];

    return top ? top.base + 1 : 0;
  }

  /** Close one bracket; returns the base of the group it belonged to, or `null` if none was open. */
  private closeOne(): number | null {
    const top = this.groups[this.groups.length - 1];

    if (!top) return null;

    top.open--;

    if (top.open === 0) this.groups.pop();

    return top.base;
  }

  private isContinuation(first: FmtToken): boolean {
    const last = this.lastToken;

    if (first.kind === "punct" && CONTINUES.has(first.text)) {
      // after a separator or an opening bracket a new item starts: nothing continues
      if (
        last !== null &&
        last.kind === "punct" &&
        (last.text === "," || last.text === ";" || OPENERS.has(last.text))
      ) {
        return false;
      }

      // `-` and `+` are signs unless the line above ended with a value
      if (first.text === "-" || first.text === "+") {
        return (
          last !== null &&
          !this.startsOperand(last) &&
          !(last.kind === "punct" && last.text === "}")
        );
      }

      return true;
    }

    return (
      last !== null && last.kind === "punct" && CONTINUED_BY_NEXT.has(last.text)
    );
  }

  private indentText(level: number): string {
    return this.options.useTabs
      ? "\t".repeat(level)
      : " ".repeat(level * this.options.indent);
  }

  private width(level: number, text: string): number {
    return level * this.options.indent + text.length;
  }

  // ----------------------------------------------------------------- long lines

  /**
   * One logical line as one or more physical lines. A line over `printWidth` is broken
   * at the top-level commas of the first bracket that both opens and closes on it, and
   * each piece is laid out again, so nested brackets break in turn when they still do not
   * fit.
   */
  private layout(tokens: FmtToken[], level: number): string[] {
    const text = this.render(tokens);
    const width = this.options.printWidth;

    // a multi-line comment or string carries its own layout: never break around it
    if (
      width === 0 ||
      this.width(level, text) <= width ||
      text.includes("\n")
    ) {
      return [this.indentText(level) + text];
    }

    const split = this.findSplit(tokens);

    if (!split) return [this.indentText(level) + text];

    const { open, close, commas } = split;
    const lines: string[] = [];

    lines.push(...this.layout(tokens.slice(0, open + 1), level));

    let start = open + 1;

    for (const comma of [...commas, close]) {
      // the comma stays with its item
      const end = comma === close ? close : comma + 1;
      const item = tokens.slice(start, end);

      if (item.length > 0) lines.push(...this.layout(item, level + 1));

      start = comma + 1;
    }

    lines.push(...this.layout(tokens.slice(close), level));

    return lines;
  }

  private findSplit(
    tokens: FmtToken[],
  ): { open: number; close: number; commas: number[] } | null {
    for (let open = 0; open < tokens.length; open++) {
      const opener = tokens[open]!;

      if (opener.kind !== "punct" || !OPENERS.has(opener.text)) continue;

      let depth = 0;
      const commas: number[] = [];

      for (let i = open; i < tokens.length; i++) {
        const t = tokens[i]!;

        if (t.kind === "lineComment") break;
        if (t.kind !== "punct") continue;

        if (OPENERS.has(t.text)) depth++;
        else if (CLOSERS.has(t.text)) {
          depth--;

          if (depth === 0) {
            // only a bracket with something to separate is worth breaking
            if (commas.length > 0) return { open, close: i, commas };
            break;
          }
        } else if (t.text === "," && depth === 1) {
          commas.push(i);
        }
      }
    }

    return null;
  }

  // ----------------------------------------------------------------- spacing

  /** The tokens of one line, spaced. */
  private render(tokens: FmtToken[]): string {
    let out = "";
    let depth = 0;
    const ternaries = new Map<number, number>();

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      const prev = i > 0 ? tokens[i - 1]! : null;
      const next = i + 1 < tokens.length ? tokens[i + 1]! : null;
      const before = i > 1 ? tokens[i - 2]! : null;

      let text = token.text;

      if (token.kind === "string") text = this.requote(text);

      if (prev)
        out += this.space(prev, token, next, before, depth, ternaries)
          ? " "
          : "";

      if (token.kind === "punct") {
        if (OPENERS.has(token.text)) depth++;
        else if (CLOSERS.has(token.text)) depth--;
        else if (token.text === "?" && !this.isOptionalChain(token, next)) {
          ternaries.set(depth, (ternaries.get(depth) ?? 0) + 1);
        } else if (token.text === ":" && (ternaries.get(depth) ?? 0) > 0) {
          ternaries.set(depth, ternaries.get(depth)! - 1);
        }
      }

      out += text;
    }

    return out;
  }

  private isOptionalChain(question: FmtToken, next: FmtToken | null): boolean {
    return (
      question.text === "?" &&
      next !== null &&
      next.kind === "punct" &&
      (next.text === "." || next.text === "[")
    );
  }

  /** Does `token` begin an operand here (so `-` and `+` are signs, not operators)? */
  private startsOperand(prev: FmtToken | null): boolean {
    if (prev === null) return true;

    if (prev.kind === "word") return EXPRESSION_KEYWORDS.has(prev.text);

    if (prev.kind === "punct") {
      return !(
        CLOSERS.has(prev.text) ||
        prev.text === "++" ||
        prev.text === "--"
      );
    }

    return false;
  }

  private isUnary(token: FmtToken, prev: FmtToken | null): boolean {
    if (token.text === "!" || token.text === "~") return true;

    if (token.text === "-" || token.text === "+")
      return this.startsOperand(prev);

    if (token.text === "++" || token.text === "--") {
      // postfix after a value, prefix otherwise
      return this.startsOperand(prev);
    }

    return false;
  }

  private isBinary(token: FmtToken, prev: FmtToken | null): boolean {
    if (token.kind !== "punct" || NOT_BINARY.has(token.text)) return false;

    return !this.isUnary(token, prev);
  }

  /** Is there a space between `prev` and `token`? */
  private space(
    prev: FmtToken,
    token: FmtToken,
    next: FmtToken | null,
    before: FmtToken | null,
    depth: number,
    ternaries: Map<number, number>,
  ): boolean {
    const decided = this.decide(prev, token, next, before, depth, ternaries);

    // whatever the rule says, two tokens that would fuse into a different one stay apart
    if (decided === false && joinIsDangerous(prev, token)) return true;

    return decided;
  }

  private decide(
    prev: FmtToken,
    token: FmtToken,
    next: FmtToken | null,
    before: FmtToken | null,
    depth: number,
    ternaries: Map<number, number>,
  ): boolean {
    const p = prev.text;
    const t = token.text;
    const pPunct = prev.kind === "punct";
    const tPunct = token.kind === "punct";
    const bracketSpacing = this.options.bracketSpacing;

    // comments keep one space from what precedes them
    if (isComment(token) || isComment(prev)) return true;

    // tokens of an unknown kind keep the spacing they were written with
    if (prev.kind === "other" || token.kind === "other")
      return token.spaceBefore;

    // `1 .x` and `1.x` lex differently: keep whichever was written
    if (prev.kind === "number" && tPunct && t === ".") return token.spaceBefore;

    if (tPunct && (t === "," || t === ";")) return false;

    // braces: `{}` empty, `{ a }` with bracketSpacing, a space before an opening one
    if (tPunct && t === "}") return !(pPunct && p === "{") && bracketSpacing;
    if (pPunct && p === "{") return bracketSpacing;

    if (pPunct && (p === "," || p === ";")) return !(tPunct && CLOSERS.has(t));

    if (tPunct && (t === ")" || t === "]")) return false;
    if (pPunct && (p === "(" || p === "[")) return false;

    if (tPunct && t === "{") return true;

    // member access and spread
    if (tPunct && t === ".") return false;
    if (pPunct && (p === "." || p === "...")) return false;

    // optional chaining `a?.b` / `a?[i]` sticks together
    if (tPunct && t === "?" && this.isOptionalChain(token, next)) return false;
    if (pPunct && p === "?" && this.isOptionalChain(prev, token)) return false;

    // the ternary and the colon
    if (tPunct && t === "?") return true;
    if (tPunct && t === ":") return (ternaries.get(depth) ?? 0) > 0;
    if (pPunct && (p === "?" || p === ":")) return true;

    // after a closing brace: `} else`, `}.x`, `})`; `}[` and `}(` can be an index or a
    // call on an object literal as well as a new statement, so they keep what was written
    if (pPunct && p === "}") {
      if (tPunct && (t === "[" || t === "(")) return token.spaceBefore;
      return !(tPunct && (t === ")" || t === "]" || t === "."));
    }

    // `(` and `[`: a call or an index sticks to its target, a keyword does not
    if (tPunct && (t === "(" || t === "[")) {
      // a member name is never a keyword: `import.as(...)`, `x.match(...)`
      const isMember =
        before !== null && before.kind === "punct" && before.text === ".";

      if (prev.kind === "word" && isMember) return false;

      // `-(x)`, `!(a && b)`: a prefix operator keeps its operand
      if (pPunct && this.isUnary(prev, before)) return false;

      if (prev.kind === "word") {
        if (p === "import" || p === "export") return token.spaceBefore;
        if (p === "func") return t === "[";
        return SPACED_KEYWORDS.has(p);
      }

      if (pPunct && (p === ")" || p === "]")) return false;
      if (
        prev.kind === "string" ||
        prev.kind === "template" ||
        prev.kind === "triple"
      ) {
        return t === "(" ? false : token.spaceBefore;
      }
      if (pPunct && (p === "++" || p === "--")) return true;

      // after an operator, a comma, `return`... it starts an operand
      return pPunct && !CLOSERS.has(p);
    }

    // `i++` sticks to its operand; a prefix `++i` is spaced like any other prefix
    if (tPunct && (t === "++" || t === "--") && !this.isUnary(token, prev))
      return false;

    // nothing separates a prefix operator from its operand
    if (pPunct && this.isUnary(prev, before)) return false;

    // after a postfix `i++`, the next token is spaced as after any value
    if (pPunct && (p === "++" || p === "--")) return true;

    if (tPunct && t === "...") return !(pPunct && OPENERS.has(p));

    // a binary operator has a space on each side
    if (this.isBinary(token, prev) || (pPunct && this.isBinary(prev, before)))
      return true;

    // a prefix operator after something: `= -x`, `return !x`, `(!x` (handled above)
    if (tPunct && this.isUnary(token, prev)) return !(pPunct && OPENERS.has(p));

    // words, numbers and strings next to each other
    return true;
  }

  // ----------------------------------------------------------------- quotes

  /**
   * A `'...'` or `"..."` string in the configured quote, unless that quote would need more
   * escapes than the one it has. The string's value never changes: `\'` and `\"` are both
   * valid in either kind of string, so moving a quote between escaped and plain is safe.
   */
  private requote(raw: string): string {
    const style = this.options.quote;

    if (style === "preserve") return raw;

    return this.reencode(
      raw,
      this.cheaperQuote(raw, style === "double" ? '"' : "'"),
    );
  }

  private cheaperQuote(raw: string, preferred: string): string {
    const other = preferred === '"' ? "'" : '"';
    let preferredCount = 0;
    let otherCount = 0;

    for (let i = 1; i < raw.length - 1; i++) {
      let ch = raw[i]!;

      if (ch === "\\") {
        ch = raw[i + 1] ?? "";
        i++;
      }

      if (ch === preferred) preferredCount++;
      else if (ch === other) otherCount++;
    }

    return preferredCount > otherCount ? other : preferred;
  }

  private reencode(raw: string, quote: string): string {
    let out = quote;

    for (let i = 1; i < raw.length - 1; i++) {
      const ch = raw[i]!;

      if (ch === "\\") {
        const escaped = raw[i + 1] ?? "";

        i++;

        if (escaped === '"' || escaped === "'") {
          out += escaped === quote ? "\\" + escaped : escaped;
        } else {
          out += "\\" + escaped;
        }

        continue;
      }

      out += ch === quote ? "\\" + ch : ch;
    }

    return out + quote;
  }
}

export { LineFormatter };
