/**
 * `iter`: lazy sequences.
 *
 * Like every library in the language, `iter` is a set of functions that take what they
 * work on as their first argument - `iter.take(iter.count(), 3)`, `iter.map(items, fn)` -
 * never methods chained on a value. The only member an iterator has is `next()`.
 *
 * Every iterator this library hands out is built in one place (`makeIterator`) around a
 * single source of steps (a `Pull`). `it.next()`, `for (x in it)` and every function here
 * read from that same source, so mixing them is safe: `next()` followed by `for (x in it)`
 * continues where `next` stopped instead of starting over, and an iterator that is
 * finished stays finished.
 *
 * A step may suspend. A callback given to `map` or `filter` may wait, sleep or use a
 * channel, and a value that implements `symbol.iterator` in the language - an object with
 * `[symbol.iterator]`, or a struct that declares `func [symbol.iterator]()` - is accepted
 * anywhere an iterable is, with its `next` called as the language function it is.
 */

import { FunctionBuilder, FunctionBuilderCodeError } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { isTypeArgs } from "../utils/utils";
import { isSubclassOfByName } from "../../src/utils/isSubclassOfByName";
import { type Gen, lift, runSync } from "../../src/runtime/coroutine";

// Sentinels: `Symbol("x") === Symbol("x")` is always false, so they must be shared.
const NONE = Symbol("none");
const INITIAL = Symbol("initial");

/** Marks an iterator made here, so `Iterator(it)` can hand the same one back. */
const MADE_HERE = Symbol("iter.madeHere");

interface Step {
  value: any;
  done: boolean;
}

/** The single source of steps behind an iterator. */
type Pull = () => Gen<Step>;

const finished = (): Step => ({ value: null, done: true });

const produced = (value: any): Step => ({ value, done: false });

/** A native builder class (`new X(args, astArgs, env).call()`), as opposed to a language function. */
function isBuilder(value: any): boolean {
  return typeof value === "function" && isSubclassOfByName(value, "FunctionBuilder");
}

/** Anything with a callable `next`: one of ours, or a native iterator from another library. */
function hasNativeNext(value: any): boolean {
  return value !== null && typeof value === "object" && isBuilder(value.next);
}

/** Does `value` implement the language's own iterator protocol? */
function hasLanguageIterator(value: any): boolean {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    value[Environment.SymbolIterator] !== undefined &&
    value[Environment.SymbolIterator] !== null
  );
}

abstract class IterMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return {
      name: "iter",
      path: __dirname,
    };
  }

  /** Throws unless `iterable` is something `sourceOf` can walk. */
  protected validateIterable(iterable: any, argName: string = "iterable"): void {
    const type = isTypeArgs(iterable);

    const accepted =
      type === "array" ||
      type === "string" ||
      hasNativeNext(iterable) ||
      hasLanguageIterator(iterable) ||
      // a struct is iterable only through `symbol.iterator`, exactly as in `for ... in`
      (type === "object" && iterable !== null);

    if (!accepted) {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "iterable (array, object, string, or a value with symbol.iterator)",
        received: type,
      });
    }
  }

  protected validateNumber(num: any, argName: string = "number"): void {
    if (isTypeArgs(num) !== "int" && isTypeArgs(num) !== "float") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "number",
        received: isTypeArgs(num),
      });
    }
  }

  protected validateCount(num: any, argName: string): void {
    if (isTypeArgs(num) !== "int" || num < 0) {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "non-negative int",
        received: isTypeArgs(num) === "int" ? "negative" : isTypeArgs(num),
      });
    }
  }

  protected validateFunction(func: any, argName: string = "function"): void {
    if (isTypeArgs(func) !== "function") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "function",
        received: isTypeArgs(func),
      });
    }
  }

  public override *executeCallback(callbackFunc: any, args: any[]): Gen<any> {
    if (this.isBuildModuleFunction(callbackFunc)) {
      return yield lift(new callbackFunc(args, [], this.environment).call());
    }
    return yield lift(callbackFunc.call(args.map((v) => ({ value: v }))));
  }

  /**
   * The steps of any iterable, as a `Pull`. Nothing is read until the first step is
   * asked for, so building an iterator over something endless is free.
   */
  protected sourceOf(source: any, argName: string = "iterable"): Pull {
    this.validateIterable(source, argName);

    const environment = this.environment;

    // one of ours, or another library's native iterator: step it as it is
    if (hasNativeNext(source)) {
      return function* (): Gen<Step> {
        const raw = yield lift(new source.next([], [], environment).call());

        return raw?.done ? finished() : produced(raw?.value);
      };
    }

    // the language's protocol: `[symbol.iterator]` returns an object with `next`
    if (hasLanguageIterator(source)) {
      const factory = source[Environment.SymbolIterator];

      if (isTypeArgs(factory) !== "function") {
        throw this.throwErrorFormatters(
          new Error(`<iter.symbol> expected function. Received ${isTypeArgs(factory)}`),
        );
      }

      let iterator: any = NONE;
      const self = this;

      return function* (): Gen<Step> {
        if (iterator === NONE) {
          iterator = yield lift(
            isBuilder(factory)
              ? new factory([source], [], environment).call()
              : factory.call([{ value: source }], source),
          );

          if (isTypeArgs(iterator?.next) !== "function") {
            throw self.throwErrorFormatters(
              new Error(
                `<iter.symbol> the function must return a <next> function. Received ${isTypeArgs(iterator?.next)}`,
              ),
            );
          }
        }

        const raw = yield lift(
          isBuilder(iterator.next)
            ? new iterator.next([], [], environment).call()
            : iterator.next.call([], source),
        );

        return raw?.done ? finished() : produced(raw?.value);
      };
    }

    const type = isTypeArgs(source);

    if (type === "string" || type === "array") {
      const items: any[] = type === "string" ? Array.from(source as string) : source;
      let index = 0;

      return function* (): Gen<Step> {
        return index < items.length ? produced(items[index++]) : finished();
      };
    }

    // a host collection (`Set`, `Map`) walks the way the host does
    if (typeof source?.[Symbol.iterator] === "function" && type !== "object") {
      const hostIterator = source[Symbol.iterator]();

      return function* (): Gen<Step> {
        const raw = hostIterator.next();

        return raw.done ? finished() : produced(raw.value);
      };
    }

    // a plain object: its entries, `{ key, value }`, in insertion order
    const keys = Object.keys(source);
    let index = 0;

    return function* (): Gen<Step> {
      if (index >= keys.length) return finished();

      const key = keys[index++]!;

      return produced({ key, value: source[key] });
    };
  }

  call() {
    throw new Error("Call is not implemented");
  }
}

