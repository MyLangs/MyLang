import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { IdentifierLiteral } from "../types/IdentifierLiteral";
import { lift, type Gen } from "../../runtime/coroutine";

class ExportsDeclaration extends StmtType {
  public readonly position: Position;
  public readonly value: string | Record<string, StmtType>;

  constructor(value: string | Record<string, StmtType>, position: Position) {
    super();

    this.value = value;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    for (const key of <string[]>Object.keys(this.value)) {
      // @ts-ignore
      const expValue = this.value[key];

      score.update("#exports", {
        ...score.get("#exports"),
        [key]: {
          value: yield lift(expValue.evaluate(score)),
          ...(expValue instanceof IdentifierLiteral &&
            score.getOptions(expValue.value) && {
              optionsVar: score.getOptions(expValue.value),
            }),
          [Environment.SymbolExports]: true,
        },
      });
    }

    return null;
  }
}

export { ExportsDeclaration };
