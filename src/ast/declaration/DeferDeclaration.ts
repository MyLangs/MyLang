import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { type Gen } from "../../runtime/coroutine";

class DeferDeclaration extends StmtType {
  public readonly value: StmtType;
  public readonly position: Position;

  constructor(value: StmtType, position: Position) {
    super();

    this.value = value;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      return yield this.value.evaluate(score);
    } catch (err) {
      throw super.throwErrorFormatters(err, score);
    }
  }
}

export { DeferDeclaration };