/**
 * Build the one iterator shape around `pull`.
 *
 * A finished iterator stays finished: once `pull` has said `done`, it is never asked
 * again, so a source that would start over (or throw) after its end is never reached.
 */
function makeIterator(_environment: Environment, pull: Pull): Record<PropertyKey, any> {
  let ended = false;

  const step: Pull = function* (): Gen<Step> {
    if (ended) return finished();

    const result: Step = yield pull();

    if (result.done) {
      ended = true;
      return finished();
    }

    return result;
  };

  class NextMethod extends IterMethodBuilder {
    override *call(): Gen<any> {
      return yield step();
    }
  }

  return {
    [MADE_HERE]: true,
    next: NextMethod,

    // `for (x in it)`: driven through the same steps, so it may suspend between them
    *[Environment.SymbolCoIterator](visit: (value: any) => Gen<boolean | void>): Gen<void> {
      for (;;) {
        const current: Step = yield step();

        if (current.done) return;

        if ((yield visit(current.value)) === false) return;
      }
    },

    // for host code that iterates synchronously; a step that would suspend is refused
    // with a clear error by `runSync` rather than returned half-done
    *[Symbol.iterator]() {
      for (;;) {
        const current: Step = runSync(step());

        if (current.done) return;

        yield current.value;
      }
    },

    [Environment.SymbolFormatedText]: "Iterator {}",
  };
}

class Iterator extends IterMethodBuilder {
  override call() {
    const [collection] = this.args;

    // an iterator made here is handed back as it is, so iterators compose and share state
    if (collection?.[MADE_HERE]) return collection;

    return makeIterator(this.environment, this.sourceOf(collection, "collection"));
  }
}

class Range extends IterMethodBuilder {
  override call() {
    const [start, stop, step] = this.args;

    let actualStart: number, actualStop: number, actualStep: number;

    if (stop === undefined) {
      actualStart = 0;
      actualStop = start;
      actualStep = 1;
    } else {
      actualStart = start;
      actualStop = stop;
      actualStep = step !== undefined ? step : 1;
    }

    this.validateNumber(actualStart, "start");
    this.validateNumber(actualStop, "stop");
    this.validateNumber(actualStep, "step");

    if (actualStep === 0) {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: "step",
        expectType: "non-zero number",
        received: "zero",
      });
    }

    let current = actualStart;

    return makeIterator(this.environment, function* (): Gen<Step> {
      if ((actualStep > 0 && current < actualStop) || (actualStep < 0 && current > actualStop)) {
        const value = current;
        current += actualStep;
        return produced(value);
      }

      return finished();
    });
  }
}

