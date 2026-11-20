import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { OperatorType } from "../../lexer/token/TokenType";
import { Environment } from "../../Environment";
import {
  OperatorError,
  OperatorCodeError,
} from "../../errors/runtime/OperatorError";
import { type Gen } from "../../runtime/coroutine";
import { deepEqual } from "../../utils/deepEqual";
import { needsExplicitText } from "../../utils/needsExplicitText";

class BinaryExpression extends StmtType {
  public readonly operator: OperatorType;
  public readonly position: Position;
  public readonly left: StmtType;
  public readonly right: StmtType;

  constructor(
    operator: OperatorType,
    left: StmtType,
    right: StmtType,
    position: Position,
  ) {
    super();

    this.operator = operator;

    this.left = left;

    this.right = right;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      const left = (yield this.left.evaluate(score)) as any;

      // `&&` and `||` short-circuit: the right operand is evaluated only when
      // it can influence the result.
      if (this.operator === OperatorType.And) {
        return left ? yield this.right.evaluate(score) : left;
      }

      if (this.operator === OperatorType.Or) {
        return left ? left : yield this.right.evaluate(score);
      }

      const right = yield this.right.evaluate(score);

      // Every operator but `==` and `!=` (which compare structurally) asks the host to
      // turn both operands into primitives. A value that only yields its text through an
      // explicit `.toString()` call cannot answer that, and the host's own complaint
      // names nothing in the program - so it is refused here instead.
      if (
        this.operator !== OperatorType.Equal &&
        this.operator !== OperatorType.NotEqual
      ) {
        for (const [side, operand] of [
          ["left", left],
          ["right", right],
        ] as const) {
          if (!needsExplicitText(operand)) continue;

          throw new OperatorError(OperatorCodeError.NeedsExplicitText, {
            operatorType: this.operator,
            side,
            files: score.get("import").paths,
          });
        }
      }

      switch (this.operator) {
        case OperatorType.Add: {
          return left + right;
        }
        case OperatorType.Subtract: {
          return left - right;
        }
        case OperatorType.Multiply: {
          return left * right;
        }
        case OperatorType.Exponentiation: {
          return left ** right;
        }
        case OperatorType.Modulo: {
          return left % right;
        }
        case OperatorType.Divide: {
          return left / right;
        }
        case OperatorType.Equal: {
          return deepEqual(left, right);
        }
        case OperatorType.NotEqual: {
          return !deepEqual(left, right);
        }
        case OperatorType.GreaterThan: {
          return left > right;
        }
        case OperatorType.LessThan: {
          return left < right;
        }
        case OperatorType.GreaterThanOrEqual: {
          return left >= right;
        }
        case OperatorType.LessThanOrEqual: {
          return left <= right;
        }
        case OperatorType.LogicalAnd: {
          return left & right;
        }
        case OperatorType.LogicalOr: {
          return left | right;
        }
        case OperatorType.BitXor: {
          return left ^ right;
        }
        case OperatorType.ShiftLeft: {
          return left << right;
        }
        case OperatorType.ShiftRight: {
          return left >> right;
        }
        case OperatorType.ShiftRightZeroFill: {
          return left >>> right;
        }
        default: {
          throw new OperatorError(OperatorCodeError.UnknownBinaryOperator, {
            operatorType: this.operator,
            files: score.get("import").paths,
          });
        }
      }
    } catch (err) {
      throw super.throwErrorFormatters(err, score);
    }
  }
}

export { BinaryExpression };
