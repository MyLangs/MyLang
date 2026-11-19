import { StmtType } from "../StmtType";
import { Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { FunctionCall } from "./FunctionCall";
import { CallExpression } from "./CallExpression";
import { FunctionExpression } from "./FunctionExpression";
import { BlockStatement } from "../statement/BlockStatement";
import {
  SpawnQueueError,
  SpawnQueueCodeError,
} from "../../errors/runtime/SpawnQueueError";
import { runtime } from "../../runtime/Runtime";
import { convertSpawnState } from "../../runtime/SpawnState";
import { type Gen } from "../../runtime/coroutine";

class SpawnExpression extends StmtType {
  public readonly expression: StmtType;
  public readonly isWait: boolean;
  public readonly position: Position;

  constructor(expression: StmtType, isWait: boolean, position: Position) {
    super();
    this.expression = expression;

    this.isWait = isWait;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    if (!(
      this.expression instanceof FunctionCall ||
      this.expression instanceof CallExpression ||
      this.expression instanceof BlockStatement ||
      super.isNodeFunction(this.expression) ||
      super.isBuildModuleFunction(this.expression)
    )) {
      throw new SpawnQueueError(SpawnQueueCodeError.NotCalledSpawn, {
        files: score.get("import").paths,
      });
    }

    const expression = this.expression;

    // The body of the new green thread. It runs on its own execution context, so its
    // return/break/continue flags can never leak into the task that spawned it.
    const body = (): Gen<any> => {
      const run = function* (self: SpawnExpression): Gen<any> {
        try {
          if (self.isNodeFunction(expression)) {
            const callEnvironment = new Environment(score);
            expression.parentEnv = callEnvironment;

            if (expression instanceof FunctionExpression) {
              if (expression.name) {
                score.create(expression.name, expression);
              }
            }

            return yield expression.call([]);
          }

          if (expression instanceof BlockStatement) {
            runtime.markFunctionCallPosition();

            // the block has its own scope: its `var`s must not leak into the spawner
            yield expression.evaluate(new Environment(score));

            const result = runtime.getLastExecutionResult();
            runtime.resetLastExecutionResult();
            runtime.finishFunction();

            return result;
          }

          return yield expression.evaluate(score);
        } catch (err) {
          throw self.throwErrorFormatters(err, score);
        }
      };

      return run(this);
    };

    const handler = runtime.scheduler.spawn(body, { name: "spawn" });

    if (this.isWait) {
      yield handler.join();
    }

    return convertSpawnState(handler, score);
  }
}

export { SpawnExpression };