class Enumerate extends IterMethodBuilder {
  override call() {
    const [iterable, start = 0] = this.args;
    const source = this.sourceOf(iterable);

    this.validateNumber(start, "start");

    let index = start;

    return makeIterator(this.environment, function* (): Gen<Step> {
      const current: Step = yield source();

      if (current.done) return current;

      return produced({ index: index++, value: current.value });
    });
  }
}

/** The sources of every argument, for the functions that take several iterables. */
function sourcesOf(builder: IterMethodBuilder, iterables: any[]): Pull[] {
  if (iterables.length === 0) {
    throw builder.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
      propsName: "arguments",
      expectType: "at least 1",
      received: "0",
    });
  }

  return iterables.map((iterable, index) =>
    (builder as any).sourceOf(iterable, `iterable${index}`),
  );
}

class Zip extends IterMethodBuilder {
  override call() {
    const sources = sourcesOf(this, this.args);

    return makeIterator(this.environment, function* (): Gen<Step> {
      const values: any[] = [];

      for (const source of sources) {
        const current: Step = yield source();

        if (current.done) return finished();

        values.push(current.value);
      }

      return produced(values);
    });
  }
}

class ZipLongest extends IterMethodBuilder {
  override call() {
    // the last argument is the fill value
    const fillValue = this.args[this.args.length - 1];
    const sources = sourcesOf(this, this.args.slice(0, -1));
    const ended = sources.map(() => false);

    return makeIterator(this.environment, function* (): Gen<Step> {
      const values: any[] = [];
      let any = false;

      for (let i = 0; i < sources.length; i++) {
        if (ended[i]) {
          values.push(fillValue);
          continue;
        }

        const current: Step = yield sources[i]!();

        if (current.done) {
          ended[i] = true;
          values.push(fillValue);
        } else {
          any = true;
          values.push(current.value);
        }
      }

      return any ? produced(values) : finished();
    });
  }
}

class Chain extends IterMethodBuilder {
  override call() {
    const sources = sourcesOf(this, this.args);
    let index = 0;

    return makeIterator(this.environment, function* (): Gen<Step> {
      while (index < sources.length) {
        const current: Step = yield sources[index]!();

        if (!current.done) return current;

        index++;
      }

      return finished();
    });
  }
}

class Count extends IterMethodBuilder {
  override call() {
    const [start = 0, step = 1] = this.args;

    this.validateNumber(start, "start");
    this.validateNumber(step, "step");

    let current = start;

    return makeIterator(this.environment, function* (): Gen<Step> {
      const value = current;
      current += step;
      return produced(value);
    });
  }
}

class Cycle extends IterMethodBuilder {
  override call() {
    const [iterable] = this.args;
    const source = this.sourceOf(iterable);

    // the first pass is read from the source and remembered; later passes replay it
    const saved: any[] = [];
    let replaying = false;
    let index = 0;

    return makeIterator(this.environment, function* (): Gen<Step> {
      if (!replaying) {
        const current: Step = yield source();

        if (!current.done) {
          saved.push(current.value);
          return current;
        }

        if (saved.length === 0) return finished();

        replaying = true;
      }

      const value = saved[index];
      index = (index + 1) % saved.length;

      return produced(value);
    });
  }
}

class Repeat extends IterMethodBuilder {
  override call() {
    const [value, times] = this.args;

    if (times !== undefined) {
      this.validateNumber(times, "times");

      if (times < 0) {
        throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
          propsName: "times",
          expectType: "non-negative number",
          received: "negative",
        });
      }
    }

    const maxTimes = times !== undefined ? times : Infinity;
    let count = 0;

    return makeIterator(this.environment, function* (): Gen<Step> {
      if (count >= maxTimes) return finished();

      count++;

      return produced(value);
    });
  }
}

class TakeWhile extends IterMethodBuilder {
  override call() {
    const [iterable, predicate] = this.args;
    const source = this.sourceOf(iterable);

    this.validateFunction(predicate, "predicate");

    const self = this;

    return makeIterator(this.environment, function* (): Gen<Step> {
      const current: Step = yield source();

      if (current.done) return current;

      return (yield self.executeCallback(predicate, [current.value]))
        ? current
        : finished();
    });
  }
}

