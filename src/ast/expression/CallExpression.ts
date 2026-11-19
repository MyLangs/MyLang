import { StmtType, type ITextOptions } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { MemberExpression } from "./MemberExpression";
import { IdentifierLiteral } from "../types/IdentifierLiteral";
import { Environment } from "../../Environment";
import { hasMember, lookupMember } from "../../runtime/members";
import { assertMemberAccess } from "../../runtime/structMembers";
import {
  FunctionCallError,
  FunctionCallCodeError,
} from "../../errors/runtime/FunctionCallError";
import { lift, type Gen } from "../../runtime/coroutine";

class CallExpression extends StmtType {
  public readonly identifier: string;
  public readonly method: string | StmtType;
  public readonly callee: MemberExpression | IdentifierLiteral | null;
  public readonly argument: StmtType[];
  public readonly position: Position;

  constructor(
    identifier: string,
    method: string | StmtType,
    callee: MemberExpression | IdentifierLiteral | null,
    argument: StmtType[],
    position: Position,
  ) {
    super();

    this.identifier = identifier;

    this.method = method;

    this.callee = callee;

    this.argument = argument;

    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    try {
      if (!this.callee) {
        if (super.isNodeFunction(score.get(this.identifier))) {
          const func = score.get(this.identifier);

          // arguments are evaluated in the caller's live scope (never in a copy),
          // so closures and side effects (`f(i++)`) act on the real variables
          const evaluatedArgs = [];
          for (const arg of this.argument) {
            evaluatedArgs.push(yield arg.evaluate(score));
          }

          return yield lift(func.call(evaluatedArgs));
        }

        const method =
          this.method instanceof StmtType
            ? yield this.method.evaluate(score)
            : this.method;

        // a `private` method may only be called from inside its own struct
        assertMemberAccess(score.get(this.identifier), method, "call");

        if (!hasMember(score.get(this.identifier), method)) {
          throw new FunctionCallError(
            FunctionCallCodeError.FunctionIsNotMethod,
            {
              method,
              identifier: this.identifier,
              files: score.get("import").paths,
            },
          );
        }

        const methodVar = lookupMember(score.get(this.identifier), method);

        if (super.isNodeFunction(methodVar)) {
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

          return yield methodVar.call(argument, score.get(this.identifier));
        }

        if (super.isBuildModuleFunction(methodVar)) {
          const argument = [];
          for (const arg of this.argument) {
            argument.push(yield arg.evaluate(score));
          }

          return yield lift(
            new methodVar(argument, this.argument, score).call(),
          );
        }

        if (super.isStructData(methodVar)) {
          const argument = [];
          for (const arg of this.argument) {
            argument.push(yield arg.evaluate(score));
          }

          return yield methodVar.call(argument);
        }

        throw new FunctionCallError(FunctionCallCodeError.FunctionCallUnknown, {
          name: `${this.identifier}.${method}`,
          files: score.get("import").paths,
        });
      }

      const obj = yield this.callee.evaluate(score);

      const method =
        this.method instanceof StmtType
          ? yield this.method.evaluate(score)
          : this.method;

      assertMemberAccess(obj, method, "call");

      const methodRef = lookupMember(obj, method) || obj;

      if (super.isNodeFunction(methodRef)) {
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

        // `this` is the object the method was found on. It was already
        // evaluated above; evaluating the callee a second time would run its
        // side effects twice (`a.add(1).mul(2)` would add twice).
        return yield methodRef.call(argument, obj);
      }

      if (super.isBuildModuleFunction(methodRef)) {
        const argument = [];
        for (const arg of this.argument) {
          argument.push(yield arg.evaluate(score));
        }

        return yield lift(new methodRef(argument, this.argument, score).call());
      }

      if (super.isStructData(methodRef)) {
        const argument = [];
        for (const arg of this.argument) {
          argument.push(yield arg.evaluate(score));
        }

        return yield methodRef.call(argument);
      }

      const unknownFunction =
        this.callee && "value" in this.callee
          ? this.callee.value
          : this.identifier;

      throw new FunctionCallError(FunctionCallCodeError.FunctionCallUnknown, {
        name:
          unknownFunction === method
            ? unknownFunction
            : `${unknownFunction}.${method}`,
        files: score.get("import").paths,
      });
    } catch (err) {
      throw super.throwErrorFormatters(
        err,
        score,
        ({ file, position }: ITextOptions) => {
          if (this.callee && "value" in this.callee) {
            return `${this.callee.value}.${this.method} (${file}:${position.line}:${position.column})`;
          } else if (this.callee && "method" in this.callee) {
            return `${this.callee.method}.${this.method} (${file}:${position.line}:${position.column})`;
          }
          return `${this.identifier}.${this.method} (${file}:${position.line}:${position.column})`;
        },
      );
    }
  }
}

export { CallExpression };
