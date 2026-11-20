import { StmtType } from "../StmtType";
import { type BlockStatement } from "./BlockStatement";
import { Environment } from "../../Environment";
import { type Position } from "../../lexer/token/Position";
import { type Gen } from "../../runtime/coroutine";
import { runtime } from "../../runtime/Runtime";

class TryCatchStatement extends StmtType {
  public readonly tryBlock: BlockStatement;
  public readonly catchBlock: [string | null, BlockStatement] | null;
  public readonly finallyBlock: BlockStatement | null;
  public readonly position: Position;

  constructor(
    tryBlock: BlockStatement,
    catchBlock: [string | null, BlockStatement] | null,
    finallyBlock: BlockStatement | null,
    position: Position,
  ) {
    super();

    this.tryBlock = tryBlock;

    this.catchBlock = catchBlock;

    this.finallyBlock = finallyBlock;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      const callEnvironment = new Environment(score);
      return yield this.tryBlock.evaluate(callEnvironment);
    } catch (err) {
      if (!this.catchBlock) {
        throw err;
      }

      const callEnvironment = new Environment(score);

      if (this.catchBlock[0]) {
        callEnvironment.create(this.catchBlock[0], err);
      }

      return yield this.catchBlock[1].evaluate(callEnvironment);
    } finally {
      if (this.finallyBlock) {
        const flags = {
          isBreak: runtime.isBreak,
          isReturn: runtime.isReturn,
          isContinue: runtime.isContinue,
          result: runtime.getLastExecutionResult(),
        };

        runtime.resetAll();

        yield this.finallyBlock.evaluate(new Environment(score));

        if (!(runtime.isBreak || runtime.isReturn || runtime.isContinue)) {
          runtime.restoreFlags(flags);
        }
      }
    }
  }
}

export { TryCatchStatement };
