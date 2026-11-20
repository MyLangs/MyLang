import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { BlockStatement } from "./BlockStatement";
import { ObjectExpression } from "../expression/ObjectExpression";
import { MemberExpression } from "../expression/MemberExpression";
import { CallExpression } from "../expression/CallExpression";
import { isTypeArgs } from "../../../library/utils/utils";
import { runtime } from "../../runtime/Runtime";
import { deepEqual } from "../../utils/deepEqual";
import { type Gen } from "../../runtime/coroutine";

function isRootedAt(node: any, root: StmtType): boolean {
  let current = node;

  while (current) {
    if (current === root) return true;

    current =
      current instanceof MemberExpression
        ? current.obj
        : current instanceof CallExpression
          ? current.callee
          : null;
  }

  return false;
}

function enumThisMatches(test: any, expected: unknown): boolean {
  if (!test?.[Environment.SymbolEnumThis]) return false;

  return Object.values(test).some(
    (member) =>
      member !== null && member !== undefined && deepEqual(member, expected),
  );
}

class MatchStatement extends StmtType {
  public readonly test: StmtType;
  public readonly cases: { condition: StmtType; block: StmtType }[];
  public readonly defaultCase: StmtType | null;
  public readonly position: Position;

  constructor(
    test: StmtType,
    cases: { condition: StmtType; block: StmtType }[],
    defaultCase: StmtType | null,
    position: Position,
  ) {
    super();

    this.test = test;

    this.cases = cases;

    this.defaultCase = defaultCase;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      let isMatchTry = false;
      const test = yield this.test.evaluate(score);

      for (const { condition, block } of this.cases) {
        if (runtime.isReturn || runtime.isBreak) break;

        const conditionEvaluate = yield condition.evaluate(score);
        if (
          ((this.test instanceof ObjectExpression ||
            isTypeArgs(test) === "object") &&
            (condition instanceof MemberExpression ||
              condition instanceof CallExpression) &&
            isRootedAt(condition, this.test) &&
            conditionEvaluate) ||
          deepEqual(test, conditionEvaluate) ||
          enumThisMatches(test, conditionEvaluate)
        ) {
          isMatchTry = true;
          if (block instanceof BlockStatement) {
            const matchEnvironment = new Environment(score);
            yield block.evaluate(matchEnvironment);
            const result = runtime.getLastExecutionResult();
            runtime.resetLastExecutionResult();
            return result;
          } else {
            runtime.callStack.add(score, block);
            {
              const top = runtime.beginResume();
              if (!top) return null;
              const value = yield top.statement.evaluate(top.environment);
              runtime.endResume(top.statement, value);
              return value;
            }
          }
        }
      }

      if (this.defaultCase && !isMatchTry) {
        if (this.defaultCase instanceof BlockStatement) {
          const matchEnvironment = new Environment(score);
          yield this.defaultCase.evaluate(matchEnvironment);
          const result = runtime.getLastExecutionResult();
          runtime.resetLastExecutionResult();
          return result;
        } else {
          runtime.callStack.add(score, this.defaultCase);
          {
            const top = runtime.beginResume();
            if (!top) return null;
            const value = yield top.statement.evaluate(top.environment);
            runtime.endResume(top.statement, value);
            return value;
          }
        }
      }

      return null;
    } catch (err) {
      throw super.throwErrorFormatters(err, score);
    }
  }
}

export { MatchStatement };
