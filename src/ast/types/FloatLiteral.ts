import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";

class FloatLiteral extends StmtType {
  public readonly value: string;
  public readonly position: Position;

  /**
   * The number this literal means, worked out once.
   *
   * As with `IntLiteral`: the text is fixed at parse time, so stripping its underscores
   * and converting it on every evaluation repeats work that can only ever give the same
   * answer. A literal in a loop paid for that on every iteration.
   */
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
