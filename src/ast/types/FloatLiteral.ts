import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";

class FloatLiteral extends StmtType {
  public readonly value: string;
  public readonly position: Position;
  private readonly resolved: number;

  constructor(value: string, position: Position) {
    super();

    this.value = value;

    this.position = position;

    this.resolved = parseFloat(value.replace(/_/g, ""));
  }

  *evaluate() {
    return this.resolved;
  }
}

export { FloatLiteral };
