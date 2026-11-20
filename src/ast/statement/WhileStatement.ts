import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { type BlockStatement } from "./BlockStatement";
import { runtime } from "../../runtime/Runtime";
import { TICK, type Gen } from "../../runtime/coroutine";

class WhileStatement extends StmtType {
  public readonly test: StmtType;
  public readonly body: BlockStatement;
  public readonly position: Position;

  constructor(test: StmtType, body: BlockStatement, position: Position) {
    super();

    this.test = test;

    this.body = body;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      const bridgeEnvironment = new Environment(score);

      runtime.markIterationCallPosition();

      while (
        !runtime.isReturn &&
        !runtime.isBreak &&
        (yield this.test.evaluate(bridgeEnvironment))
      ) {
        if (runtime.scheduler.shouldYield()) yield TICK;

        const executionEnvironment = new Environment(bridgeEnvironment);
        yield this.body.evaluate(executionEnvironment);
        runtime.resetContinue();
      }

      runtime.resetBreak();
      runtime.finishIteration();
    } catch (err) {
      throw super.throwErrorFormatters(err, score);
    }
  }
}

export { WhileStatement };
