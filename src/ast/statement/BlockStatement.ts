import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { DeferDeclaration } from "../declaration/DeferDeclaration";
import { AssignmentExpression } from "../expression/AssignmentExpression";
import { UpdateExpression } from "../expression/UpdateExpression";
import { runtime } from "../../runtime/Runtime";
import { lift, TICK, type Gen } from "../../runtime/coroutine";

type Deferred = [Environment, DeferDeclaration] | [Environment, Function];

function suppress(primary: any, secondary: any): void {
  if (primary === null || typeof primary !== "object") return;

  const existing = (primary as any).suppressed;

  if (Array.isArray(existing)) {
    existing.push(secondary);
    return;
  }

  Object.defineProperty(primary, "suppressed", {
    value: [secondary],
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

class BlockStatement extends StmtType {
  public readonly body: StmtType[];
  public readonly position: Position;

  constructor(body: StmtType[], position: Position) {
    super();

    this.body = body;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    let deferenceCall: Deferred[] | null = null;
    let bodyFailure: { error: any } | null = null;

    try {
      try {
        for (let i = 0; i < this.body.length; i++) {
          if (runtime.isReturn || runtime.isBreak || runtime.isContinue) {
            break;
          }

          if (runtime.scheduler.shouldYield()) {
            yield TICK;
          }

          const blockStatement = this.body[i]!;

          if (blockStatement instanceof DeferDeclaration) {
            if (
              blockStatement.value instanceof BlockStatement ||
              blockStatement.value instanceof AssignmentExpression ||
              blockStatement.value instanceof UpdateExpression
            ) {
              (deferenceCall ??= []).push([score, blockStatement]);
              continue;
            }

            (deferenceCall ??= []).push([score.clone(), blockStatement]);
          } else {
            runtime.callStack.add(score, blockStatement);

            const top = runtime.beginResume();
            if (top) {
              runtime.endResume(
                top.statement,
                yield top.statement.evaluate(top.environment),
              );
            }

            if (score.deferenceCall.length) {
              const into = (deferenceCall ??= []);

              for (const entry of score.deferenceCall) {
                into.push(entry);
              }

              score.deferenceCall.length = 0;
            }
          }
        }
      } catch (error) {
        bodyFailure = { error };
      }
    } finally {
      if (deferenceCall === null) {
        if (bodyFailure) throw bodyFailure.error;
        return;
      }

      const _isBreak = runtime.isBreak;
      const _isReturn = runtime.isReturn;
      const _isContinue = runtime.isContinue;
      const result = runtime.getLastExecutionResult();

      let deferFailure: { error: any } | null = null;

      for (let i = deferenceCall.length - 1; i >= 0; i--) {
        const [deferScore, deferredCall] = deferenceCall[i]!;

        runtime.resetAll();

        try {
          if (deferredCall instanceof DeferDeclaration) {
            yield deferredCall.evaluate(deferScore);
          } else {
            yield lift(deferredCall(deferScore));
          }
        } catch (error) {
          if (bodyFailure) {
            suppress(bodyFailure.error, error);
          } else if (deferFailure) {
            suppress(deferFailure.error, error);
          } else {
            deferFailure = { error };
          }
        }
      }

      runtime.restoreFlags({
        isBreak: _isBreak,
        isReturn: _isReturn,
        isContinue: _isContinue,
        result,
      });

      if (bodyFailure) throw bodyFailure.error;
      if (deferFailure) throw deferFailure.error;
    }
  }
}

export { BlockStatement };
