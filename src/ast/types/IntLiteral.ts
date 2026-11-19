import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";

class IntLiteral extends StmtType {
  public readonly value: string;
  public readonly position: Position;

  /**
   * The number this literal means, worked out once.
   *
   * The text of a literal cannot change after it is parsed, so neither can its value.
   * Deciding it here rather than in `evaluate` matters because `evaluate` runs on every
   * pass through the code that contains it: a literal inside a loop was being stripped of
   * underscores, tested for a decimal point, matched against a regular expression for an
   * exponent and converted from text again on every single iteration. A million-iteration
   * loop did that a million times to reach the same answer.
   */
  private readonly resolved: number | bigint;

  constructor(value: string, position: Position) {
    super();

    this.value = value;

    this.position = position;

    this.resolved = IntLiteral.parse(value);
  }

  /** Text to number, exactly as `evaluate` used to do it. */
  private static parse(value: string): number | bigint {
    const cleanValue = value.replace(/_/g, "");
    const isBigInt = cleanValue.endsWith("n");
    const numStr = isBigInt ? cleanValue.slice(0, -1) : cleanValue;

    const isFloat =
      numStr.includes(".") || numStr.includes("e") || numStr.includes("E");

    if (isBigInt) {
      return BigInt(isFloat ? Number(numStr) : numStr);
    }

    return Number(numStr);
  }

  *evaluate() {
    return this.resolved;
  }
}

export { IntLiteral };
