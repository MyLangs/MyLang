import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { BlockStatement } from "./BlockStatement";
import { runtime } from "../../runtime/Runtime";
import { type Gen } from "../../runtime/coroutine";

class IfStatement extends StmtType {
  public readonly test: StmtType;
  public readonly consequent: StmtType;
  public readonly alternate: StmtType | null;
  public readonly position: Position;

  constructor(
    test: StmtType,
    consequent: StmtType,
    alternate: StmtType | null,
    position: Position,
  ) {
    super();

    this.test = test;

    this.consequent = consequent;

    this.alternate = alternate;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      if (yield this.test.evaluate(score)) {
        if (this.consequent instanceof BlockStatement) {
          const executionEnvironment = new Environment(score);
          return yield this.consequent.evaluate(executionEnvironment);
        } else {
          runtime.callStack.add(score, this.consequent);
          {
            const top = runtime.beginResume();
            if (!top) return null;
            const value = yield top.statement.evaluate(top.environment);
            runtime.endResume(top.statement, value);
            return value;
          }
        }
      } else if (this.alternate) {
        if (this.alternate instanceof BlockStatement) {
          const executionEnvironment = new Environment(score);
          return yield this.alternate.evaluate(executionEnvironment);
        } else {
          runtime.callStack.add(score, this.alternate);
          {
            const top = runtime.beginResume();
            if (!top) return null;
            const value = yield top.statement.evaluate(top.environment);
            runtime.endResume(top.statement, value);
            return value;
          }
        }
      }
    } catch (err) {
      throw super.throwErrorFormatters(err, score);
    }
  }
}

export { IfStatement };
