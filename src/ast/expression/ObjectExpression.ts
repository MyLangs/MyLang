import { StmtType } from "../StmtType";
import { IdentifierLiteral } from "../types/IdentifierLiteral";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { defineMember } from "../../runtime/members";
import { StringLiteral } from "../types/StringLiteral";
import { FunctionExpression } from "../expression/FunctionExpression";
import { StructExpression } from "../expression/StructExpression";
import { type Gen } from "../../runtime/coroutine";

class ObjectExpression extends StmtType {
  public readonly position: Position;
  public readonly properties: {
    key: StmtType | string;
    value: StmtType | null;
    computed?: true;
  }[];

  constructor(
    properties: {
      key: StmtType | string;
      value: StmtType | null;
      computed?: true;
    }[],
    position: Position,
  ) {
    super();

    this.properties = properties;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      const result: Record<string, any> = {};

      for (const property of this.properties) {
        const { key, value, computed } = property;

        if (key instanceof IdentifierLiteral && !computed && value) {
          if (
            value instanceof FunctionExpression ||
            value instanceof StructExpression
          ) {
            value.name = key.value;
          }
          defineMember(result, key.value, yield value.evaluate(score));
          continue;
        }

        if (key instanceof IdentifierLiteral && computed && value) {
          const evaluatedKey = yield key.evaluate(score);
          defineMember(
            result,
            String(evaluatedKey),
            yield value.evaluate(score),
          );
          continue;
        }

        if (typeof key === "string" && value) {
          if (
            value instanceof FunctionExpression ||
            value instanceof StructExpression
          ) {
            value.name = key;
          }
          defineMember(result, key, yield value.evaluate(score));
          continue;
        }

        if (
          key instanceof StringLiteral &&
          (value instanceof FunctionExpression ||
            value instanceof StructExpression)
        ) {
          value.name = key.value;
        }

        const evaluatedKey = yield (key as StmtType).evaluate(score);

        if (
          [Environment.SymbolIterator, Environment.SymbolDeferred].includes(
            evaluatedKey,
          )
        ) {
          Object.defineProperty(result, evaluatedKey, {
            value: yield value!.evaluate(score),
            enumerable: true,
            configurable: true,
            writable: false,
          });
        } else {
          defineMember(
            result,
            String(evaluatedKey),
            yield value!.evaluate(score),
          );
        }
      }

      return result;
    } catch (err) {
      throw super.throwErrorFormatters(err, score);
    }
  }
}

export { ObjectExpression };
