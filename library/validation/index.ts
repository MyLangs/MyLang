/**
 * `validation` - checking that a value has the shape a program expects.
 *
 * Input that comes from outside - a parsed JSON body, a config file, a form, a message off
 * a socket - is `nil` or the wrong type far more often than code written against it
 * assumes. A schema says what the shape must be, once, and every check reports *which*
 * field was wrong rather than failing somewhere deep in the program.
 *
 *     var user = validation.object({
 *       name:  validation.string({ min: 1, max: 64 }),
 *       age:   validation.integer({ min: 0, max: 130, optional: true }),
 *       email: validation.string({ pattern: "^[^@]+@[^@]+$" }),
 *       tags:  validation.array(validation.string(), { max: 10 })
 *     });
 *
 *     var result = validation.check(user, body);
 *     if (!result.valid) { coreio.print(result.errors); }
 *
 *     var value = validation.parse(user, body);   // returns the value, or throws
 *
 * Schemas are plain values, so they can be stored in a variable, nested, and shared
 * between libraries. Nothing here touches the outside world: no permissions, no waiting.
 */

import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { type Gen } from "../../src/runtime/coroutine";
import { isTypeArgs } from "../utils/utils";

const PKG = { name: "validation", path: __dirname };

/** Marks a language value as a schema produced by this library. */
const SCHEMA = Symbol("ValidationSchema");

type Kind =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "enum"
  | "any"
  | "custom";

interface Schema {
  kind: Kind;
  optional: boolean;
  nullable: boolean;
  /** `undefined` when the field has no default. */
  fallback?: any;
  min?: number;
  max?: number;
  pattern?: RegExp;
  patternText?: string;
  values?: any[];
  /** element schema for `array` */
  items?: Schema;
  /** field schemas for `object` */
  fields?: Record<string, Schema>;
  /** reject members the schema does not describe */
  strict?: boolean;
  /** language predicate for `custom` */
  predicate?: any;
  /** shown instead of the generated message */
  message?: string;
}

interface Failure {
  path: string;
  message: string;
}

/** A schema as the language sees it: opaque apart from `kind`. */
function wrap(schema: Schema): Record<string | symbol, any> {
  return {
    kind: schema.kind,
    optional: schema.optional,
    [SCHEMA]: schema,
    [Environment.SymbolFormatedText]: `Schema { ${schema.kind}${schema.optional ? ", optional" : ""} }`,
  };
}

function unwrap(value: any): Schema | null {
  const schema = value?.[SCHEMA];

  return schema && typeof schema === "object" ? (schema as Schema) : null;
}

function joinPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;

  return parent === "" ? key : `${parent}.${key}`;
}

abstract class ValidationMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return PKG;
  }

  /**
   * Run a `custom` predicate. It is language code, so it may suspend like anything else;
   * `validate` goes through this method because `executeCallback` is protected.
   */
  *runPredicate(predicate: any, value: any): Gen<any> {
    return yield this.executeCallback(predicate, [value]);
  }

  /** Read the shared options every schema accepts. */
  protected baseOptions(options: any): Schema {
    const opts = options ?? {};

    if (options !== undefined && options !== null) {
      this.assertObject(options, "options");
    }

    const schema: Schema = {
      kind: "any",
      optional: opts.optional === true,
      nullable: opts.nullable === true,
    };

    if ("fallback" in opts) schema.fallback = opts.fallback;
    if (typeof opts.message === "string") schema.message = opts.message;
    if (typeof opts.min === "number") schema.min = opts.min;
    if (typeof opts.max === "number") schema.max = opts.max;

    if (typeof opts.pattern === "string") {
      try {
        schema.pattern = new RegExp(opts.pattern);
        schema.patternText = opts.pattern;
      } catch {
        throw this.throwErrorFormatters(
          new Error(`invalid pattern: ${opts.pattern}`),
        );
      }
    }

    return schema;
  }

  /** A schema argument, rejected with a clear message when it is something else. */
  protected asSchema(value: any, name = "schema"): Schema {
    const schema = unwrap(value);

    if (!schema) {
      throw this.throwErrorFormatters(
        new Error(
          `${name} must be a validation schema, received ${isTypeArgs(value)}`,
        ),
      );
    }

    return schema;
  }

  call(): any {
    throw new Error("Call is not implemented");
  }
}

