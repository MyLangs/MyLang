import { FunctionBuilder, FunctionBuilderCodeError } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { isTypeArgs } from "../utils/utils";
import { type Gen, lift } from "../../src/runtime/coroutine";

abstract class EventMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return {
      name: "events",
      path: __dirname,
    };
  }

  protected validateString(str: any, argName: string = "event"): void {
    if (isTypeArgs(str) !== "string") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "string",
        received: isTypeArgs(str),
      });
    }
  }

  protected validateFunction(func: any, argName: string = "listener"): void {
    if (isTypeArgs(func) !== "function") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "function",
        received: isTypeArgs(func),
      });
    }
  }

  protected validateNumber(num: any, argName: string): void {
    if (isTypeArgs(num) !== "int") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "int",
        received: isTypeArgs(num),
      });
    }
  }

  protected validateEventEmitter(emitter: any, argName?: string): void {
    if (argName && !emitter?.[Environment.SymbolEvents]) {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "EventEmitter",
        received: isTypeArgs(emitter),
      });
    } else if (!emitter?.[Environment.SymbolEvents]) {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsFirstTypeError, {
        expectType: "EventEmitter",
        received: isTypeArgs(emitter),
      });
    }
  }

  protected *executeListener(listener: any, args: any[]): Gen<any> {
    if (this.isBuildModuleFunction(listener)) {
      return yield lift(new listener(args, [], this.environment).call());
    }
    return yield lift(listener.call(args.map((v) => ({ value: v }))));
  }

  /** Notify a listener from synchronous code: runs as its own task, errors are reported. */
  protected fireListener(listener: any, args: any[]) {
    return this.fireCallback(listener, args, "listener");
  }

  call() {
    throw new Error("Call is not implemented");
  }
}

export { EventMethodBuilder };
