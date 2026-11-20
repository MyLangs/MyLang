import { StmtType } from "../StmtType";
import { type Environment } from "../../Environment";
import { type Position } from "../../lexer/token/Position";
import { BaseError } from "../../errors/BaseError";
import { needsExplicitText } from "../../utils/needsExplicitText";

class InterpolatedString extends StmtType {
  public readonly value: string;
  public readonly interpolatedList: any[];
  public readonly position: Position;

  constructor(value: string, interpolatedList: any[], position: Position) {
    super();

    this.value = value;

    this.interpolatedList = interpolatedList;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    if (this.interpolatedList.length === 0) {
      return this.value;
    }

    try {
      const evaluatedValues: any[] = [];

      for (const tokens of this.interpolatedList) {
        if (tokens.errors.length > 0) {
          const errors = tokens.errors[0]!;
          throw super.throwErrorFormatters(
            new BaseError(errors.message),
            score,
          );
        }

        const parseValue = new Parser(tokens.tokens).parse();

        if (parseValue[0]) {
          const value = yield parseValue[0].evaluate(score);

          if (needsExplicitText(value)) {
            throw super.throwErrorFormatters(
              new BaseError(
                "Cannot interpolate this value: it does not turn into text on its " +
                  "own, so call .toString() on it first",
              ),
              score,
            );
          }

          evaluatedValues.push(value);
        }
      }

      return this.value.replace(
        /\{(\d+)\}/g,
        (_, index) => evaluatedValues[parseInt(index, 10)],
      );
    } catch (err) {
      throw super.throwErrorFormatters(err, score);
    }
  }
}

export { InterpolatedString };

import { Parser } from "../Parser";
import { type Gen } from "../../runtime/coroutine";