/** Does `value` satisfy `schema`? Collects every failure instead of stopping at the first. */
function* validate(
  builder: ValidationMethodBuilder,
  schema: Schema,
  value: any,
  path: string,
  failures: Failure[],
): Gen<any> {
  const missing = value === undefined || value === null;

  if (missing) {
    if (schema.nullable || schema.optional) {
      return "fallback" in schema ? schema.fallback : value ?? null;
    }

    failures.push({ path, message: schema.message ?? "is required" });

    return null;
  }

  const type = isTypeArgs(value);

  switch (schema.kind) {
    case "any":
      return value;

    case "string": {
      if (type !== "string") {
        failures.push({
          path,
          message: schema.message ?? `must be a string, received ${type}`,
        });
        return value;
      }

      if (schema.min !== undefined && value.length < schema.min) {
        failures.push({
          path,
          message: schema.message ?? `must be at least ${schema.min} characters`,
        });
      }

      if (schema.max !== undefined && value.length > schema.max) {
        failures.push({
          path,
          message: schema.message ?? `must be at most ${schema.max} characters`,
        });
      }

      if (schema.pattern && !schema.pattern.test(value)) {
        failures.push({
          path,
          message: schema.message ?? `must match ${schema.patternText}`,
        });
      }

      return value;
    }

    case "number":
    case "integer": {
      const isNumber = type === "int" || type === "float";
      const wanted = schema.kind === "integer" ? "an integer" : "a number";

      if (!isNumber || (schema.kind === "integer" && type !== "int")) {
        failures.push({
          path,
          message: schema.message ?? `must be ${wanted}, received ${type}`,
        });
        return value;
      }

      if (schema.min !== undefined && value < schema.min) {
        failures.push({
          path,
          message: schema.message ?? `must be at least ${schema.min}`,
        });
      }

      if (schema.max !== undefined && value > schema.max) {
        failures.push({
          path,
          message: schema.message ?? `must be at most ${schema.max}`,
        });
      }

      return value;
    }

    case "boolean": {
      if (type !== "boolean") {
        failures.push({
          path,
          message: schema.message ?? `must be a boolean, received ${type}`,
        });
      }

      return value;
    }

    case "enum": {
      if (!schema.values!.some((allowed) => allowed === value)) {
        failures.push({
          path,
          message:
            schema.message ??
            `must be one of: ${schema.values!.map((entry) => String(entry)).join(", ")}`,
        });
      }

      return value;
    }

    case "array": {
      if (type !== "array") {
        failures.push({
          path,
          message: schema.message ?? `must be an array, received ${type}`,
        });
        return value;
      }

      if (schema.min !== undefined && value.length < schema.min) {
        failures.push({
          path,
          message: schema.message ?? `must have at least ${schema.min} item(s)`,
        });
      }

      if (schema.max !== undefined && value.length > schema.max) {
        failures.push({
          path,
          message: schema.message ?? `must have at most ${schema.max} item(s)`,
        });
      }

      if (!schema.items) return value;

      const items: any[] = [];

      for (let i = 0; i < value.length; i++) {
        items.push(
          yield validate(
            builder,
            schema.items,
            value[i],
            joinPath(path, i),
            failures,
          ),
        );
      }

      return items;
    }

    case "object": {
      if (type !== "object" && type !== "struct") {
        failures.push({
          path,
          message: schema.message ?? `must be an object, received ${type}`,
        });
        return value;
      }

      const result: Record<string, any> = {};
      const fields = schema.fields ?? {};

      for (const key of Object.keys(fields)) {
        const field = fields[key]!;
        const present = Object.prototype.hasOwnProperty.call(value, key);

        const checked = yield validate(
          builder,
          field,
          present ? value[key] : undefined,
          joinPath(path, key),
          failures,
        );

        if (present || checked !== undefined) result[key] = checked;
      }

      if (schema.strict) {
        for (const key of Object.keys(value)) {
          if (!Object.prototype.hasOwnProperty.call(fields, key)) {
            failures.push({
              path: joinPath(path, key),
              message: "is not allowed",
            });
          }
        }
      } else {
        for (const key of Object.keys(value)) {
          if (!Object.prototype.hasOwnProperty.call(fields, key)) {
            result[key] = value[key];
          }
        }
      }

      return result;
    }

    case "custom": {
      // the predicate is language code: it may suspend like anything else
      const ok = yield builder.runPredicate(schema.predicate, value);

      if (ok === false) {
        failures.push({ path, message: schema.message ?? "is not valid" });
      } else if (typeof ok === "string") {
        failures.push({ path, message: ok });
      }

      return value;
    }

    default:
      return value;
  }
}

// ------------------------------------------------------------------ schemas

class StringSchema extends ValidationMethodBuilder {
  override call() {
    const schema = this.baseOptions(this.args[0]);

    schema.kind = "string";

    return wrap(schema);
  }
}

