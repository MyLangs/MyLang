import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Environment } from "../../Environment";
import { type BlockStatement } from "./BlockStatement";
import { VariableDeclaration } from "../declaration/VariableDeclaration";
import { IdentifierLiteral } from "../types/IdentifierLiteral";
import { BaseError } from "../../errors/BaseError";
import { runtime } from "../../runtime/Runtime";
import { isTypeArgs } from "../../../library/utils/utils";
import { memberKeys } from "../../runtime/members";
import { type Gen, lift, hostAwait } from "../../runtime/coroutine";

class ForInStatement extends StmtType {
  public readonly variable: StmtType;
  public readonly iterable: StmtType;
  public readonly body: BlockStatement;
  public readonly position: Position;

  constructor(
    variable: StmtType,
    iterable: StmtType,
    body: BlockStatement,
    position: Position,
  ) {
    super();

    this.variable = variable;

    this.iterable = iterable;

    this.body = body;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      const bridgeEnvironment = new Environment(score);
      runtime.markIterationCallPosition();

      yield this.variable.evaluate(bridgeEnvironment);
      let variable: string | null = null;

      if (this.variable instanceof VariableDeclaration) {
        variable = this.variable.name;
      } else if (this.variable instanceof IdentifierLiteral) {
        variable = this.variable.value;
      }

      if (!variable) {
        throw new BaseError("Expected a variable or identifier");
      }

      const iterable = yield this.iterable.evaluate(bridgeEnvironment);

      // `in` throws a host TypeError on primitives, so only probe real containers
      const container =
        iterable !== null &&
        (typeof iterable === "object" || typeof iterable === "function")
          ? iterable
          : null;

      if (container && Environment.SymbolIterator in container) {
        if (isTypeArgs(iterable?.[Environment.SymbolIterator]) !== "function") {
          throw new BaseError(
            `<iter.symbol> expected function. Received ${isTypeArgs(iterable?.[Environment.SymbolIterator])}`,
          );
        }

        const iterator = yield lift(
          iterable[Environment.SymbolIterator].call(
            [{ value: iterable }],
            iterable,
          ),
        );

        if (isTypeArgs(iterator?.next) !== "function") {
          throw new BaseError(
            `<iter.symbol> the function must return a <next> function. Received ${isTypeArgs(iterator?.next)}`,
          );
        }

        let result = yield lift(
          super.isNodeFunction(iterator.next)
            ? iterator.next.call([], iterable)
            : new iterator.next().call(),
        );

        while (!result?.done) {
          const value = result?.value;

          if (runtime.isBreak || runtime.isReturn) break;

          bridgeEnvironment.ensure(variable, value);

          yield this.body.evaluate(new Environment(bridgeEnvironment));

          runtime.resetContinue(); // the iteration is over

          result = yield lift(
            super.isNodeFunction(iterator.next)
              ? iterator.next.call([], iterable)
              : new iterator.next().call(),
          );
        }
      } else if (iterable?.[Environment.SymbolCoIterator]) {
        // host lazy sequence that calls back into the language: it drives the loop body
        const self = this;

        yield iterable[Environment.SymbolCoIterator](function* (
          value: any,
        ): Gen<boolean> {
          if (runtime.isBreak || runtime.isReturn) return false;

          bridgeEnvironment.ensure(variable, value);

          yield self.body.evaluate(new Environment(bridgeEnvironment));

          return !(runtime.isBreak || runtime.isReturn);
        });
      } else if (
        typeof iterable === "string" ||
        (container &&
          (Symbol.iterator in container || Symbol.asyncIterator in container))
      ) {
        const hostIterator =
          container && Symbol.asyncIterator in container
            ? iterable[Symbol.asyncIterator]()
            : null;

        if (hostIterator) {
          for (;;) {
            const step: any = yield hostAwait<any>(hostIterator.next());

            if (step.done || runtime.isBreak || runtime.isReturn) break;

            bridgeEnvironment.ensure(variable, step.value);

            yield this.body.evaluate(new Environment(bridgeEnvironment));

            runtime.resetContinue(); // the iteration is over
          }
        } else {
          for (const value of iterable) {
            if (runtime.isBreak || runtime.isReturn) break;

            bridgeEnvironment.ensure(variable, value);

            yield this.body.evaluate(new Environment(bridgeEnvironment));

            runtime.resetContinue(); // the iteration is over
          }
        }
      } else if (isTypeArgs(iterable) === "object") {
        // `memberKeys` hides the `private` members of a struct instance from code
        // outside that struct, so iterating one never leaks its internals
        for (const key of iterable?.[Symbol.iterator]
          ? iterable
          : memberKeys(iterable)) {
          if (runtime.isBreak || runtime.isReturn) break;

          bridgeEnvironment.update(variable, key);

          yield this.body.evaluate(new Environment(bridgeEnvironment));

          runtime.resetContinue(); // the iteration is over
        }
      } else {
        throw new BaseError(`<${isTypeArgs(iterable)}> is not iterable`);
      }

      runtime.resetBreak();
      runtime.finishIteration();
    } catch (err) {
      throw super.throwErrorFormatters(err, score);
    }
  }
}

export { ForInStatement };
