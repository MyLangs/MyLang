/**
 * `test.assert.*` - the assertions.
 *
 * Every failure is a `BaseError` named `AssertionError`, which is what the reporter looks
 * for to tell an assertion apart from a crash inside the test.
 *
 * `assert.throws` / `assert.doesNotThrow` call back into the language, so they are
 * coroutines: the function under test may `wait`, `spawn` or sleep like any other code.
 */

import { BaseError } from "../../src/errors/BaseError";
import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { type Gen } from "../../src/runtime/coroutine";
import { isTypeArgs } from "../utils/utils";
import { show, deepEq, errorText, contains, isNumberType } from "./values";

/** Raise an assertion failure. */
function fail(message: string): never {
  throw new BaseError(message, { name: "AssertionError", files: [] });
}

/** Prefix the generated text with the caller's own message, when they gave one. */
function withMessage(base: string, custom: any): string {
  if (custom === undefined || custom === null || custom === "") return base;

  return `${custom} — ${base}`;
}

abstract class AssertBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return { name: "test", path: __dirname };
  }

  call(): any {
    throw new Error("Call is not implemented");
  }
}

class Fail extends AssertBuilder {
  override call() {
    const [message] = this.args;

    return fail(message === undefined || message === null ? "explicit failure" : String(message));
  }
}

class Ok extends AssertBuilder {
  override call() {
    const [value, message] = this.args;

    if (!value) {
      fail(withMessage(`expected a truthy value, received ${show(value)}`, message));
    }

    return null;
  }
}

class NotOk extends AssertBuilder {
  override call() {
    const [value, message] = this.args;

    if (value) {
      fail(withMessage(`expected a falsy value, received ${show(value)}`, message));
    }

    return null;
  }
}

class IsTrue extends AssertBuilder {
  override call() {
    const [value, message] = this.args;

    if (value !== true) {
      fail(withMessage(`expected true, received ${show(value)}`, message));
    }

    return null;
  }
}

class IsFalse extends AssertBuilder {
  override call() {
    const [value, message] = this.args;

    if (value !== false) {
      fail(withMessage(`expected false, received ${show(value)}`, message));
    }

    return null;
  }
}

class IsNil extends AssertBuilder {
  override call() {
    const [value, message] = this.args;

    if (value !== null && value !== undefined) {
      fail(withMessage(`expected nil, received ${show(value)}`, message));
    }

    return null;
  }
}

class NotNil extends AssertBuilder {
  override call() {
    const [value, message] = this.args;

    if (value === null || value === undefined) {
      fail(withMessage("expected a non-nil value", message));
    }

    return null;
  }
}

class Equal extends AssertBuilder {
  override call() {
    const [actual, expected, message] = this.args;

    if (!deepEq(actual, expected)) {
      fail(
        withMessage(
          `expected ${show(expected)}, received ${show(actual)}`,
          message,
        ),
      );
    }

    return null;
  }
}

class NotEqual extends AssertBuilder {
  override call() {
    const [actual, expected, message] = this.args;

    if (deepEq(actual, expected)) {
      fail(withMessage(`expected value to differ from ${show(expected)}`, message));
    }

    return null;
  }
}

class TypeOf extends AssertBuilder {
  override call() {
    const [value, expected, message] = this.args;
    const actual = isTypeArgs(value);

    if (actual !== expected) {
      fail(
        withMessage(
          `expected type ${show(expected)}, received type ${show(actual)} (${show(value)})`,
          message,
        ),
      );
    }

    return null;
  }
}

class CloseTo extends AssertBuilder {
  override call() {
    const [actual, expected, epsilon, message] = this.args;
    const tolerance =
      epsilon === undefined || epsilon === null ? 0.000001 : epsilon;

    if (!isNumberType(isTypeArgs(actual))) {
      fail(
        withMessage(
          `expected a number close to ${show(expected)}, received ${show(actual)}`,
          message,
        ),
      );
    }

    if (Math.abs(actual - expected) > tolerance) {
      fail(
        withMessage(
          `expected ${show(actual)} to be within ${show(tolerance)} of ${show(expected)}`,
          message,
        ),
      );
    }

    return null;
  }
}

