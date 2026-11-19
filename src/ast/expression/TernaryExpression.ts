import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { type Gen } from "../../runtime/coroutine";

class TernaryExpression extends StmtType {
  public readonly condition: StmtType;
  public readonly expressionIfTrue: StmtType;
  public readonly expressionIfFalse: StmtType;
  public readonly position: Position;

  constructor(
    condition: StmtType,
    expressionIfTrue: StmtType,
    expressionIfFalse: StmtType,
    position: Position,
  ) {
    super();

    this.condition = condition;

    this.expressionIfTrue = expressionIfTrue;

    this.expressionIfFalse = expressionIfFalse;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      let condition: any = yield this.condition.evaluate(score);

      if (Array.isArray(condition)) {
        condition = condition.length;
      } else if (condition && typeof condition === "object") {
        condition = Object.keys(condition).length;
      }

      if (condition) {
        return yield this.expressionIfTrue.evaluate(score);
      }
      return yield this.expressionIfFalse.evaluate(score);
    } catch (err) {
      throw super.throwErrorFormatters(err, score);
    }
  }
}

export { TernaryExpression };
