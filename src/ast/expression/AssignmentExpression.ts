import { StmtType } from "../StmtType";
import { TokenType } from "../../lexer/token/TokenType";
import { type Position } from "../../lexer/token/Position";
import {
  AssignmentError,
  AssignmentCodeError,
} from "../../errors/runtime/AssignmentError";
import { IdentifierLiteral } from "../types/IdentifierLiteral";
import { MemberExpression } from "../expression/MemberExpression";
import { FunctionExpression } from "../expression/FunctionExpression";
import { StructExpression } from "../expression/StructExpression";
import { FunctionDeclaration } from "../declaration/FunctionDeclaration";
import { StructDeclaration } from "../declaration/StructDeclaration";
import { Environment } from "../../Environment";
import {
  assertWritableKey,
  lookupMember,
  setMember,
} from "../../runtime/members";
import {
  assertMemberAccess,
  hasStatic,
  staticsOf,
} from "../../runtime/structMembers";
import { type Gen } from "../../runtime/coroutine";

/**
 * The arithmetic / bitwise / logical part of a compound assignment, shared by the
 * identifier, member and static-member forms so the three can never drift apart.
 * `onUnknown` is called for an operator that is not an assignment operator.
 */
function applyAssignment(
  assignType: TokenType,
  current: any,
  right: any,
  onUnknown: () => never,
): any {
  switch (assignType) {
    case TokenType.OperatorAssign:
      return right;
    case TokenType.OperatorAssignPlus:
      return current + right;
    case TokenType.OperatorAssignMinus:
      return current - right;
    case TokenType.OperatorAssignMultiply:
      return current * right;
    case TokenType.OperatorAssignDivide:
      return current / right;
    case TokenType.OperatorAssignModule:
      return current % right;
    case TokenType.OperatorAssignPow:
      return current ** right;
    case TokenType.OperatorAndAssign:
      return current && right;
    case TokenType.OperatorOrAssign:
      return current || right;
    case TokenType.OperatorBitAndAssign:
      return current & right;
    case TokenType.OperatorBitOrAssign:
      return current | right;
    case TokenType.OperatorBitXorAssign:
      return current ^ right;
    case TokenType.OperatorShiftLeftAssign:
      return current << right;
    case TokenType.OperatorShiftRightAssign:
      return current >> right;
    case TokenType.OperatorShiftRightZeroFillAssign:
      return current >>> right;
    default:
      return onUnknown();
  }
}

class AssignmentExpression extends StmtType {
  public readonly left: StmtType;
  public readonly right: StmtType;
  public readonly assignType: TokenType;
  public readonly position: Position;

