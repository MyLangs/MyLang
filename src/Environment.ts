import { BaseError } from "./errors/BaseError";

interface IOptionsVar {
  constant: boolean;
  readonly?: boolean;
  lazy?: boolean;
}

class Environment {
  private parent?: Environment;
  protected values: Record<string, any> = {};
  public optionsVar: Record<string, IOptionsVar> = {};
  public deferenceCall: any[] = [];
  static SymbolEnum = Symbol("SymbolEnum");
  static SymbolEnumThis = Symbol("SymbolEnumThis");
  static SymbolBuffer = Symbol("Buffer");
  static SymbolFormatedText = Symbol("FormatedText");
  static SpawnQueueSymbol = Symbol("SpawnQueueSymbol");
  static SymbolEvents = Symbol("Events");
  static SymbolIterator = Symbol("SymbolIterator");
  /** Host-side lazy sequences that must call back into the language: `(visit) => Gen<void>` */
  static SymbolCoIterator = Symbol("SymbolCoIterator");
  static SymbolNotUsedIdentifier = Symbol("NotUsedIdentifier");
  static SymbolCaptureRejections = Symbol("CaptureRejections");
  static SymbolTime = Symbol("Time");
  static SymbolExports = Symbol("SymbolExports");
  static SymbolStruct = Symbol("SymbolStruct");
  static SymbolDeferred = Symbol("SymbolDeferred");
  static SymbolStructData = Symbol("SymbolStructData");
  /** On an instance: the set of member names declared `private`. */
  static SymbolStructPrivate = Symbol("SymbolStructPrivate");
  /** On an instance: the struct type it was created from (identity for access checks). */
  static SymbolStructType = Symbol("SymbolStructType");

  /**
   * Names the interpreter itself defined in the global scope (`process`, `global`, ...).
   * An `import` is allowed to bind over one of these, because asking for a module by name
   * is explicit and should win over a predefined global that happens to share it.
   * Names the program defined are never shadowed this way.
   */
  private interpreterGlobals: Set<string> = new Set();

  constructor(env?: Environment) {
    if (env) {
      this.parent = env;
    }

    this.deferenceCall = [];
  }

  /** Record `keys` as interpreter-defined globals of this scope. */
  markInterpreterGlobals(keys: string[]): void {
    for (const key of keys) this.interpreterGlobals.add(key);
  }

  /**
   * Bind `key`, replacing an interpreter-defined global of the same name instead of
   * failing. Returns `true` when such a global was replaced.
   */
  shadowInterpreterGlobal(
    key: string,
    value: any,
    options?: IOptionsVar,
  ): boolean {
    const owner = this.getEnvironmentWithKey(key);

    if (!owner || !owner.interpreterGlobals.has(key)) return false;

    owner.interpreterGlobals.delete(key);
    owner.values[key] = value;

    if (options) owner.optionsVar[key] = options;

    return true;
  }

  create(key: string, value: any, options?: IOptionsVar): Record<string, any> {
    if (this.values.hasOwnProperty(key)) {
      throw new BaseError(`${key} has been initialized`, {
        files:
          this.values["import"]?.paths ??
          this.parent?.values["import"]?.paths ??
          [],
      });
    }

    if (options) {
      this.optionsVar[key] = options;
    }

    return (this.values[key] = value);
  }

  update(key: string, value: any, options?: IOptionsVar): Record<string, any> {
    const matchedEnvironment = this.getEnvironmentWithKey(key);

    if (!matchedEnvironment) {
      throw new BaseError(`${key} hasn't been defined`, {
        files:
          this.values["import"]?.paths ??
          this.parent?.values["import"]?.paths ??
          [],
      });
    }

    if (options) {
      matchedEnvironment.optionsVar[key] = options;
    }

    // Assign in place. Rebuilding the scope's whole table - `{...values, [key]: value}` -
    // made every assignment cost as much as the scope had variables and allocated a fresh
    // object each time, so a loop that updates one counter rebuilt its scope on every
    // iteration and left the result to the garbage collector. Nothing reads this return
    // value and nothing compares scope tables by identity; `clone` and `combine` copy the
    // table themselves, so a clone taken earlier is unaffected by a later assignment.
    matchedEnvironment.values[key] = value;

    return matchedEnvironment.values;
  }

  get(key: string): any {
    const matchedEnvironment = this.getEnvironmentWithKey(key);

    if (!matchedEnvironment) {
      throw new BaseError(`${key} is not defined`, {
        files:
          this.values["import"]?.paths ??
          this.parent?.values["import"]?.paths ??
          [],
      });
    }

    return matchedEnvironment.values[key];
  }

  ensure(key: string, value: any): void {
    const matchedEnvironment = this.getEnvironmentWithKey(key);

    if (!matchedEnvironment) {
      this.values[key] = value;
    } else {
      matchedEnvironment.values[key] = value;
    }
  }

  has(key: string): boolean {
    if (this.values.hasOwnProperty(key)) {
      return true;
    }
    return false;
  }

  clone(): Environment {
    const newEnv = new Environment();
    newEnv.values = { ...this.values };
    newEnv.optionsVar = { ...this.optionsVar };

    if (this.parent) {
      newEnv.parent = this.parent.clone();
    }

    return newEnv;
  }

  combine(env: Environment): Environment {
    let parent = this.parent
      ? this.parent.combine(env.parent ?? new Environment())
      : env.parent;

    const newEnv = new Environment(parent);

    newEnv.values = { ...this.values, ...env.values };
    newEnv.optionsVar = { ...this.optionsVar, ...env.optionsVar };

    return newEnv;
  }

  /**
   * Options (`const` / `readonly` / `lazy`) of a variable, looked up through the
   * scope chain: they belong to the scope that declared the variable, not to
   * the scope that happens to read or assign it.
   */
  getOptions(key: string): IOptionsVar | undefined {
    return this.getEnvironmentWithKey(key)?.optionsVar[key];
  }

  /**
   * Options that travel with a variable when it is passed as an argument.
   * A lazy variable is already evaluated at that point, so it passes no options.
   */
  getArgumentOptions(key: string): IOptionsVar | undefined {
    const options = this.getOptions(key);

    return options?.lazy ? undefined : options;
  }

  getRootEnv(): Environment {
    let currentEnvironment: Environment = this;

    while (currentEnvironment.parent) {
      currentEnvironment = currentEnvironment.parent;
    }

    return currentEnvironment;
  }

  getEnvironmentWithKey(key: string): Environment | null {
    if (this.values.hasOwnProperty(key)) {
      return this;
    }

    let currentEnvironment = this.parent;

    while (currentEnvironment) {
      if (currentEnvironment.values.hasOwnProperty(key)) {
        return currentEnvironment;
      }
      currentEnvironment = currentEnvironment.parent;
    }

    return null;
  }
}

export { Environment, type IOptionsVar };
