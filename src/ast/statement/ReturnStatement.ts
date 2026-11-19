import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { type Gen } from "../../runtime/coroutine";

class ReturnStatement extends StmtType {
  public readonly body: StmtType | StmtType[];
  public readonly position: Position;

  constructor(body: StmtType | StmtType[], position: Position) {
    super();

    this.body = body;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    if (Array.isArray(this.body)) {
      const values: any[] = [];

      for (const value of this.body) {
        values.push(yield value.evaluate(score));
      }

      return values;
    }
    return yield this.body.evaluate(score);
  }
}

export { ReturnStatement };
