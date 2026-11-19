import { randomUUID } from "node:crypto";
import { StmtType, type ITextOptions } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { type BlockStatement } from "../statement/BlockStatement";
import { FunctionDeclaration } from "../declaration/FunctionDeclaration";
import { Environment, type IOptionsVar } from "../../Environment";
import { runtime } from "../../runtime/Runtime";
import { type Gen } from "../../runtime/coroutine";

class FunctionExpression extends StmtType {
  public name: string | null;
  public readonly id: string = randomUUID();
  public readonly params: [string, StmtType, true?][];
  public readonly body: BlockStatement;
  public parentEnv: Environment = new Environment();
  public readonly position: Position;
  /**
   * The struct type this function is a method of, when it is one. While the method runs,
   * that type is on the task's struct stack, which is what lets it reach the `private`
   * members of its own struct (see `runtime/structMembers`).
   */
  public ownerStruct: any = null;

  constructor(
    name: string | null,
    params: [string, StmtType, true?][],
    body: BlockStatement,
    position: Position,
  ) {
    super();

    this.name = name;

    this.params = params;

    this.body = body;

    this.position = position;
  }

  *call(
    args: { options?: IOptionsVar; value: any }[],
    callerInstance?: any,
  ): Gen<any> {
    const callEnvironment = new Environment(this.parentEnv);

    for (let i = 0; i < this.params.length; i++) {
      const argument = args[i];
      const [param, defaultValue, rest] = this.params[i]!;

      if (!rest) {
        if (argument) {
          callEnvironment.create(param, argument.value, argument.options);
          continue;
        }

        callEnvironment.create(
          param,
          yield defaultValue.evaluate(callEnvironment),
        );
      } else {
        callEnvironment.create(
          param,
          args.slice(i).map(({ value }) => value),
        );
        break;
      }
    }

    callEnvironment.create(
      "arguments",
      args.map(({ value }) => value),
    );

    for (const key of Object.keys(callEnvironment)) {
      if (
        !this.parentEnv.has(key) ||
        this.parentEnv.get(key) instanceof FunctionDeclaration
      )
        continue;
      this.parentEnv.update(key, callEnvironment.get(key));
    }

    // `this` resolution (same rules as FunctionDeclaration.call):
    // a real lexical `this` wins, then the object the method was called on,
    // then the `process` fallback. The inherited fallback itself must not hide
    // the object a method is called on.
    const rootProcess = this.parentEnv.getRootEnv().get("process");
    const lexicalThis = this.parentEnv.has("this")
      ? this.parentEnv.get("this")
      : undefined;

    if (
      lexicalThis !== undefined &&
      !(callerInstance && lexicalThis === rootProcess)
    ) {
      callEnvironment.create("this", lexicalThis);
    } else if (callerInstance) {
      callEnvironment.create("this", callerInstance);
    } else {
      callEnvironment.create("this", rootProcess);
    }

    const insideStruct = this.ownerStruct !== null;

    if (insideStruct) runtime.enterStruct(this.ownerStruct);

    try {
      runtime.markFunctionCallPosition();

      yield this.body.evaluate(callEnvironment);

      const result = runtime.getLastExecutionResult();
      runtime.resetLastExecutionResult();
      runtime.finishFunction();

      return result;
    } catch (err) {
      throw super.throwErrorFormatters(
        err,
        callEnvironment,
        ({ file, position }: ITextOptions) => {
          return `${this.name ? this.name : "[anonymousFunc]"} (${file}:${position.line}:${position.column})`;
        },
      );
    } finally {
      if (insideStruct) runtime.leaveStruct();
    }
  }

  *evaluate(score: Environment) {
    const func = new FunctionExpression(
      this.name,
      this.params,
      this.body,
      this.position,
    );

    func.parentEnv = score;
    func.ownerStruct = this.ownerStruct;

    return func;
  }
}

export { FunctionExpression };
