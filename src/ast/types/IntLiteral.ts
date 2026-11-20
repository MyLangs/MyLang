import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";

class IntLiteral extends StmtType {
  public readonly value: string;
  public readonly position: Position;
  private readonly resolved: number | bigint;

  constructor(value: string, position: Position) {
    super();

    this.value = value;

    this.position = position;

    this.resolved = IntLiteral.parse(value);
  }

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
