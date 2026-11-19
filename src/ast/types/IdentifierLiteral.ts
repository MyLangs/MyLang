import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { lift, type Gen } from "../../runtime/coroutine";

class IdentifierLiteral extends StmtType {
  public readonly value: string;
  public readonly position: Position;

  constructor(value: string, position: Position) {
    super();

    this.value = value;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      if (score.getOptions(this.value)?.lazy) {
        // evaluate in the scope that declared the lazy variable
        const owner = score.getEnvironmentWithKey(this.value) ?? score;
        return yield lift(score.get(this.value)?.evaluate(owner));
      }
      return score.get(this.value);
    } catch (err) {
      throw this.throwErrorFormatters(err, score);
    }
  }
}

export { IdentifierLiteral };
