import { StmtType } from "../StmtType";
import { OperatorType, TokenType } from "../../lexer/token/TokenType";
import { type Position } from "../../lexer/token/Position";
import { type Environment } from "../../Environment";
import { IdentifierLiteral } from "../types/IdentifierLiteral";
import { MemberExpression } from "./MemberExpression";
import { AssignmentExpression } from "./AssignmentExpression";
import {
  OperatorError,
  OperatorCodeError,
} from "../../errors/runtime/OperatorError";
import { isTypeArgs } from "../../../library/utils/utils";
import { type Gen } from "../../runtime/coroutine";

class EvaluatedOnce extends StmtType {
  private done = false;
  private result: any;

  constructor(private readonly inner: StmtType) {
    super();
  }

  get value(): any {
    return (this.inner as any).value;
  }

  get position(): Position {
    return (this.inner as any).position;
  }

  *evaluate(score: Environment): Gen<any> {
    if (!this.done) {
      this.result = yield this.inner.evaluate(score);
      this.done = true;
    }

    return this.result;
  }
}
class KnownValue extends StmtType {
  constructor(
    private readonly known: any,
    public readonly position: Position,
  ) {
    super();
  }

  *evaluate(): Gen<any> {
    return this.known;
  }
}
class UpdateExpression extends StmtType {
  public readonly operator: OperatorType;
  public readonly argument: StmtType;
  public readonly position: Position;

  constructor(argument: StmtType, operator: OperatorType, position: Position) {
    super();

    this.argument = argument;

    this.operator = operator;

    this.position = position;
  }

  private step(currentValue: any, score: Environment): number {
    if (typeof currentValue !== "number") {
      throw new OperatorError(OperatorCodeError.UpdateOnlyNumber, {
        type: isTypeArgs(currentValue),
        files: score.get("import").paths,
      });
    }

    switch (this.operator) {
      case OperatorType.PlusPlus:
        return currentValue + 1;
      case OperatorType.MinusMinus:
        return currentValue - 1;
      default:
        throw new OperatorError(OperatorCodeError.UnknownUpdateOperator, {
          operatorType: this.operator,
          files: score.get("import").paths,
        });
    }
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      if (this.argument instanceof MemberExpression) {
        const target = new MemberExpression(
          new EvaluatedOnce(this.argument.obj),
          this.argument.computed
            ? new EvaluatedOnce(this.argument.property)
            : this.argument.property,
          this.argument.computed,
          false,
          this.argument.position,
        );

        const currentValue = yield target.evaluate(score);
        const nextValue = this.step(currentValue, score);

        yield new AssignmentExpression(
          target,
          TokenType.OperatorAssign,
          new KnownValue(nextValue, this.position),
          this.position,
        ).evaluate(score);

        return currentValue;
      }

      if (!(this.argument instanceof IdentifierLiteral)) {
        throw new OperatorError(OperatorCodeError.UpdateOnlyNumber, {
          type: "expression",
          files: score.get("import").paths,
        });
      }

      let currentValue;

      try {
        currentValue = yield this.argument.evaluate(score);
      } catch (err) {
        throw String(err);
      }

      const nextValue = this.step(currentValue, score);

      score.update(this.argument.value, nextValue);

      return currentValue;
    } catch (err) {
      throw super.throwErrorFormatters(err, score);
    }
  }
}

export { UpdateExpression };
