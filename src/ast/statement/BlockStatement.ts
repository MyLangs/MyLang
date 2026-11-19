import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { DeferDeclaration } from "../declaration/DeferDeclaration";
import { AssignmentExpression } from "../expression/AssignmentExpression";
import { UpdateExpression } from "../expression/UpdateExpression";
import { runtime } from "../../runtime/Runtime";
import { lift, TICK, type Gen } from "../../runtime/coroutine";

/** One registered `defer`: the scope it captured and the thing to run. */
type Deferred = [Environment, DeferDeclaration] | [Environment, Function];

/**
 * Record a failure that happened while the block was already unwinding, so it is not lost.
 * The first error still propagates; the later ones hang off it as `suppressed`.
 */
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
    /**
     * Registered `defer`s, created only if there are any.
     *
     * Most blocks defer nothing, and a block body runs once per loop iteration - so an
     * array allocated up front was a per-iteration allocation that existed to stay empty.
     * The same goes for the flag snapshot below: nothing can disturb those flags unless a
     * deferred call runs, so capturing and restoring them is only worth doing when one did.
     */
    let deferenceCall: Deferred[] | null = null;

    /** Set when the body failed; the error is re-thrown after every `defer` has run. */
    let bodyFailure: { error: any } | null = null;

    try {
      try {
        for (let i = 0; i < this.body.length; i++) {
          // `return`, `break` and `continue` all end the rest of this block;
          // the enclosing loop / function clears the flag afterwards
          if (runtime.isReturn || runtime.isBreak || runtime.isContinue) {
            break;
          }

          // time-slice preemption: let other spawned tasks run, then continue
          if (runtime.scheduler.shouldYield()) {
            yield TICK;
          }

          const blockStatement = this.body[i]!;

          if (blockStatement instanceof DeferDeclaration) {
            // blocks and assignments act on the live scope; calls keep a snapshot
            // so that their arguments are fixed at the moment of `defer`
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

            // `defer <expression>` registers its disposer on the scope; collect it here
            // so that it is ordered with the `defer` statements of this block
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
        // nothing was deferred, so nothing can have disturbed the flags
        if (bodyFailure) throw bodyFailure.error;

        return;
      }

      const _isBreak = runtime.isBreak;
      const _isReturn = runtime.isReturn;
      const _isContinue = runtime.isContinue;
      const result = runtime.getLastExecutionResult();

      /** The first failure raised by a deferred call, if any. */
      let deferFailure: { error: any } | null = null;

      // Deferred work runs in reverse registration order: a resource opened later is
      // released first, so a `defer` can always rely on what was set up before it.
      for (let i = deferenceCall.length - 1; i >= 0; i--) {
        const [deferScore, deferredCall] = deferenceCall[i]!;

        runtime.resetAll();

        // Every registered `defer` runs, even when an earlier one failed: a leaked
        // resource is worse than a lost error message, and the first error is kept.
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

      // The body's own failure wins; a failing `defer` only surfaces when the body
      // completed, which matches what `try/finally` does in the rest of the language.
      if (bodyFailure) throw bodyFailure.error;
      if (deferFailure) throw deferFailure.error;
    }
  }
}

export { BlockStatement };
