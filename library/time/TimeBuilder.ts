import { FunctionBuilder, FunctionBuilderCodeError } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { isTypeArgs } from "../utils/utils";

abstract class TimeMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    // A `DateTime` handed in by the program is a wrapper object around a host
    // Date. Unwrap such arguments once, here, so that every function below can
    // simply work with plain Dates.
    super(
      args.map((arg) =>
        arg?.[Environment.SymbolTime] instanceof Date
          ? arg[Environment.SymbolTime]
          : arg,
      ),
      astArgs,
      environment,
    );
  }

  /** Wrap a host Date into the `DateTime` object the program works with. */
  protected wrapDate(date: Date): any {
    const { DateTime } = require("./DateTime");

    return new DateTime([date], [], this.environment).call();
  }

  get pkgInfo() {
    return {
      name: "time",
      path: __dirname,
    };
  }

  protected validateNumber(num: any, argName?: string): void {
    if (argName && isTypeArgs(num) !== "int") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "int",
        received: isTypeArgs(num),
      });
    } else if (isTypeArgs(num) !== "int") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsFirstTypeError, {
        expectType: "int",
        received: isTypeArgs(num),
      });
    }
  }

  protected validateString(str: any, argName?: string): void {
    if (argName && isTypeArgs(str) !== "string") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "string",
        received: isTypeArgs(str),
      });
    } else if (isTypeArgs(str) !== "string") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsFirstTypeError, {
        expectType: "string",
        received: isTypeArgs(str),
      });
    }
  }

  protected validateDate(date: any, argName?: string): void {
    if (!(date instanceof Date)) {
      throw this.throwErrorFormatters(
        argName
          ? FunctionBuilderCodeError.ArgumentsTypeError
          : FunctionBuilderCodeError.ArgumentsFirstTypeError,
        {
          ...(argName ? { propsName: argName } : {}),
          expectType: "date",
          received: isTypeArgs(date),
        },
      );
    }
  }

  protected validateFunction(func: any, argName: string = "callback"): void {
    if (isTypeArgs(func) !== "function") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "function",
        received: isTypeArgs(func),
      });
    }
  }

  call() {
    throw new Error("Call is not implemented");
  }
}

export { TimeMethodBuilder };
