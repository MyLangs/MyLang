import { FunctionBuilder, FunctionBuilderCodeError } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { isTypeArgs } from "../utils/utils";
import { type Gen, lift } from "../../src/runtime/coroutine";

abstract class ArrayMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return {
      name: "arrays",
      path: __dirname,
    };
  }

  protected validateArray(arr: any, argName: string = "array"): void {
    if (argName && isTypeArgs(arr) !== "array") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "array",
        received: isTypeArgs(arr),
      });
    } else if (isTypeArgs(arr) !== "array") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsFirstTypeError, {
        expectType: "array",
        received: isTypeArgs(arr),
      });
    }
  }

  protected validateFunction(func: any, argName: string = "callback"): void {
    if (isTypeArgs(func) !== "function") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "func",
        received: isTypeArgs(func),
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

class At extends ArrayMethodBuilder {
  override call() {
    const [arr, index] = this.args;
    this.validateArray(arr);
    this.validateNumber(index, "index");

    return [...arr].at(index);
  }
}

class ForEach extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, callbackFunc] = this.args;
    this.validateArray(arr);
    this.validateFunction(callbackFunc, "callbackFunc");

    for (let i = 0; i < arr.length; i++) {
      yield this.executeCallback(callbackFunc, [arr[i], i, arr]);
    }

    return null;
  }
}

class Map extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, callbackFunc] = this.args;
    this.validateArray(arr);
    this.validateFunction(callbackFunc, "callbackFunc");

    const result = [];
    for (let i = 0; i < arr.length; i++) {
      const mappedValue = yield this.executeCallback(callbackFunc, [arr[i], i, arr]);
      result.push(mappedValue);
    }

    return result;
  }
}

class Filter extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, callbackFunc] = this.args;
    this.validateArray(arr);
    this.validateFunction(callbackFunc, "callbackFunc");

    const result = [];
    for (let i = 0; i < arr.length; i++) {
      const shouldInclude = yield this.executeCallback(callbackFunc, [arr[i], i, arr]);
      if (shouldInclude) {
        result.push(arr[i]);
      }
    }

    return result;
  }
}

class Reduce extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, callbackFunc, initialValue] = this.args;
    this.validateArray(arr);
    this.validateFunction(callbackFunc, "callbackFunc");

    const hasInitialValue = this.args.length > 2;

    if (arr.length === 0 && !hasInitialValue) {
      throw this.throwErrorFormatters(new Error("Reduce of empty array with no initial value"));
    }

    let accumulator = hasInitialValue ? initialValue : arr[0];
    const startIndex = hasInitialValue ? 0 : 1;

    for (let i = startIndex; i < arr.length; i++) {
      accumulator = yield this.executeCallback(callbackFunc, [accumulator, arr[i], i, arr]);
    }

    return yield lift(accumulator);
  }
}

class ReduceRight extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, callbackFunc, initialValue] = this.args;
    this.validateArray(arr);
    this.validateFunction(callbackFunc, "callbackFunc");

    const hasInitialValue = this.args.length > 2;

    if (arr.length === 0 && !hasInitialValue) {
      throw this.throwErrorFormatters(new Error("Reduce of empty array with no initial value"));
    }

    let accumulator = hasInitialValue ? initialValue : arr[arr.length - 1];
    const startIndex = hasInitialValue ? arr.length - 1 : arr.length - 2;

    for (let i = startIndex; i >= 0; i--) {
      accumulator = yield this.executeCallback(callbackFunc, [accumulator, arr[i], i, arr]);
    }

    return yield lift(accumulator);
  }
}

class Find extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, callbackFunc] = this.args;
    this.validateArray(arr);
    this.validateFunction(callbackFunc, "callbackFunc");

    for (let i = 0; i < arr.length; i++) {
      const found = yield this.executeCallback(callbackFunc, [arr[i], i, arr]);
      if (found) {
        return yield lift(arr[i]);
      }
    }

    return null;
  }
}

class FindIndex extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, callbackFunc] = this.args;
    this.validateArray(arr);
    this.validateFunction(callbackFunc, "callbackFunc");

    for (let i = 0; i < arr.length; i++) {
      const found = yield this.executeCallback(callbackFunc, [arr[i], i, arr]);
      if (found) {
        return i;
      }
    }

    return -1;
  }
}

class FindLast extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, callbackFunc] = this.args;
    this.validateArray(arr);
    this.validateFunction(callbackFunc, "callbackFunc");

    for (let i = arr.length - 1; i >= 0; i--) {
      const found = yield this.executeCallback(callbackFunc, [arr[i], i, arr]);
      if (found) {
        return yield lift(arr[i]);
      }
    }

    return null;
  }
}

class FindLastIndex extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, callbackFunc] = this.args;
    this.validateArray(arr);
    this.validateFunction(callbackFunc, "callbackFunc");

    for (let i = arr.length - 1; i >= 0; i--) {
      const found = yield this.executeCallback(callbackFunc, [arr[i], i, arr]);
      if (found) {
        return i;
      }
    }

    return -1;
  }
}

