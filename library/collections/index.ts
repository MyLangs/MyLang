import { FunctionBuilder, FunctionBuilderCodeError } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { isTypeArgs } from "../utils/utils";
import { lift, type Gen } from "../../src/runtime/coroutine";

// Every collection object keeps its host Set / Map under this symbol (invisible to
// interpreted code), so that methods taking another collection can reach it.
const HANDLE = Symbol("CollectionHandle");

abstract class CollectionsMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return {
      name: "collections",
      path: __dirname,
    };
  }

  protected validateSet(set: any, argName?: string): void {
    if (!(set?.[HANDLE] instanceof globalThis.Set)) {
      throw this.throwErrorFormatters(
        argName
          ? FunctionBuilderCodeError.ArgumentsTypeError
          : FunctionBuilderCodeError.ArgumentsFirstTypeError,
        {
          ...(argName ? { propsName: argName } : {}),
          expectType: "set",
          received: isTypeArgs(set),
        },
      );
    }
  }

  protected validateMap(map: any, argName?: string): void {
    if (!(map?.[HANDLE] instanceof globalThis.Map)) {
      throw this.throwErrorFormatters(
        argName
          ? FunctionBuilderCodeError.ArgumentsTypeError
          : FunctionBuilderCodeError.ArgumentsFirstTypeError,
        {
          ...(argName ? { propsName: argName } : {}),
          expectType: "map",
          received: isTypeArgs(map),
        },
      );
    }
  }

  /** The constructors take any iterable (array, string, another collection) or nothing. */
  protected validateIterable(value: any): void {
    const iterable =
      value === undefined ||
      value === null ||
      typeof value === "string" ||
      (typeof value === "object" && typeof value[Symbol.iterator] === "function");

    if (!iterable) {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsFirstTypeError, {
        expectType: "iterable",
        received: isTypeArgs(value),
      });
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

class Set extends CollectionsMethodBuilder {
  override call() {
    const [iterable] = this.args;
    this.validateIterable(iterable);
    const set = new globalThis.Set(iterable);

    const self: any = {
      [HANDLE]: set,

      add: class extends CollectionsMethodBuilder {
        override call() {
          const [value] = this.args;
          set.add(value);
          return self;
        }
      },

      has: class extends CollectionsMethodBuilder {
        override call() {
          const [value] = this.args;
          return set.has(value);
        }
      },

      delete: class extends CollectionsMethodBuilder {
        override call() {
          const [value] = this.args;
          return set.delete(value);
        }
      },

      clear: class extends CollectionsMethodBuilder {
        override call() {
          set.clear();
          return null;
        }
      },

      size: class extends CollectionsMethodBuilder {
        override call() {
          return set.size;
        }
      },

      values: class extends CollectionsMethodBuilder {
        override call() {
          return Array.from(set.values());
        }
      },

      forEach: class extends CollectionsMethodBuilder {
        override *call(): Gen<any> {
          const [callback] = this.args;
          this.validateFunction(callback);

          for (const value of set) {
            yield lift(this.executeCallback(callback, [value, value, set]));
          }
          return null;
        }
      },

      union: class extends CollectionsMethodBuilder {
        override call() {
          const [other] = this.args;
          this.validateSet(other);
          const otherSet: globalThis.Set<any> = other[HANDLE];

          const result = new globalThis.Set(set);
          for (const item of otherSet) {
            result.add(item);
          }
          return new Set([result], [], this.environment).call();
        }
      },

      intersection: class extends CollectionsMethodBuilder {
        override call() {
          const [other] = this.args;
          this.validateSet(other);
          const otherSet: globalThis.Set<any> = other[HANDLE];

          const result = new globalThis.Set();
          for (const item of set) {
            if (otherSet.has(item)) {
              result.add(item);
            }
          }
          return new Set([result], [], this.environment).call();
        }
      },

      difference: class extends CollectionsMethodBuilder {
        override call() {
          const [other] = this.args;
          this.validateSet(other);
          const otherSet: globalThis.Set<any> = other[HANDLE];

          const result = new globalThis.Set();
          for (const item of set) {
            if (!otherSet.has(item)) {
              result.add(item);
            }
          }
          return new Set([result], [], this.environment).call();
        }
      },

      symmetricDifference: class extends CollectionsMethodBuilder {
        override call() {
          const [other] = this.args;
          this.validateSet(other);
          const otherSet: globalThis.Set<any> = other[HANDLE];

          const result = new globalThis.Set();
          for (const item of set) {
            if (!otherSet.has(item)) {
              result.add(item);
            }
          }
          for (const item of otherSet) {
            if (!set.has(item)) {
              result.add(item);
            }
          }
          return new Set([result], [], this.environment).call();
        }
      },

      isSubset: class extends CollectionsMethodBuilder {
        override call() {
          const [other] = this.args;
          this.validateSet(other);
          const otherSet: globalThis.Set<any> = other[HANDLE];

          for (const item of set) {
            if (!otherSet.has(item)) {
              return false;
            }
          }
          return true;
        }
      },

      isSuperset: class extends CollectionsMethodBuilder {
        override call() {
          const [other] = this.args;
          this.validateSet(other);
          const otherSet: globalThis.Set<any> = other[HANDLE];

          for (const item of otherSet) {
            if (!set.has(item)) {
              return false;
            }
          }
          return true;
        }
      },

      isDisjoint: class extends CollectionsMethodBuilder {
        override call() {
          const [other] = this.args;
          this.validateSet(other);
          const otherSet: globalThis.Set<any> = other[HANDLE];

          for (const item of set) {
            if (otherSet.has(item)) {
              return false;
            }
          }
          return true;
        }
      },

      copy: class extends CollectionsMethodBuilder {
        override call() {
          return new Set([new globalThis.Set(set)], [], this.environment).call();
        }
      },

      *[Symbol.iterator]() {
        for (const value of set.values()) {
          yield value;
        }
      },

      [Environment.SymbolFormatedText]: `Set(${set.size}) { ${JSON.stringify([...set], null, set.size > 8 ? 2 : 0)} }`,
    };

    return self;
  }
}

class Map extends CollectionsMethodBuilder {
  override call() {
    const [iterable] = this.args;
    this.validateIterable(iterable);
    const map = new globalThis.Map(iterable);

    const self: any = {
      [HANDLE]: map,

      set: class extends CollectionsMethodBuilder {
        override call() {
          const [key, value] = this.args;
          map.set(key, value);
          return self;
        }
      },

      get: class extends CollectionsMethodBuilder {
        override call() {
          const [key] = this.args;
          return map.get(key);
        }
      },

      has: class extends CollectionsMethodBuilder {
        override call() {
          const [key] = this.args;
          return map.has(key);
        }
      },

      delete: class extends CollectionsMethodBuilder {
        override call() {
          const [key] = this.args;
          return map.delete(key);
        }
      },

      clear: class extends CollectionsMethodBuilder {
        override call() {
          map.clear();
          return null;
        }
      },

      size: class extends CollectionsMethodBuilder {
        override call() {
          return map.size;
        }
      },

      keys: class extends CollectionsMethodBuilder {
        override call() {
          return Array.from(map.keys());
        }
      },

      values: class extends CollectionsMethodBuilder {
        override call() {
          return Array.from(map.values());
        }
      },

      entries: class extends CollectionsMethodBuilder {
        override call() {
          return Array.from(map.entries());
        }
      },

      forEach: class extends CollectionsMethodBuilder {
        override *call(): Gen<any> {
          const [callback] = this.args;
          this.validateFunction(callback);

          for (const [key, value] of map) {
            yield lift(this.executeCallback(callback, [value, key, map]));
          }
          return null;
        }
      },

      copy: class extends CollectionsMethodBuilder {
        override call() {
          return new Map([new globalThis.Map(map)], [], this.environment).call();
        }
      },

      merge: class extends CollectionsMethodBuilder {
        override call() {
          const [other] = this.args;
          this.validateMap(other);

          const result = new globalThis.Map(map);
          for (const [key, value] of other[HANDLE] as globalThis.Map<any, any>) {
            result.set(key, value);
          }
          return new Map([result], [], this.environment).call();
        }
      },

      *[Symbol.iterator]() {
        for (const [key, value] of map.entries()) {
          yield [key, value];
        }
      },

      [Environment.SymbolFormatedText]: `Map(${map.size}) { ${JSON.stringify([...map], null, map.size > 8 ? 2 : 0)} }`,
    };

    return self;
  }
}

class Counter extends CollectionsMethodBuilder {
  override call() {
    const [iterable] = this.args;
    this.validateIterable(iterable);
    const counter = new globalThis.Map();

    if (iterable) {
      for (const item of iterable) {
        counter.set(item, (counter.get(item) || 0) + 1);
      }
    }

    const self: any = {
      [HANDLE]: counter,

      update: class extends CollectionsMethodBuilder {
        override call() {
          const [items] = this.args;

          if (items) {
            for (const item of items) {
              counter.set(item, (counter.get(item) || 0) + 1);
            }
          }
          return null;
        }
      },

      mostCommon: class extends CollectionsMethodBuilder {
        override call() {
          const [n] = this.args;

          const entries = Array.from(counter.entries());
          entries.sort((a, b) => b[1] - a[1]);

          return n ? entries.slice(0, n) : entries;
        }
      },

      subtract: class extends CollectionsMethodBuilder {
        override call() {
          const [items] = this.args;

          if (items) {
            for (const item of items) {
              const current = counter.get(item) || 0;
              if (current > 0) {
                counter.set(item, current - 1);
                if (counter.get(item) === 0) {
                  counter.delete(item);
                }
              }
            }
          }
          return null;
        }
      },

      elements: class extends CollectionsMethodBuilder {
        override call() {
          const result = [];
          for (const [item, count] of counter) {
            for (let i = 0; i < count; i++) {
              result.push(item);
            }
          }
          return result;
        }
      },

      total: class extends CollectionsMethodBuilder {
        override call() {
          let sum = 0;
          for (const count of counter.values()) {
            sum += count;
          }
          return sum;
        }
      },

      get: class extends CollectionsMethodBuilder {
        override call() {
          const [key] = this.args;
          return counter.get(key) || 0;
        }
      },

      set: class extends CollectionsMethodBuilder {
        override call() {
          const [key, value] = this.args;
          counter.set(key, value);
          return self;
        }
      },

      keys: class extends CollectionsMethodBuilder {
        override call() {
          return Array.from(counter.keys());
        }
      },

      values: class extends CollectionsMethodBuilder {
        override call() {
          return Array.from(counter.values());
        }
      },

      *[Symbol.iterator]() {
        for (const [key, value] of counter.entries()) {
          yield [key, value];
        }
      },

      [Environment.SymbolFormatedText]: `Counter { ${counter.size} }`,
    };

    return self;
  }
}

class DefaultDict extends CollectionsMethodBuilder {
  override call() {
    const [defaultFactory] = this.args;
    const dict = new globalThis.Map();

    const self: any = {
      [HANDLE]: dict,

      get: class extends CollectionsMethodBuilder {
        override *call(): Gen<any> {
          const [key] = this.args;

          if (!dict.has(key)) {
            if (defaultFactory) {
              const defaultValue = yield this.executeCallback(defaultFactory, []);
              dict.set(key, defaultValue);
              return defaultValue;
            }
            return null;
          }
          return dict.get(key);
        }
      },

      set: class extends CollectionsMethodBuilder {
        override call() {
          const [key, value] = this.args;
          dict.set(key, value);
          return self;
        }
      },

      has: class extends CollectionsMethodBuilder {
        override call() {
          const [key] = this.args;
          return dict.has(key);
        }
      },

      delete: class extends CollectionsMethodBuilder {
        override call() {
          const [key] = this.args;
          return dict.delete(key);
        }
      },

      keys: class extends CollectionsMethodBuilder {
        override call() {
          return Array.from(dict.keys());
        }
      },

      values: class extends CollectionsMethodBuilder {
        override call() {
          return Array.from(dict.values());
        }
      },

      entries: class extends CollectionsMethodBuilder {
        override call() {
          return Array.from(dict.entries());
        }
      },

      *[Symbol.iterator]() {
        for (const [key, value] of dict.entries()) {
          yield [key, value];
        }
      },

      [Environment.SymbolFormatedText]: `DefaultDict { ${dict.size} }`,
    };

    return self;
  }
}

class OrderedDict extends CollectionsMethodBuilder {
  override call() {
    const [iterable] = this.args;
    this.validateIterable(iterable);
    const dict = new globalThis.Map(iterable);

    const self: any = {
      [HANDLE]: dict,

      set: class extends CollectionsMethodBuilder {
        override call() {
          const [key, value] = this.args;
          dict.set(key, value);
          return self;
        }
      },

      get: class extends CollectionsMethodBuilder {
        override call() {
          const [key] = this.args;
          return dict.get(key);
        }
      },

      popitem: class extends CollectionsMethodBuilder {
        override call() {
          const [last = true] = this.args;

          if (dict.size === 0) {
            throw this.throwErrorFormatters(new Error("popitem(): dictionary is empty"));
          }

          const entries = Array.from(dict.entries());
          const item = last ? entries[entries.length - 1] : entries[0];
          dict.delete(item![0]);

          return item;
        }
      },

      moveToEnd: class extends CollectionsMethodBuilder {
        override call() {
          const [key, last = true] = this.args;

          if (!dict.has(key)) {
            throw this.throwErrorFormatters(new Error(`Key '${key}' not found`));
          }

          const value = dict.get(key);
          dict.delete(key);

          if (last) {
            dict.set(key, value);
          } else {
            const entries = Array.from(dict.entries());
            dict.clear();
            dict.set(key, value);
            for (const [k, v] of entries) {
              dict.set(k, v);
            }
          }
          return null;
        }
      },

      keys: class extends CollectionsMethodBuilder {
        override call() {
          return Array.from(dict.keys());
        }
      },

      values: class extends CollectionsMethodBuilder {
        override call() {
          return Array.from(dict.values());
        }
      },

      entries: class extends CollectionsMethodBuilder {
        override call() {
          return Array.from(dict.entries());
        }
      },

      *[Symbol.iterator]() {
        for (const [key, value] of dict.entries()) {
          yield [key, value];
        }
      },

      [Environment.SymbolFormatedText]: `OrderedDict { ${dict.size} }`,
    };

    return self;
  }
}

module.exports = {
  Set,
  Map,
  Counter,
  DefaultDict,
  OrderedDict,
};
