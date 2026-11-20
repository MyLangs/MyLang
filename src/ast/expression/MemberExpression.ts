import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { StringLiteral } from "../types/StringLiteral";
import { IdentifierLiteral } from "../types/IdentifierLiteral";
import { IntLiteral } from "../types/IntLiteral";
import { BaseError } from "../../errors/BaseError";
import { isTypeArgs } from "../../../library/utils/utils";
import { getMember } from "../../runtime/members";
import { assertMemberAccess, hasStatic } from "../../runtime/structMembers";
import { type Gen } from "../../runtime/coroutine";

class MemberExpression extends StmtType {
  public readonly obj: StmtType;
  public readonly property: StmtType;
  public readonly position: Position;
  public readonly computed: boolean;
  public readonly optional?: boolean;

  constructor(
    obj: StmtType,
    property: StmtType,
    computed: boolean = false,
    optional: boolean = false,
    position: Position,
  ) {
    super();

    this.obj = obj;

    this.property = property;

    this.position = position;

    this.computed = computed;

    this.optional = optional;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      const objectValue = yield this.obj.evaluate(score);

      if (
        this.optional &&
        (objectValue === null || objectValue === undefined)
      ) {
        return null;
      }

      if (objectValue === null || objectValue === undefined) {
        throw new BaseError(`Cannot read property of nil`);
      }

      let propertyKey: string | number | symbol;

      if (this.computed) {
        const key = yield this.property.evaluate(score);

        if (
          isTypeArgs(key) === "string" ||
          isTypeArgs(key) === "int" ||
          typeof key === "symbol"
        ) {
          propertyKey = key;
        } else {
          propertyKey = String(key);
        }
      } else {
        if (this.property instanceof StringLiteral) {
          propertyKey = this.property.value;
        } else if (this.property instanceof IntLiteral) {
          const evaluateValue = yield this.property.evaluate();
          if (typeof evaluateValue === "bigint") {
            throw new BaseError(
              "Invalid property access in non-computed member expression",
            );
          }
          propertyKey = evaluateValue;
        } else if (this.property instanceof IdentifierLiteral) {
          const evaluateValue = yield this.property.evaluate(score);
          if (
            isTypeArgs(evaluateValue) !== "int" &&
            isTypeArgs(evaluateValue) !== "string"
          ) {
            throw new BaseError(
              "Invalid property access in non-computed member expression",
            );
          }
          propertyKey = evaluateValue;
        } else {
          throw new BaseError(
            "Invalid property access in non-computed member expression",
          );
        }
      }

      if (
        typeof propertyKey === "string" &&
        propertyKey !== "name" &&
        super.isStructData(objectValue) &&
        !hasStatic(objectValue, propertyKey)
      ) {
        throw new BaseError(
          `Access to property '${String(propertyKey)}' is not allowed`,
        );
      }

      assertMemberAccess(objectValue, propertyKey, "read");

      const value = getMember(objectValue, propertyKey);

      if (!this.optional && value === undefined) {
        throw new BaseError(
          `Property '${String(propertyKey)}' does not exist on object`,
        );
      }

      return value === undefined ? null : value;
    } catch (err) {
      if (err instanceof BaseError) {
        err.files = Array.from(
          new Set([score.get("import").main, ...err.files]),
        ).map((file) => {
          if (file === score.get("import").main) {
            return `${file}:${this.position.line}:${this.position.column}`;
          }
          return file;
        });
      }
      throw err;
    }
  }
}

export { MemberExpression };
