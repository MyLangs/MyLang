import { EventMethodBuilder } from "./EventsBuilder";
import { Environment } from "../../src/Environment";
import { type FunctionBuilder } from "../FunctionBuilder";
import { isTypeArgs } from "../utils/utils";
import { type Gen } from "../../src/runtime/coroutine";

interface IObservable {
  next: typeof FunctionBuilder;
  error: Error | null;
  complete: typeof FunctionBuilder | null;
}

/**
 * A new Observable fed by `source`: every value is handed to `onNext`, errors and
 * completion are forwarded unchanged. A failure inside `onNext` becomes an error
 * of the derived observable.
 */
function deriveObservable(
  owner: EventMethodBuilder,
  source: any,
  onNext: (builder: EventMethodBuilder, value: any, derived: any) => Gen<any>,
): any {
  const derived: any = new Observable([], [], owner.environment).call();

  const observer = {
    next: class extends EventMethodBuilder {
      override *call(): Gen<any> {
        try {
          yield onNext(this, this.args[0], derived);
        } catch (error) {
          yield new derived.error([error], [], this.environment).call();
        }
      }
    },
    error: class extends EventMethodBuilder {
      override *call(): Gen<any> {
        yield new derived.error(this.args, [], this.environment).call();
      }
    },
    complete: class extends EventMethodBuilder {
      override *call(): Gen<any> {
        yield new derived.complete([], [], this.environment).call();
      }
    },
  };

  new source.subscribe([observer], [], owner.environment).call();

  return derived;
}


class Observable extends EventMethodBuilder {
  override call() {
    const observers: IObservable[] = [];
    let completed = false;
    let errorOccurred = false;
    let lastError: Error | null = null;

    const self: any = {
      subscribe: class extends EventMethodBuilder {
        override call() {
          const [observerOrNext, error, complete] = this.args;

          let observer;

          if (isTypeArgs(observerOrNext) === "object" && observerOrNext.next) {
            observer = observerOrNext;
          } else {
            this.validateFunction(observerOrNext, "next");
            observer = {
              next: observerOrNext,
              error: error || null,
              complete: complete || null,
            };
          }

          if (completed || errorOccurred) {
            if (errorOccurred && observer.error) {
              this.fireListener(observer.error, [lastError]);
            } else if (completed && observer.complete) {
              this.fireListener(observer.complete, []);
            }
            return {
              unsubscribe: class extends EventMethodBuilder {
                override call() {
                  return {};
                }
              },
            };
          }

          observers.push(observer);

          return {
            unsubscribe: class extends EventMethodBuilder {
              override call() {
                const index = observers.indexOf(observer);
                if (index !== -1) {
                  observers.splice(index, 1);
                }
              }
            },
          };
        }
      },

      next: class extends EventMethodBuilder {
        override *call(): Gen<any> {
          const [value] = this.args;

          if (completed || errorOccurred) {
            return self;
          }

          for (const observer of observers) {
            if (observer.next) {
              try {
                yield this.executeListener(observer.next, [value]);
              } catch (err) {
                if (observer.error) {
                  yield this.executeListener(observer.error, [err]);
                } else {
                  console.error("Unhandled error in observer:", err);
                }
              }
            }
          }

          return self;
        }
      },

      error: class extends EventMethodBuilder {
        override *call(): Gen<any> {
          const [err] = this.args;

          if (completed || errorOccurred) {
            return self;
          }

          errorOccurred = true;
          lastError = err;

          for (const observer of observers) {
            if (observer.error) {
              try {
                yield this.executeListener(observer.error, [err]);
              } catch (e) {
                console.error("Error in error handler:", e);
              }
            }
          }

          observers.length = 0;
          return self;
        }
      },

      complete: class extends EventMethodBuilder {
        override *call(): Gen<any> {
          if (completed || errorOccurred) {
            return self;
          }

          completed = true;

          for (const observer of observers) {
            if (observer.complete) {
              try {
                yield this.executeListener(observer.complete, []);
              } catch (err) {
                console.error("Error in complete handler:", err);
              }
            }
          }

          observers.length = 0;
          return self;
        }
      },

      map: class extends EventMethodBuilder {
        override call() {
          const [mapFunc] = this.args;
          this.validateFunction(mapFunc, "mapper");

          return deriveObservable(this, self, function* (builder, value, derived) {
            const mapped = yield (builder as any).executeListener(mapFunc, [value]);
            yield new derived.next([mapped], [], builder.environment).call();
          });
        }
      },

      filter: class extends EventMethodBuilder {
        override call() {
          const [predicate] = this.args;
          this.validateFunction(predicate, "predicate");

          return deriveObservable(this, self, function* (builder, value, derived) {
            const keep = yield (builder as any).executeListener(predicate, [value]);

            if (keep) {
              yield new derived.next([value], [], builder.environment).call();
            }
          });
        }
      },

      pipe: class extends EventMethodBuilder {
        override *call(): Gen<any> {
          const operators = this.args;

          for (const op of operators) {
            this.validateFunction(op, "operator");
          }

          // every operator receives the previous observable and returns the next
          let result: any = self;

          for (const op of operators) {
            result = yield this.executeListener(op, [result]);
          }

          return result;
        }
      },

      isCompleted: class extends EventMethodBuilder {
        override call() {
          return completed;
        }
      },

      hasError: class extends EventMethodBuilder {
        override call() {
          return errorOccurred;
        }
      },

      getError: class extends EventMethodBuilder {
        override call() {
          return lastError;
        }
      },

      observerCount: class extends EventMethodBuilder {
        override call() {
          return observers.length;
        }
      },

      [Environment.SymbolFormatedText]: `Observable { observers: ${observers.length}, completed: ${completed}, error: ${errorOccurred} }`,
    };

    return self;
  }
}

export { Observable };
