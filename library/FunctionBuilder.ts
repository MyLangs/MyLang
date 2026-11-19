import { type StmtType } from "../src/ast/StmtType";
import { Environment } from "../src/Environment";
import { BaseError } from "../src/errors/BaseError";
import { formatMessage } from "../src/errors/utils";
import { isSubclassOfByName } from "../src/utils/isSubclassOfByName";
import { FunctionDeclaration } from "../src/ast/declaration/FunctionDeclaration";
import { FunctionExpression } from "../src/ast/expression/FunctionExpression";
import { StructExpression } from "../src/ast/expression/StructExpression";
import { StructDeclaration } from "../src/ast/declaration/StructDeclaration";
import { type Gen, callNative } from "../src/runtime/coroutine";
import { toBuffer, toBytes, type BinaryLike } from "./kernel/buffers";
import {
  assertString,
  assertNumber,
  assertInteger,
  assertBoolean,
  assertArray,
  assertObject,
  assertFunction,
  assertBinary,
  assertEncoding,
  assertPort,
} from "./kernel/validate";
import { security } from "../src/security";
import type { PermissionKind } from "../src/security";

interface IPkgInfo {
  name: string;
  path: string;
}

interface FunctionBuilderConstructor {
  new (args: any[], astArgs: StmtType[], env: Environment): FunctionBuilder;
}

enum FunctionBuilderCodeError {
  ArgumentsTypeError = "ARGUMENTS_TYPE_ERROR",
  ArgumentsFirstTypeError = "ARGUMENTS_FIRST_TYPE_ERROR",
}

const FunctionBuilderMessageError = {
  [FunctionBuilderCodeError.ArgumentsFirstTypeError]:
    "The first argument must be of type ${expectType}. Received ${received}",
  [FunctionBuilderCodeError.ArgumentsTypeError]:
    "Argument ${propsName} must be of type ${expectType}. Received ${received}",
};

abstract class FunctionBuilder {
  public readonly args: any[];
  public readonly astArgs: StmtType[];
  public readonly environment: Environment;

  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    this.args = args;

    this.astArgs = astArgs;

    this.environment = environment;
  }

  /**
   * Call a language callback (or native function) from inside the current task.
   * The caller must `yield` it (call it as a sub-coroutine); the callback may suspend like any other code.
   */
  protected *executeCallback(callbackFunc: any, args: any[]): Gen<any> {
    if (this.isBuildModuleFunction(callbackFunc)) {
      return yield callNative(new callbackFunc(args, [], this.environment));
    }

    return yield callbackFunc.call(args.map((v: any) => ({ value: v })));
  }

  /**
   * Call a language callback from host code that cannot suspend (Node.js callbacks, timers).
   * The callback runs as its own task; errors are reported instead of crashing the process.
   */
  protected fireCallback(callbackFunc: any, args: any[], name = "callback") {
    // lazy require: the runtime module depends on the AST, which depends on this file
    const { runtime } =
      require("../src/runtime/Runtime") as typeof import("../src/runtime/Runtime");

    return runtime.scheduler.spawn(() => this.executeCallback(callbackFunc, args), {
      name,
      onError: (error) => console.error(`Error in ${name}:`, error),
    });
  }

  // ----------------------------------------------------------------- kernel
  // Shared with every library through `library/kernel`, so binary handling,
  // validation and permission checks behave identically everywhere.

  /** Normalise `bytes` / buffer / byte array / string to a host `Buffer`. */
  protected toBuffer(value: BinaryLike, encoding?: BufferEncoding): Buffer {
    try {
      return toBuffer(value, encoding);
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }

  /** Wrap host bytes in the language's `bytes` value. */
  protected toBytes(value: BinaryLike): any {
    return toBytes(value, this.environment);
  }

  /** Throw a `PermissionError` unless the policy allows `target` for `kind`. */
  protected checkPermission(kind: PermissionKind, target?: string): void {
    security.check(kind, target);
  }

  /** Never throws: `true` when the policy allows `target` for `kind`. */
  protected hasPermission(kind: PermissionKind, target?: string): boolean {
    return security.can(kind, target);
  }

  /**
   * Refuse an allocation of `bytes` that would take the program past `--max-memory`.
   * Anything that allocates a buffer whose size the program chose asks here first, so a
   * single huge allocation cannot slip between two of the scheduler's memory samples.
   */
  protected checkAllocation(bytes: number): void {
    security.allocation(bytes);
  }

  protected assertString(value: any, name?: string): string {
    return assertString(this, value, name);
  }

  protected assertNumber(value: any, name?: string): number {
    return assertNumber(this, value, name);
  }

  protected assertInteger(value: any, name?: string): number {
    return assertInteger(this, value, name);
  }

  protected assertBoolean(value: any, name?: string): boolean {
    return assertBoolean(this, value, name);
  }

  protected assertArray(value: any, name?: string): any[] {
    return assertArray(this, value, name);
  }

  protected assertObject(value: any, name?: string): Record<string, any> {
    return assertObject(this, value, name);
  }

  protected assertFunction(value: any, name?: string): any {
    return assertFunction(this, value, name);
  }

  protected assertBinary(value: any, name?: string): any {
    return assertBinary(this, value, name);
  }

  protected assertEncoding(value: any, name?: string): BufferEncoding {
    return assertEncoding(this, value, name);
  }

  protected assertPort(value: any, name?: string): number {
    return assertPort(this, value, name);
  }

  abstract get pkgInfo(): IPkgInfo;

  abstract call(): any;

  isBuildModuleFunction(value: any): value is FunctionBuilderConstructor {
    if (!value) return false;

    return isSubclassOfByName(value, "FunctionBuilder");
  }

  isNodeFunction(value: any): value is FunctionExpression | FunctionDeclaration {
    if (!value) return false;

    return value instanceof FunctionExpression || value instanceof FunctionDeclaration;
  }

  isStructData(value: any): value is StructExpression | StructDeclaration {
    if (!value) return false;

    return value instanceof StructExpression || value instanceof StructDeclaration;
  }

  throwErrorFormatters(
    err: Error | FunctionBuilderCodeError,
    format?: Record<string, any>,
  ): BaseError {
    if (err instanceof Error) {
      return new BaseError(err.toString(), {
        name: err.name,
        code: (err as any).code,
        files: [`${this.constructor.name} (${this.pkgInfo.path}  mylang:${this.pkgInfo.name})`],
      });
    }

    return new BaseError(
      format
        ? formatMessage(FunctionBuilderMessageError[err], format)
        : FunctionBuilderMessageError[err],
      {
        name: (err as any).name,
        code: (err as any).code,
        files: [`${this.constructor.name} (${this.pkgInfo.path} mylang:${this.pkgInfo.name})`],
      },
    );
  }
}

export {
  FunctionBuilder,
  FunctionBuilderCodeError,
  FunctionBuilderMessageError,
  type FunctionBuilderConstructor,
};
