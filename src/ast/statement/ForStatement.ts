import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { type BlockStatement } from "./BlockStatement";
import { runtime } from "../../runtime/Runtime";
import { TICK, type Gen } from "../../runtime/coroutine";

class ForStatement extends StmtType {
  public readonly init: StmtType | null;
  public readonly test: StmtType | null;
  public readonly update: StmtType | null;
  public readonly body: BlockStatement;
  public readonly position: Position;

  constructor(
    init: StmtType | null,
    test: StmtType | null,
    update: StmtType | null,
    body: BlockStatement,
    position: Position,
  ) {
    super();

    this.init = init;

    this.test = test;

    this.update = update;

    this.body = body;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      const bridgeEnvironment = new Environment(score);

      runtime.markIterationCallPosition();

      if (this.init) yield this.init.evaluate(bridgeEnvironment);

      if (this.test) {
        while (
          !runtime.isBreak &&
          !runtime.isReturn &&
          (yield this.test.evaluate(bridgeEnvironment))
        ) {
          const executionEnvironment = new Environment(bridgeEnvironment);
          if (runtime.scheduler.shouldYield()) yield TICK;
          yield this.body.evaluate(executionEnvironment);
          runtime.resetContinue();
          if (this.update) yield this.update.evaluate(executionEnvironment);
        }
      } else {
        while (!runtime.isBreak && !runtime.isReturn) {
          const executionEnvironment = new Environment(bridgeEnvironment);
          if (runtime.scheduler.shouldYield()) yield TICK;
          yield this.body.evaluate(executionEnvironment);
          runtime.resetContinue();
          if (this.update) yield this.update.evaluate(executionEnvironment);
        }
      }

      runtime.resetBreak();
      runtime.finishIteration();
    } catch (err) {
      throw super.throwErrorFormatters(err, score);
    }
  }
}

export { ForStatement };