class DropWhile extends IterMethodBuilder {
  override call() {
    const [iterable, predicate] = this.args;
    const source = this.sourceOf(iterable);

    this.validateFunction(predicate, "predicate");

    const self = this;
    let dropping = true;

    return makeIterator(this.environment, function* (): Gen<Step> {
      while (dropping) {
        const current: Step = yield source();

        if (current.done) return current;

        if (!(yield self.executeCallback(predicate, [current.value]))) {
          dropping = false;
          return current;
        }
      }

      return yield source();
    });
  }
}

class FilterFalse extends IterMethodBuilder {
  override call() {
    const [iterable, predicate] = this.args;
    const source = this.sourceOf(iterable);

    this.validateFunction(predicate, "predicate");

    const self = this;

    return makeIterator(this.environment, function* (): Gen<Step> {
      for (;;) {
        const current: Step = yield source();

        if (current.done) return current;

        if (!(yield self.executeCallback(predicate, [current.value]))) return current;
      }
    });
  }
}

class Compress extends IterMethodBuilder {
  override call() {
    const [iterable, selectors] = this.args;
    const data = this.sourceOf(iterable, "iterable");
    const flags = this.sourceOf(selectors, "selectors");

    return makeIterator(this.environment, function* (): Gen<Step> {
      for (;;) {
        const value: Step = yield data();
        const flag: Step = yield flags();

        if (value.done || flag.done) return finished();

        if (flag.value) return value;
      }
    });
  }
}

class GroupBy extends IterMethodBuilder {
  override call() {
    const [iterable, keyFunc] = this.args;
    const source = this.sourceOf(iterable);

    if (keyFunc !== undefined && keyFunc !== null) {
      this.validateFunction(keyFunc, "keyFunction");
    }

    const self = this;
    const environment = this.environment;

    // the first value of the next group, read while finishing the current one
    let pendingKey: any = INITIAL;
    let pendingValue: any;
    let exhausted = false;

    const keyOf = function* (value: any): Gen<any> {
      return keyFunc ? yield self.executeCallback(keyFunc, [value]) : value;
    };

    return makeIterator(environment, function* (): Gen<Step> {
      if (exhausted) return finished();

      if (pendingKey === INITIAL) {
        const first: Step = yield source();

        if (first.done) {
          exhausted = true;
          return finished();
        }

        pendingValue = first.value;
        pendingKey = yield keyOf(pendingValue);
      }

      const groupKey = pendingKey;
      const group: any[] = [pendingValue];

      for (;;) {
        const next: Step = yield source();

        if (next.done) {
          exhausted = true;
          break;
        }

        const nextKey = yield keyOf(next.value);

        if (nextKey !== groupKey) {
          pendingKey = nextKey;
          pendingValue = next.value;
          break;
        }

        group.push(next.value);
      }

      return produced({
        key: groupKey,
        group: new Iterator([group], [], environment).call(),
      });
    });
  }
}

class Accumulate extends IterMethodBuilder {
  override call() {
    const [iterable, func, initial] = this.args;
    const source = this.sourceOf(iterable);

    // `nil` stands for "not given" (needed to pass `initial` without a function)
    if (func !== undefined && func !== null) {
      this.validateFunction(func, "function");
    }

    // The default operation is `+`. `executeCallback` calls a language function as
    // `fn.call([{ value }, ...])`, so the default is shaped like one.
    const operation = func || {
      call: (args: { value: any }[]) => args[0]!.value + args[1]!.value,
    };

    const self = this;
    let accumulator: any;
    let first = true;

    return makeIterator(this.environment, function* (): Gen<Step> {
      if (first) {
        first = false;

        const next: Step = yield source();

        if (initial !== undefined) {
          // an empty source with an initial value still yields the initial value
          if (next.done) return produced(initial);

          accumulator = yield self.executeCallback(operation, [initial, next.value]);
          return produced(accumulator);
        }

        if (next.done) return finished();

        accumulator = next.value;
        return produced(accumulator);
      }

      const next: Step = yield source();

      if (next.done) return finished();

      accumulator = yield self.executeCallback(operation, [accumulator, next.value]);

      return produced(accumulator);
    });
  }
}

class Pairwise extends IterMethodBuilder {
  override call() {
    const [iterable] = this.args;
    const source = this.sourceOf(iterable);
    let previous: any = NONE;

    return makeIterator(this.environment, function* (): Gen<Step> {
      if (previous === NONE) {
        const first: Step = yield source();

        if (first.done) return finished();

        previous = first.value;
      }

      const current: Step = yield source();

      if (current.done) return finished();

      const pair = [previous, current.value];
      previous = current.value;

      return produced(pair);
    });
  }
}

