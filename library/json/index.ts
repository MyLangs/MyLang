import { FunctionBuilder, FunctionBuilderCodeError } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { isTypeArgs } from "../utils/utils";
import { type Gen, lift } from "../../src/runtime/coroutine";

abstract class JsonMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return {
      name: "json",
      path: __dirname,
    };
  }

  protected validateString(str: any, argName: string = "string"): void {
    if (isTypeArgs(str) !== "string") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "string",
        received: isTypeArgs(str),
      });
    }
  }

  protected validateObject(obj: any, argName: string = "object"): void {
    if (obj === null || (isTypeArgs(obj) !== "object" && isTypeArgs(obj) !== "array")) {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "object",
        received: isTypeArgs(obj),
      });
    }
  }

  protected validateNumber(num: any, argName: string = "number"): void {
    if (isTypeArgs(num) !== "int") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "int",
        received: isTypeArgs(num),
      });
    }
  }

  protected validateFunction(func: any, argName: string = "function"): void {
    if (isTypeArgs(func) !== "function") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "func",
        received: isTypeArgs(func),
      });
    }
  }

  protected override *executeCallback(callbackFunc: any, args: any[]): Gen<any> {
    if (this.isBuildModuleFunction(callbackFunc)) {
      return yield lift(new callbackFunc(args, [], this.environment).call());
    }
    return yield lift(callbackFunc.call(args.map((v) => ({ value: v }))));
  }

  call() {
    throw new Error("Call is not implemented");
  }
}

function isPlainContainer(value: any): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return true;

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

class Parse extends JsonMethodBuilder {
  override *call(): Gen<any> {
    const [jsonString, reviver] = this.args;
    this.validateString(jsonString, "jsonString");

    let parsed: any;

    try {
      parsed = JSON.parse(jsonString);
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`JSON Parse Error: ${error.message}`));
    }

    if (reviver === undefined) {
      return parsed;
    }

    this.validateFunction(reviver, "reviver");

    // The reviver is a language function (a coroutine), so the host's own
    // `JSON.parse(text, reviver)` cannot call it. Walk the parsed tree instead,
    // children first, exactly like the ECMAScript algorithm does.
    const self = this;
    const walk = function* (holder: any, key: string): Gen<any> {
      const value = holder[key];

      if (value !== null && typeof value === "object") {
        for (const childKey of Object.keys(value)) {
          const revived = yield walk(value, childKey);

          if (revived === undefined) {
            delete value[childKey];
          } else {
            value[childKey] = revived;
          }
        }
      }

      return yield self.executeCallback(reviver, [key, value, holder]);
    };

    return yield walk({ "": parsed }, "");
  }
}

class Stringify extends JsonMethodBuilder {
  override *call(): Gen<any> {
    const [value, replacer, space] = this.args;

    const replacerFn =
      replacer !== undefined && replacer !== null && isTypeArgs(replacer) === "function"
        ? replacer
        : undefined;
    const replacerList =
      replacer !== undefined && replacer !== null && isTypeArgs(replacer) === "array"
        ? replacer
        : undefined;

    const self = this;
    const ancestors = new Set<any>();

    // Language functions are objects for the host: drop them (as JSON does for
    // functions) and apply a replacer function by walking the tree ourselves.
    const prepare = function* (holder: any, key: string): Gen<any> {
      let current = holder[key];

      if (replacerFn !== undefined) {
        current = yield self.executeCallback(replacerFn, [key, current, holder]);
      }

      if (isTypeArgs(current) === "function") {
        return undefined;
      }

      if (!isPlainContainer(current)) {
        return current;
      }

      if (ancestors.has(current)) {
        throw new Error("Converting circular structure to JSON");
      }

      ancestors.add(current);

      try {
        if (Array.isArray(current)) {
          const out: any[] = [];

          for (let i = 0; i < current.length; i++) {
            out.push(yield prepare(current, String(i)));
          }

          return out;
        }

        const out: Record<string, any> = {};

        for (const childKey of Object.keys(current)) {
          const child = yield prepare(current, childKey);

          if (child !== undefined) {
            out[childKey] = child;
          }
        }

        return out;
      } finally {
        ancestors.delete(current);
      }
    };

    try {
      const prepared = yield prepare({ "": value }, "");

      return JSON.stringify(
        prepared,
        replacerList as any,
        space !== undefined && space !== null ? space : undefined,
      );
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`JSON Stringify Error: ${error.message}`));
    }
  }
}

module.exports = { parse: Parse, stringify: Stringify };
