import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { Spawn } from "../../runtime/Spawn";
import {
  SpawnQueueError,
  SpawnQueueCodeError,
} from "../../errors/runtime/SpawnQueueError";
import { type Gen } from "../../runtime/coroutine";

class WaitExpression extends StmtType {
  public readonly expression: StmtType;
  public readonly position: Position;

  constructor(expression: StmtType, position: Position) {
    super();
    this.expression = expression;
    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    const spawn = yield this.expression.evaluate(score);

    const spawnHandler = spawn?.[Environment.SpawnQueueSymbol];

    if (!(spawnHandler instanceof Spawn)) {
      throw new SpawnQueueError(SpawnQueueCodeError.ValueIsNotSpawn);
    }

    // suspend only this task until the awaited task settles; other tasks keep running
    yield spawnHandler.join();

    return {
      done: spawnHandler.done,
      result: spawnHandler.result,
      error: spawnHandler.error,
      status: spawnHandler.status,
      elapsed: spawnHandler.elapsed,
    };
  }
}

export { WaitExpression };