class Flatten extends IterMethodBuilder {
  override call() {
    const [iterable, depth = 1] = this.args;
    const source = this.sourceOf(iterable);

    this.validateNumber(depth, "depth");

    if (depth < 0) {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: "depth",
        expectType: "non-negative number",
        received: "negative",
      });
    }

    // a stack of open levels instead of recursion, so depth costs no host stack
    const stack: { pull: Pull; depth: number }[] = [{ pull: source, depth }];
    const self = this;

    return makeIterator(this.environment, function* (): Gen<Step> {
      while (stack.length > 0) {
        const top = stack[stack.length - 1]!;
        const current: Step = yield top.pull();

        if (current.done) {
          stack.pop();
          continue;
        }

        const type = isTypeArgs(current.value);

        // a one-character string is its own only element: opening it would never end
        const opens =
          top.depth > 0 &&
          (type === "array" || (type === "string" && current.value.length !== 1));

        if (opens) {
          stack.push({ pull: (self as any).sourceOf(current.value), depth: top.depth - 1 });
          continue;
        }

        return current;
      }

      return finished();
    });
  }
}

/** `iter.map(items, fn)`: each value through `fn`, lazily. */
class MapIter extends IterMethodBuilder {
  override call() {
    const [iterable, fn] = this.args;
    const source = this.sourceOf(iterable);

    this.validateFunction(fn, "function");

    const self = this;

    return makeIterator(this.environment, function* (): Gen<Step> {
      const current: Step = yield source();

      if (current.done) return current;

      return produced(yield self.executeCallback(fn, [current.value]));
    });
  }
}

/** `iter.filter(items, fn)`: only the values `fn` accepts, lazily. */
class FilterIter extends IterMethodBuilder {
  override call() {
    const [iterable, fn] = this.args;
    const source = this.sourceOf(iterable);

    this.validateFunction(fn, "predicate");

    const self = this;

    return makeIterator(this.environment, function* (): Gen<Step> {
      for (;;) {
        const current: Step = yield source();

        if (current.done) return current;

        if (yield self.executeCallback(fn, [current.value])) return current;
      }
    });
  }
}

/** `iter.take(items, n)`: the first `n` values. Stops asking once it has them, so `count()` can feed it. */
class Take extends IterMethodBuilder {
  override call() {
    const [iterable, count] = this.args;
    const source = this.sourceOf(iterable);

    this.validateCount(count, "count");

    let taken = 0;

    return makeIterator(this.environment, function* (): Gen<Step> {
      if (taken >= count) return finished();

      taken++;

      return yield source();
    });
  }
}

/** `iter.skip(items, n)`: everything after the first `n` values. */
class Skip extends IterMethodBuilder {
  override call() {
    const [iterable, count] = this.args;
    const source = this.sourceOf(iterable);

    this.validateCount(count, "count");

    let skipped = false;

    return makeIterator(this.environment, function* (): Gen<Step> {
      if (!skipped) {
        skipped = true;

        for (let i = 0; i < count; i++) {
          const dropped: Step = yield source();

          if (dropped.done) return dropped;
        }
      }

      return yield source();
    });
  }
}

/** `iter.toArray(items)`: every value, in an array. Never give it something endless. */
class ToArray extends IterMethodBuilder {
  override *call(): Gen<any> {
    const [iterable] = this.args;
    const source = this.sourceOf(iterable);
    const out: any[] = [];

    for (;;) {
      const current: Step = yield source();

      if (current.done) return out;

      out.push(current.value);
    }
  }
}

/** `iter.forEach(items, fn)`: call `fn` with every value, in order; `fn` may suspend. */
class ForEach extends IterMethodBuilder {
  override *call(): Gen<any> {
    const [iterable, fn] = this.args;
    const source = this.sourceOf(iterable);

    this.validateFunction(fn, "function");

    for (;;) {
      const current: Step = yield source();

      if (current.done) return null;

      yield this.executeCallback(fn, [current.value]);
    }
  }
}

module.exports = {
  Iterator,
  range: Range,
  enumerate: Enumerate,
  zip: Zip,
  zipLongest: ZipLongest,
  chain: Chain,
  count: Count,
  cycle: Cycle,
  repeat: Repeat,
  takeWhile: TakeWhile,
  dropWhile: DropWhile,
  filterFalse: FilterFalse,
  compress: Compress,
  groupBy: GroupBy,
  accumulate: Accumulate,
  pairwise: Pairwise,
  flatten: Flatten,
  map: MapIter,
  filter: FilterIter,
  take: Take,
  skip: Skip,
  toArray: ToArray,
  forEach: ForEach,
  symbol: Environment.SymbolIterator,
};
