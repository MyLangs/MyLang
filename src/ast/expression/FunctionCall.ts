import { StmtType, type ITextOptions } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { IdentifierLiteral } from "../types/IdentifierLiteral";
import { Environment } from "../../Environment";
import {
  FunctionCallError,
  FunctionCallCodeError,
} from "../../errors/runtime/FunctionCallError";
import { lift, type Gen } from "../../runtime/coroutine";

class FunctionCall extends StmtType {
  public readonly name: string;
  public readonly argument: StmtType[];
  public readonly position: Position;

  constructor(name: string, argument: StmtType[], position: Position) {
    super();

    this.name = name;

    this.argument = argument;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      const func = score.get(this.name);

      if (super.isNodeFunction(func)) {
        const argument = [];
        for (const arg of this.argument) {
          const result = yield arg.evaluate(score);

          if (arg instanceof IdentifierLiteral) {
            const variableOpts = score.getArgumentOptions(arg.value);

            argument.push({
              ...(variableOpts && { options: variableOpts }),
              value: result,
            });
          } else {
            argument.push({ value: result });
          }
        }

        return yield func.call(argument);
      }

      if (super.isBuildModuleFunction(func)) {
        const argument = [];
        for (const arg of this.argument) {
          argument.push(yield arg.evaluate(score));
        }

        return yield lift(new func(argument, this.argument, score).call());
      }

      if (super.isStructData(func)) {
        const argument = [];
        for (const arg of this.argument) {
          argument.push(yield arg.evaluate(score));
        }

        return yield func.call(argument);
      }

      throw new FunctionCallError(FunctionCallCodeError.FunctionCallUnknown, {
        name: this.name,
        files: score.get("import").paths,
      });
    } catch (err) {
      throw super.throwErrorFormatters(
        err,
        score,
        ({ file, position }: ITextOptions) => {
          return `${this.name} (${file}:${position.line}:${position.column})`;
        },
      );
    }
  }
}

export { FunctionCall };