class NumberSchema extends ValidationMethodBuilder {
  override call() {
    const schema = this.baseOptions(this.args[0]);

    schema.kind = "number";

    return wrap(schema);
  }
}

class IntegerSchema extends ValidationMethodBuilder {
  override call() {
    const schema = this.baseOptions(this.args[0]);

    schema.kind = "integer";

    return wrap(schema);
  }
}

class BooleanSchema extends ValidationMethodBuilder {
  override call() {
    const schema = this.baseOptions(this.args[0]);

    schema.kind = "boolean";

    return wrap(schema);
  }
}

class AnySchema extends ValidationMethodBuilder {
  override call() {
    const schema = this.baseOptions(this.args[0]);

    schema.kind = "any";

    return wrap(schema);
  }
}

class EnumSchema extends ValidationMethodBuilder {
  override call() {
    const [values, options] = this.args;

    this.assertArray(values, "values");

    if (values.length === 0) {
      throw this.throwErrorFormatters(
        new Error("enum needs at least one allowed value"),
      );
    }

    const schema = this.baseOptions(options);

    schema.kind = "enum";
    schema.values = values;

    return wrap(schema);
  }
}

class ArraySchema extends ValidationMethodBuilder {
  override call() {
    const [items, options] = this.args;
    const schema = this.baseOptions(options);

    schema.kind = "array";

    if (items !== undefined && items !== null) {
      schema.items = this.asSchema(items, "items");
    }

    return wrap(schema);
  }
}

class ObjectSchema extends ValidationMethodBuilder {
  override call() {
    const [fields, options] = this.args;

    this.assertObject(fields, "fields");

    const schema = this.baseOptions(options);

    schema.kind = "object";
    schema.fields = {};
    schema.strict = (options ?? {}).strict === true;

    for (const key of Object.keys(fields)) {
      schema.fields[key] = this.asSchema(fields[key], `fields.${key}`);
    }

    return wrap(schema);
  }
}

class CustomSchema extends ValidationMethodBuilder {
  override call() {
    const [predicate, options] = this.args;

    this.assertFunction(predicate, "predicate");

    const schema = this.baseOptions(options);

    schema.kind = "custom";
    schema.predicate = predicate;

    return wrap(schema);
  }
}

// ------------------------------------------------------------------ checking

/** `validation.check(schema, value)` - `{ valid, value, errors }`, never throws. */
class Check extends ValidationMethodBuilder {
  override *call(): Gen<any> {
    const [schemaValue, value] = this.args;

    const schema = this.asSchema(schemaValue);
    const failures: Failure[] = [];

    const checked = yield validate(this, schema, value, "", failures);

    return {
      valid: failures.length === 0,
      value: failures.length === 0 ? checked : null,
      errors: failures.map((failure) => ({
        path: failure.path,
        message: failure.message,
        text: failure.path
          ? `${failure.path} ${failure.message}`
          : `value ${failure.message}`,
      })),
    };
  }
}

/** `validation.parse(schema, value)` - the validated value, or a thrown error. */
class Parse extends ValidationMethodBuilder {
  override *call(): Gen<any> {
    const [schemaValue, value] = this.args;

    const schema = this.asSchema(schemaValue);
    const failures: Failure[] = [];

    const checked = yield validate(this, schema, value, "", failures);

    if (failures.length > 0) {
      const text = failures
        .map((failure) =>
          failure.path
            ? `${failure.path} ${failure.message}`
            : `value ${failure.message}`,
        )
        .join("; ");

      throw this.throwErrorFormatters(new Error(`validation failed: ${text}`));
    }

    return checked;
  }
}

/** `validation.isValid(schema, value)` - just the verdict. */
class IsValid extends ValidationMethodBuilder {
  override *call(): Gen<any> {
    const [schemaValue, value] = this.args;

    const schema = this.asSchema(schemaValue);
    const failures: Failure[] = [];

    yield validate(this, schema, value, "", failures);

    return failures.length === 0;
  }
}

/** `validation.isSchema(value)` - was this produced by this library? */
class IsSchema extends ValidationMethodBuilder {
  override call() {
    return unwrap(this.args[0]) !== null;
  }
}

module.exports = {
  string: StringSchema,
  number: NumberSchema,
  integer: IntegerSchema,
  boolean: BooleanSchema,
  any: AnySchema,
  enumOf: EnumSchema,
  array: ArraySchema,
  object: ObjectSchema,
  custom: CustomSchema,
  check: Check,
  parse: Parse,
  isValid: IsValid,
  isSchema: IsSchema,
};
