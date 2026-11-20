import { BaseError } from "./errors/BaseError";

interface IOptionsVar {
  constant: boolean;
  readonly?: boolean;
  lazy?: boolean;
}

class Environment {
  private parent?: Environment;
  protected values: Map<string, any> = new Map();
  public optionsVar: Map<string, IOptionsVar> = new Map();
  public deferenceCall: any[] = [];
  static SymbolEnum = Symbol("SymbolEnum");
  static SymbolEnumThis = Symbol("SymbolEnumThis");
  static SymbolBuffer = Symbol("Buffer");
  static SymbolFormatedText = Symbol("FormatedText");
  static SpawnQueueSymbol = Symbol("SpawnQueueSymbol");
  static SymbolEvents = Symbol("Events");
  static SymbolIterator = Symbol("SymbolIterator");
  static SymbolCoIterator = Symbol("SymbolCoIterator");
  static SymbolNotUsedIdentifier = Symbol("NotUsedIdentifier");
  static SymbolCaptureRejections = Symbol("CaptureRejections");
  static SymbolTime = Symbol("Time");
  static SymbolExports = Symbol("SymbolExports");
  static SymbolStruct = Symbol("SymbolStruct");
  static SymbolDeferred = Symbol("SymbolDeferred");
  static SymbolStructData = Symbol("SymbolStructData");
  static SymbolStructPrivate = Symbol("SymbolStructPrivate");
  static SymbolStructType = Symbol("SymbolStructType");

  private interpreterGlobals: Set<string> = new Set();

  constructor(env?: Environment) {
    if (env) {
      this.parent = env;
    }

    this.deferenceCall = [];
  }

  private importPaths(): any[] {
    return (
      this.values.get("import")?.paths ??
      this.parent?.values.get("import")?.paths ??
      []
    );
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
    owner.values.set(key, value);

    if (options) owner.optionsVar.set(key, options);

    return true;
  }

  create(key: string, value: any, options?: IOptionsVar): any {
    if (this.values.has(key)) {
      throw new BaseError(`${key} has been initialized`, {
        files: this.importPaths(),
      });
    }

    if (options) {
      this.optionsVar.set(key, options);
    }

    this.values.set(key, value);

    return value;
  }

  update(key: string, value: any, options?: IOptionsVar): Map<string, any> {
    const matchedEnvironment = this.getEnvironmentWithKey(key);

    if (!matchedEnvironment) {
      throw new BaseError(`${key} hasn't been defined`, {
        files: this.importPaths(),
      });
    }

    if (options) {
      matchedEnvironment.optionsVar.set(key, options);
    }

    // Assign in place: no rebuilding of the scope table on every assignment.
    // `clone` and `combine` copy the table themselves, so a clone taken earlier
    // is unaffected by a later assignment.
    matchedEnvironment.values.set(key, value);

    return matchedEnvironment.values;
  }

  get(key: string): any {
    const matchedEnvironment = this.getEnvironmentWithKey(key);

    if (!matchedEnvironment) {
      throw new BaseError(`${key} is not defined`, {
        files: this.importPaths(),
      });
    }

    return matchedEnvironment.values.get(key);
  }

  ensure(key: string, value: any): void {
    const matchedEnvironment = this.getEnvironmentWithKey(key);

    if (!matchedEnvironment) {
      this.values.set(key, value);
    } else {
      matchedEnvironment.values.set(key, value);
    }
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  clone(): Environment {
    const newEnv = new Environment();
    newEnv.values = new Map(this.values);
    newEnv.optionsVar = new Map(this.optionsVar);

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

    newEnv.values = new Map([...this.values, ...env.values]);
    newEnv.optionsVar = new Map([...this.optionsVar, ...env.optionsVar]);

    return newEnv;
  }

  /**
   * Options (`const` / `readonly` / `lazy`) of a variable, looked up through the
   * scope chain: they belong to the scope that declared the variable, not to
   * the scope that happens to read or assign it.
   */
  getOptions(key: string): IOptionsVar | undefined {
    return this.getEnvironmentWithKey(key)?.optionsVar.get(key);
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
    if (this.values.has(key)) {
      return this;
    }

    let currentEnvironment = this.parent;

    while (currentEnvironment) {
      if (currentEnvironment.values.has(key)) {
        return currentEnvironment;
      }
      currentEnvironment = currentEnvironment.parent;
    }

    return null;
  }
}

export { Environment, type IOptionsVar };
