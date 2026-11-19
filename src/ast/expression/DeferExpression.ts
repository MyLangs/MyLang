import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { BaseError } from "../../errors/BaseError";
import { isDisposable, dispose } from "../../runtime/dispose";
import { isTypeArgs } from "../../../library/utils/utils";
import { type Gen } from "../../runtime/coroutine";

/**
 * `var file = defer fs.open(path, "r");`
 *
 * Evaluates the expression, checks that the result owns a releasable resource (it carries
 * `symbol.dispose`), and schedules that disposer to run when the enclosing block ends -
 * normally, through `return` / `break` / `continue`, through a thrown error, or because
 * the task was cancelled.
 *
 * The value itself is returned, so the resource can be used straight away.
 */
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

    // the environment is captured so the disposer still sees the scope it was created in
    score.deferenceCall.push([
      score,
      (environment: Environment) => dispose(result, environment),
    ]);

    return result;
  }
}

export { DeferExpression };
