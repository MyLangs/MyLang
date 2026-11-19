/**
 * Creating a struct instance.
 *
 * `StructDeclaration` (`struct Name { ... }`) and `StructExpression` (`struct { ... }`)
 * describe exactly the same thing and differ only in how they are bound to a name, so the
 * instantiation lives here once instead of being copied into both.
 *
 * What an instance ends up carrying:
 *
 *   - the public fields and methods, as plain members;
 *   - the private fields and methods, plus `symbol` bookkeeping that makes them invisible
 *     from outside the struct (see `runtime/structMembers`);
 *   - never the static members - those stay on the type.
 *
 * Statics are initialised once, when the `struct` declaration itself is evaluated, so every
 * instance and every `TypeName.member` access shares the same value.
 */

import { Environment, type IOptionsVar } from "../../Environment";
import { type VariableDeclaration } from "../declaration/VariableDeclaration";
import { type FunctionDeclaration } from "../declaration/FunctionDeclaration";
import { type Gen } from "../../runtime/coroutine";
import { BaseError } from "../../errors/BaseError";
import {
  noModifiers,
  staticsOf,
  isLanguageSymbol,
  languageSymbolName,
  LANGUAGE_SYMBOL_NAMES,
  type MemberModifiers,
  type StructModifiers,
  type StructSymbolMethod,
} from "../../runtime/structMembers";

/** The shape both struct nodes expose to this module. */
interface StructShape {
  name: string | null;
  fields: VariableDeclaration[];
  methods: FunctionDeclaration[];
  modifiers: StructModifiers;
  symbolMethods?: StructSymbolMethod[];
  parentEnv: Environment;
  statics?: Record<string, any>;
}

/**
 * Evaluate the symbol members of a struct, in declaration order, and return the
 * `[symbol, function]` pairs to put on the instance.
 *
 * The bracketed expression is evaluated in the instance's own scope, so it can be any
 * expression that reaches a protocol symbol. Anything else is refused here rather than
 * silently becoming a hidden member: a struct is a shape other code reads with
 * `for ... in`, `objects.keys` and `json`, none of which can see a symbol.
 */
function* evaluateSymbolMembers(
  struct: StructShape,
  scope: Environment,
): Gen<[symbol, any][]> {
  const members: [symbol, any][] = [];

  for (const { key, method } of struct.symbolMethods ?? []) {
    const evaluatedKey = yield key.evaluate(scope);

    if (!isLanguageSymbol(evaluatedKey)) {
      const allowed = [...LANGUAGE_SYMBOL_NAMES.values()].join(" or ");

      throw new BaseError(
        `A struct member named in brackets must be ${allowed}, ` +
          `but '${method.name}' is not` +
          (struct.name ? ` (struct '${struct.name}')` : ""),
        { files: [] },
      );
    }

    if (members.some(([taken]) => taken === evaluatedKey)) {
      throw new BaseError(
        `Duplicate '${languageSymbolName(evaluatedKey)}' member` +
          (struct.name ? ` in struct '${struct.name}'` : ""),
        { files: [] },
      );
    }

    const evaluated = yield method.evaluate(scope);

    // the disposer reaches the private members of its own struct, like any method
    evaluated.ownerStruct = struct;

    members.push([evaluatedKey, evaluated]);
  }

  return members;
}

function modifiersOf(struct: StructShape, name: string): MemberModifiers {
  return struct.modifiers?.[name] ?? noModifiers();
}

/**
 * Evaluate the `static` members of a type. Called once per `struct` declaration, not per
 * instance: a static field keeps its value across every instance that is created later.
 */
function* initialiseStatics(struct: StructShape): Gen<void> {
  const statics = staticsOf(struct);
  const scope = new Environment(struct.parentEnv);

  for (const field of struct.fields) {
    if (!modifiersOf(struct, field.name).static) continue;

    statics[field.name] = yield field.value.evaluate(scope);
  }

  for (const method of struct.methods) {
    if (!modifiersOf(struct, method.name).static) continue;

    const evaluated = yield method.evaluate(scope);

    // a static method sees the type, never an instance
    evaluated.ownerStruct = struct;
    statics[method.name] = evaluated;
  }
}

/**
 * Build an instance of `struct` from `args`.
 *
 * With an `init` method the arguments go to `init` and the fields start as `nil`;
 * without one they are positional, falling back to each field's default expression.
 */
function* instantiate(struct: StructShape, args: any[]): Gen<any> {
  const fieldsData: Record<string, IOptionsVar | null> = {};
  const privateNames = new Set<string>();
  const callEnvironment = new Environment(struct.parentEnv);

  /**
   * The instance, built once and filled in place.
   *
   * Each field and each method used to be added by replacing `this` with a fresh object
   * spread from the old one, which meant the instance changed identity several times
   * while it was being built. Anything that captured `this` on the way - `var self = this`
   * in `init`, a closure stored on the instance, `this.captured = this` - ended up holding
   * one of the discarded copies: it compared unequal to the value the caller got, it was
   * missing every method added after it, and a write through it went nowhere. Filling one
   * object keeps `this` the same value from the first line of `init` onwards.
   */
  const instance: Record<PropertyKey, any> = {
    [Environment.SymbolStruct]: true,
    [Environment.SymbolStructType]: struct,
    [Environment.SymbolStructPrivate]: privateNames,
  };

  callEnvironment.create("this", instance);

  // statics stay on the type; instance members are everything else
  const instanceFields = struct.fields.filter(
    (field) => !modifiersOf(struct, field.name).static,
  );
  const instanceMethods = struct.methods.filter(
    (method) => !modifiersOf(struct, method.name).static,
  );

  const initStructMethod = instanceMethods.find(({ name }) => name === "init");

  // never mutate the declaration: `init` must survive for the next instance
  let methods = instanceMethods;

  const declareField = (
    name: string,
    value: any,
    options: IOptionsVar | null,
  ) => {
    fieldsData[name] = options;

    if (modifiersOf(struct, name).private) privateNames.add(name);

    instance[name] = value;
  };

  if (initStructMethod) {
    methods = instanceMethods.filter(({ name }) => name !== "init");

    for (const field of instanceFields) {
      declareField(field.name, null, field.options);
    }

    const initFunction = yield initStructMethod.evaluate(callEnvironment);

    initFunction.ownerStruct = struct;

    yield initFunction.call(args.map((arg) => ({ value: arg })));
  } else {
    for (let i = 0; i < instanceFields.length; i++) {
      const field = instanceFields[i]!;

      declareField(
        field.name,
        i in args ? args[i] : yield field.value.evaluate(callEnvironment),
        field.options,
      );
    }
  }

  for (const method of methods) {
    const evaluated = yield method.evaluate(callEnvironment);

    // lets the method reach the private members of its own struct
    evaluated.ownerStruct = struct;

    if (modifiersOf(struct, method.name).private) {
      privateNames.add(method.name);
    }

    instance[method.name] = evaluated;

    method.parentEnv.ensure("this", instance);
  }

  // after the named methods: a disposer may call them, and `this` is read at call time
  const symbolMembers = yield evaluateSymbolMembers(struct, callEnvironment);

  instance[Environment.SymbolStructData] = fieldsData;

  // enumerable, because a spread of the instance has to carry the protocol member along
  for (const [key, member] of symbolMembers) {
    Object.defineProperty(instance, key, {
      value: member,
      enumerable: true,
      configurable: true,
      writable: false,
    });
  }

  return instance;
}

export { instantiate, initialiseStatics, modifiersOf, type StructShape };