class Some extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, callbackFunc] = this.args;
    this.validateArray(arr);
    this.validateFunction(callbackFunc, "callbackFunc");

    for (let i = 0; i < arr.length; i++) {
      const result = yield this.executeCallback(callbackFunc, [arr[i], i, arr]);
      if (result) {
        return true;
      }
    }

    return false;
  }
}

class Every extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, callbackFunc] = this.args;
    this.validateArray(arr);
    this.validateFunction(callbackFunc, "callbackFunc");

    for (let i = 0; i < arr.length; i++) {
      const result = yield this.executeCallback(callbackFunc, [arr[i], i, arr]);
      if (!result) {
        return false;
      }
    }

    return true;
  }
}

class Push extends ArrayMethodBuilder {
  override call() {
    const [arr, ...elements] = this.args;
    this.validateArray(arr);

    return arr.push(...elements);
  }
}

class Pop extends ArrayMethodBuilder {
  override call() {
    const [arr] = this.args;
    this.validateArray(arr);

    return arr.pop();
  }
}

class Shift extends ArrayMethodBuilder {
  override call() {
    const [arr] = this.args;
    this.validateArray(arr);

    return arr.shift();
  }
}

class Unshift extends ArrayMethodBuilder {
  override call() {
    const [arr, ...elements] = this.args;
    this.validateArray(arr);

    return arr.unshift(...elements);
  }
}

class Splice extends ArrayMethodBuilder {
  override call() {
    const [arr, start, deleteCount, ...items] = this.args;
    this.validateArray(arr);
    this.validateNumber(start, "start");

    if (deleteCount !== undefined) {
      this.validateNumber(deleteCount, "deleteCount");
    }

    // omitting `deleteCount` removes everything from `start`; passing an
    // explicit `undefined` to the host method would remove nothing
    return deleteCount === undefined
      ? arr.splice(start)
      : arr.splice(start, deleteCount, ...items);
  }
}

// Default order of `sort` / `toSorted`: numbers (and bigints) numerically,
// everything else by its text.
function defaultCompare(a: any, b: any): number {
  const numeric = (v: any) => typeof v === "number" || typeof v === "bigint";

  if (numeric(a) && numeric(b)) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  const left = String(a);
  const right = String(b);

  return left < right ? -1 : left > right ? 1 : 0;
}

class Sort extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, compareFn] = this.args;
    this.validateArray(arr);

    if (compareFn !== undefined) {
      this.validateFunction(compareFn, "compareFn");

      const self = this;

      const partition = function* (array: any[], low: number, high: number): Gen<number> {
        const pivot = array[high];
        let i = low - 1;

        for (let j = low; j < high; j++) {
          const compareResult: any = yield self.executeCallback(compareFn, [array[j], pivot]);
          if (compareResult <= 0) {
            i++;
            [array[i], array[j]] = [array[j], array[i]];
          }
        }

        [array[i + 1], array[high]] = [array[high], array[i + 1]];
        return i + 1;
      };

      const quickSort = function* (array: any[], low: number, high: number): Gen<void> {
        if (low < high) {
          const pivot = yield partition(array, low, high);
          yield quickSort(array, low, pivot - 1);
          yield quickSort(array, pivot + 1, high);
        }
      };

      yield quickSort(arr, 0, arr.length - 1);
      return arr;
    }

    return arr.sort(defaultCompare);
  }
}

class Reverse extends ArrayMethodBuilder {
  override call() {
    const [arr] = this.args;
    this.validateArray(arr);

    return arr.reverse();
  }
}

class ToReversed extends ArrayMethodBuilder {
  override call() {
    const [arr] = this.args;
    this.validateArray(arr);

    return [...arr].reverse();
  }
}

class ToSorted extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, compareFn] = this.args;
    this.validateArray(arr);

    const newArr = [...arr];

    if (compareFn !== undefined) {
      this.validateFunction(compareFn, "compareFn");
      const sortInstance = new Sort([newArr, compareFn], [], this.environment);
      yield sortInstance.call();
      return newArr;
    }

    return newArr.sort(defaultCompare);
  }
}

class ToSpliced extends ArrayMethodBuilder {
  override call() {
    const [arr, start, deleteCount, ...items] = this.args;
    this.validateArray(arr);
    this.validateNumber(start, "start");

    if (deleteCount !== undefined) {
      this.validateNumber(deleteCount, "deleteCount");
    }

    const newArr = [...arr];
    if (deleteCount === undefined) {
      newArr.splice(start);
    } else {
      newArr.splice(start, deleteCount, ...items);
    }
    return newArr;
  }
}

class With extends ArrayMethodBuilder {
  override call() {
    const [arr, index, value] = this.args;
    this.validateArray(arr);
    this.validateNumber(index, "index");

    const newArr = [...arr];
    newArr[index] = value;
    return newArr;
  }
}