class Greater extends AssertBuilder {
  override call() {
    const [actual, bound, message] = this.args;

    if (!(actual > bound)) {
      fail(withMessage(`${show(actual)} is not greater than ${show(bound)}`, message));
    }

    return null;
  }
}

class GreaterOrEqual extends AssertBuilder {
  override call() {
    const [actual, bound, message] = this.args;

    if (!(actual >= bound)) {
      fail(withMessage(`${show(actual)} is not >= ${show(bound)}`, message));
    }

    return null;
  }
}

class Less extends AssertBuilder {
  override call() {
    const [actual, bound, message] = this.args;

    if (!(actual < bound)) {
      fail(withMessage(`${show(actual)} is not less than ${show(bound)}`, message));
    }

    return null;
  }
}

class LessOrEqual extends AssertBuilder {
  override call() {
    const [actual, bound, message] = this.args;

    if (!(actual <= bound)) {
      fail(withMessage(`${show(actual)} is not <= ${show(bound)}`, message));
    }

    return null;
  }
}

/** `length()` as the language computes it: strings, arrays and objects. */
function lengthOf(value: any): number {
  if (typeof value === "string" || Array.isArray(value)) return value.length;

  if (value !== null && typeof value === "object") return Object.keys(value).length;

  return 0;
}

class LengthOf extends AssertBuilder {
  override call() {
    const [value, expected, message] = this.args;
    const actual = lengthOf(value);

    if (actual !== expected) {
      fail(
        withMessage(
          `expected length ${show(expected)}, received ${show(actual)} for ${show(value)}`,
          message,
        ),
      );
    }

    return null;
  }
}

class Includes extends AssertBuilder {
  override call() {
    const [container, item, message] = this.args;
    const result = contains(container, item);

    if (result === null) {
      fail(`includes: unsupported container type ${show(isTypeArgs(container))}`);
    }

    if (!result) {
      fail(withMessage(`${show(container)} does not include ${show(item)}`, message));
    }

    return null;
  }
}

class NotIncludes extends AssertBuilder {
  override call() {
    const [container, item, message] = this.args;
    const result = contains(container, item);

    if (result === null) {
      fail(`notIncludes: unsupported container type ${show(isTypeArgs(container))}`);
    }

    if (result) {
      fail(
        withMessage(`${show(container)} unexpectedly includes ${show(item)}`, message),
      );
    }

    return null;
  }
}

class Throws extends AssertBuilder {
  override *call(): Gen<any> {
    const [fn, expected, message] = this.args;

    this.assertFunction(fn, "fn");

    let threw = false;
    let caught: any = null;

    try {
      yield this.executeCallback(fn, []);
    } catch (error) {
      threw = true;
      caught = error;
    }

    if (!threw) fail(withMessage("expected function to throw", message));

    if (expected !== undefined && expected !== null) {
      const text = errorText(caught);

      if (!text.includes(String(expected))) {
        fail(
          withMessage(
            `expected error containing ${show(expected)}, received ${show(text)}`,
            message,
          ),
        );
      }
    }

    return caught;
  }
}

class DoesNotThrow extends AssertBuilder {
  override *call(): Gen<any> {
    const [fn, message] = this.args;

    this.assertFunction(fn, "fn");

    try {
      yield this.executeCallback(fn, []);
    } catch (error) {
      fail(withMessage(`expected no error, but threw: ${errorText(error)}`, message));
    }

    return null;
  }
}

const assertions = {
  fail: Fail,
  ok: Ok,
  notOk: NotOk,
  isTrue: IsTrue,
  isFalse: IsFalse,
  isNil: IsNil,
  notNil: NotNil,
  equal: Equal,
  notEqual: NotEqual,
  typeOf: TypeOf,
  closeTo: CloseTo,
  greater: Greater,
  greaterOrEqual: GreaterOrEqual,
  less: Less,
  lessOrEqual: LessOrEqual,
  lengthOf: LengthOf,
  includes: Includes,
  notIncludes: NotIncludes,
  throws: Throws,
  doesNotThrow: DoesNotThrow,
};

export { assertions, AssertBuilder, fail, withMessage, lengthOf };
