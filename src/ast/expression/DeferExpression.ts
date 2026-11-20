import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { BaseError } from "../../errors/BaseError";
import { isDisposable, dispose } from "../../runtime/dispose";
import { isTypeArgs } from "../../../library/utils/utils";
import { type Gen } from "../../runtime/coroutine";

class DeferExpression extends StmtType {
  public readonly value: StmtType;
  public readonly position: Position;

  constructor(value: StmtType, position: Position) {
    super();

    this.value = value;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    const result = yield this.value.evaluate(score);

    if (!isDisposable(result)) {
      throw super.throwErrorFormatters(
        new BaseError(
          "A deferred expression must return a value with a 'symbol.dispose' member, " +
            `received ${isTypeArgs(result)}`,
          {
            files: score.get("import").paths,
          },
        ),
        score,
      );
    }

    score.deferenceCall.push([
      score,
      (environment: Environment) => dispose(result, environment),
    ]);

    return result;
  }
}

export { DeferExpression };