  constructor(
    left: StmtType,
    assignType: TokenType,
    right: StmtType,
    position: Position,
  ) {
    super();

    this.left = left;

    this.assignType = assignType;

    this.right = right;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      if (
        !(this.left instanceof IdentifierLiteral) &&
        !(this.left instanceof MemberExpression)
      ) {
        throw new AssignmentError(AssignmentCodeError.AssignmentInvalidType, {
          files: score.get("import").paths,
        });
      }

      if (this.left instanceof IdentifierLiteral) {
        const leftValue = yield this.left.evaluate(score);

        if (leftValue?.[Environment.SymbolEnum]) {
          throw new AssignmentError(AssignmentCodeError.AssignmentEnumConst, {
            name: this.left.value,
            files: score.get("import").paths,
          });
        } else if (leftValue instanceof StructDeclaration) {
          throw new AssignmentError(AssignmentCodeError.AssignmentStructData, {
            name: this.left.value,
            files: score.get("import").paths,
          });
        } else if (score.getOptions(this.left.value)?.constant) {
          throw new AssignmentError(AssignmentCodeError.AssignmentVarConst, {
            name: this.left.value,
            files: score.get("import").paths,
          });
        }

        // `a &&= b` / `a ||= b` short-circuit: when the left side already
        // decides the result, `b` is not evaluated and nothing is assigned.
        if (
          (this.assignType === TokenType.OperatorAndAssign && !leftValue) ||
          (this.assignType === TokenType.OperatorOrAssign && leftValue)
        ) {
          return leftValue;
        }

        const rightValue = yield this.right.evaluate(score);

        switch (this.assignType) {
          case TokenType.OperatorAssign:
            if (
              rightValue instanceof FunctionExpression ||
              rightValue instanceof StructExpression
            ) {
              rightValue.name = this.left.value;
            }

            if (this.right instanceof IdentifierLiteral) {
              return score.update(this.left.value, rightValue, {
                ...score.getOptions(this.right.value),
                constant: false,
              });
            }

            return score.update(this.left.value, rightValue, {
              constant: false,
              readonly: false,
            });

          case TokenType.OperatorAssignPlus:
            return score.update(this.left.value, leftValue + rightValue);
          case TokenType.OperatorAssignMinus:
            return score.update(this.left.value, leftValue - rightValue);
          case TokenType.OperatorAssignMultiply:
            return score.update(this.left.value, leftValue * rightValue);
          case TokenType.OperatorAssignDivide:
            return score.update(this.left.value, leftValue / rightValue);
          case TokenType.OperatorAssignModule:
            return score.update(this.left.value, leftValue % rightValue);
          case TokenType.OperatorAssignPow:
            return score.update(this.left.value, leftValue ** rightValue);
          case TokenType.OperatorAndAssign:
            return score.update(this.left.value, leftValue && rightValue);
          case TokenType.OperatorOrAssign:
            return score.update(this.left.value, leftValue || rightValue);
          case TokenType.OperatorBitAndAssign:
            return score.update(this.left.value, leftValue & rightValue);
          case TokenType.OperatorBitOrAssign:
            return score.update(this.left.value, leftValue | rightValue);
          case TokenType.OperatorBitXorAssign:
            return score.update(this.left.value, leftValue ^ rightValue);
          case TokenType.OperatorShiftLeftAssign:
            return score.update(this.left.value, leftValue << rightValue);
          case TokenType.OperatorShiftRightAssign:
            return score.update(this.left.value, leftValue >> rightValue);
          case TokenType.OperatorShiftRightZeroFillAssign:
            return score.update(this.left.value, leftValue >>> rightValue);

          default:
            throw new AssignmentError(
              AssignmentCodeError.AssignmentInvalidOperator,
              {
                assignType: this.assignType,
                files: score.get("import").paths,
              },
            );
        }
      } else if (this.left instanceof MemberExpression) {
        const value = yield this.left.obj.evaluate(score);

        if (
          value?.[Environment.SymbolEnum] ||
          score.getOptions(
            (this.left.obj as unknown as { value: string }).value,
          )?.readonly ||
          (value?.[Environment.SymbolStruct] &&
            value?.[Environment.SymbolStructData]?.[
              (this.left.property as unknown as { value: string }).value
            ]?.readonly)
        ) {
          const property =
            "value" in this.left.property
              ? (this.left.property as { value: string }).value
              : (
                  (<MemberExpression>this.left).obj as unknown as {
                    value: string;
                  }
                ).value;

          if (!Number.isNaN(Number(property))) {
            throw new AssignmentError(
              AssignmentCodeError.AssignmentIndexReadonly,
              {
                index: property,
                files: score.get("import").paths,
              },
            );
          } else {
            throw new AssignmentError(
              AssignmentCodeError.AssignmentPropertyReadonly,
              {
                property,
                files: score.get("import").paths,
              },
            );
          }
        }

        // `Counter.created = ...` / `Counter.created += 1`: a static member of the type.
        // Statics are ordinary mutable state, so every compound operator works on them.
        if (super.isStructData(value)) {
          const staticKey = yield this.left.property.evaluate(score);

          if (hasStatic(value, staticKey)) {
            const statics = staticsOf(value);
            const current = statics[staticKey as string];

            if (
              (this.assignType === TokenType.OperatorAndAssign && !current) ||
              (this.assignType === TokenType.OperatorOrAssign && current)
            ) {
              return current;
            }

            const next = applyAssignment(
              this.assignType,
              current,
              yield this.right.evaluate(score),
              () => {
                throw new AssignmentError(
                  AssignmentCodeError.AssignmentInvalidOperator,
                  {
                    assignType: this.assignType,
                    files: score.get("import").paths,
                  },
                );
              },
            );

            statics[staticKey as string] = next;

            return next;
          }
        }

        if (super.isStructData(value)) {
          if (this.assignType !== TokenType.OperatorAssign) {
            throw new AssignmentError(
              AssignmentCodeError.AssignmentStructDataOperatorInvalid,
              {
                name: value.name || "[anonymous struct]",
                files: score.get("import").paths,
              },
            );
          }

          const rightValue = yield this.right.evaluate(score);
          const leftValue = yield this.left.property.evaluate(score);

          if (this.isNodeFunction(rightValue)) {
            if (rightValue instanceof FunctionExpression) {
              if (!rightValue.name) {
                if (typeof leftValue !== "string") {
                  throw new AssignmentError(
                    AssignmentCodeError.AssignmentStructDataFunc,
                    {
                      name: value.name,
                      files: score.get("import").paths,
                    },
                  );
                }
                rightValue.name = leftValue;
              }
            }
            value.methods.push(rightValue as FunctionDeclaration);
          }

          // a struct *type* may gain new members, but never overwrite its own internals
          assertWritableKey(leftValue);

          if (
            typeof leftValue !== "string" ||
            (leftValue in value && leftValue !== "name")
          ) {
            throw new AssignmentError(AssignmentCodeError.AssignmentInvalid, {
              err: new Error(
                `Cannot redefine '${String(leftValue)}' on a struct type`,
              ),
              files: score.get("import").paths,
            });
          }

          // @ts-ignore
          value[leftValue] = rightValue;

          return;
        }

        try {
          const leftValue = yield this.left.property.evaluate(score);

          // a `private` member may only be written from inside its own struct
          assertMemberAccess(value, leftValue, "assign");

          const current = lookupMember(value, leftValue);

          // `o.a &&= b` / `o.a ||= b` short-circuit like their identifier forms
          if (
            (this.assignType === TokenType.OperatorAndAssign && !current) ||
            (this.assignType === TokenType.OperatorOrAssign && current)
          ) {
            return current;
          }

          const rightValue = yield this.right.evaluate(score);

          const next = applyAssignment(
            this.assignType,
            current,
            rightValue,
            () => {
              throw new AssignmentError(
                AssignmentCodeError.AssignmentInvalidOperator,
                {
                  assignType: this.assignType,
                  files: score.get("import").paths,
                },
              );
            },
          );

          // write back natively: only plain objects / arrays, never prototypes or host values
          setMember(value, leftValue, next);

          return next;
        } catch (err) {
          throw new AssignmentError(AssignmentCodeError.AssignmentInvalid, {
            err,
            files: score.get("import").paths,
          });
        }
      }
    } catch (err) {
      throw super.throwErrorFormatters(err, score);
    }
  }
}

export { AssignmentExpression };