class Includes extends ArrayMethodBuilder {
  override call() {
    const [arr, searchElement, fromIndex] = this.args;
    this.validateArray(arr);

    if (fromIndex !== undefined) {
      this.validateNumber(fromIndex, "fromIndex");
    }

    return arr.includes(searchElement, fromIndex);
  }
}

class IndexOf extends ArrayMethodBuilder {
  override call() {
    const [arr, searchElement, fromIndex] = this.args;
    this.validateArray(arr);

    if (fromIndex !== undefined) {
      this.validateNumber(fromIndex, "fromIndex");
    }

    return arr.indexOf(searchElement, fromIndex);
  }
}

class LastIndexOf extends ArrayMethodBuilder {
  override call() {
    const [arr, searchElement, fromIndex] = this.args;
    this.validateArray(arr);

    if (fromIndex !== undefined) {
      this.validateNumber(fromIndex, "fromIndex");
    }

    // an explicit `undefined` would mean "from index 0" for the host method
    return fromIndex === undefined
      ? arr.lastIndexOf(searchElement)
      : arr.lastIndexOf(searchElement, fromIndex);
  }
}

class Concat extends ArrayMethodBuilder {
  override call() {
    const [arr, ...values] = this.args;
    this.validateArray(arr);

    return arr.concat(...values);
  }
}

class Slice extends ArrayMethodBuilder {
  override call() {
    const [arr, start, end] = this.args;
    this.validateArray(arr);

    if (start !== undefined) {
      this.validateNumber(start, "start");
    }
    if (end !== undefined) {
      this.validateNumber(end, "end");
    }

    return arr.slice(start, end);
  }
}

class Join extends ArrayMethodBuilder {
  override call() {
    const [arr, separator] = this.args;
    this.validateArray(arr);

    return arr.join(separator);
  }
}

class ToString extends ArrayMethodBuilder {
  override call() {
    const [arr] = this.args;
    this.validateArray(arr);

    return arr.toString();
  }
}

class ToLocaleString extends ArrayMethodBuilder {
  override call() {
    const [arr, locales, options] = this.args;
    this.validateArray(arr);

    return arr.toLocaleString(locales, options);
  }
}

class Keys extends ArrayMethodBuilder {
  override call() {
    const [arr] = this.args;
    this.validateArray(arr);

    return Array.from(arr.keys());
  }
}

class Values extends ArrayMethodBuilder {
  override call() {
    const [arr] = this.args;
    this.validateArray(arr);

    return Array.from(arr.values());
  }
}

class Entries extends ArrayMethodBuilder {
  override call() {
    const [arr] = this.args;
    this.validateArray(arr);

    return Array.from(arr.entries());
  }
}

class Flat extends ArrayMethodBuilder {
  override call() {
    const [arr, depth = 1] = this.args;
    this.validateArray(arr);

    if (depth !== undefined) {
      this.validateNumber(depth, "depth");
    }

    return arr.flat(depth);
  }
}

class FlatMap extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arr, callbackFunc] = this.args;
    this.validateArray(arr);
    this.validateFunction(callbackFunc, "callbackFunc");

    const mapped = [];
    for (let i = 0; i < arr.length; i++) {
      const result = yield this.executeCallback(callbackFunc, [arr[i], i, arr]);
      mapped.push(result);
    }

    return mapped.flat();
  }
}

class ArrayFrom extends ArrayMethodBuilder {
  override *call(): Gen<any> {
    const [arrayLike, mapFn] = this.args;

    if (mapFn !== undefined) {
      this.validateFunction(mapFn, "mapFn");
      const baseArray = Array.from(arrayLike);
      const result = [];

      for (let i = 0; i < baseArray.length; i++) {
        const mappedValue = yield this.executeCallback(mapFn, [baseArray[i], i]);
        result.push(mappedValue);
      }

      return result;
    }

    return Array.from(arrayLike);
  }
}

class ArrayOf extends ArrayMethodBuilder {
  override call() {
    return Array.of(...this.args);
  }
}

module.exports = {
  at: At,
  forEach: ForEach,
  map: Map,
  filter: Filter,
  reduce: Reduce,
  reduceRight: ReduceRight,
  find: Find,
  findIndex: FindIndex,
  findLast: FindLast,
  findLastIndex: FindLastIndex,
  some: Some,
  every: Every,
  push: Push,
  pop: Pop,
  shift: Shift,
  unshift: Unshift,
  splice: Splice,
  sort: Sort,
  reverse: Reverse,
  toReversed: ToReversed,
  toSorted: ToSorted,
  toSpliced: ToSpliced,
  with: With,
  includes: Includes,
  indexOf: IndexOf,
  lastIndexOf: LastIndexOf,
  concat: Concat,
  slice: Slice,
  join: Join,
  toString: ToString,
  toLocaleString: ToLocaleString,
  keys: Keys,
  values: Values,
  entries: Entries,
  flat: Flat,
  flatMap: FlatMap,
  from: ArrayFrom,
  of: ArrayOf,
};
