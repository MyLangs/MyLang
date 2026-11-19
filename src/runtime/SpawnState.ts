import { type StmtType } from "../ast/StmtType";
import { Environment } from "../Environment";
import { isTypeArgs } from "../../library/utils/utils";
import { FunctionExpression } from "../ast/expression/FunctionExpression";
import { FunctionDeclaration } from "../ast/declaration/FunctionDeclaration";
import {
  FunctionBuilder,
  FunctionBuilderCodeError,
} from "../../library/FunctionBuilder";
import { isSubclassOfByName } from "../utils/isSubclassOfByName";
import { runtime } from "./Runtime";
import { type Spawn } from "./Spawn";
import { type Gen, callNative } from "./coroutine";

abstract class SpawnMethodBuilder extends FunctionBuilder {
  get pkgInfo() {
    return {
      name: "native",
      path: __dirname,
    };
  }
}

function* runCallback(
  owner: FunctionBuilder,
  fn: any,
  value: any,
  score: Environment,
): Gen<any> {
  if (fn instanceof FunctionDeclaration || fn instanceof FunctionExpression) {
    runtime.markFunctionCallPosition();
    const callEnv = new Environment(score);

    if (fn.params?.length) {
      const [param] = fn.params[0]!;

      callEnv.create(param, value);
    }

    yield fn.body.evaluate(callEnv);

    const res = runtime.getLastExecutionResult();
    runtime.resetLastExecutionResult();
    runtime.finishFunction();

    return res;
  }

  if (isSubclassOfByName(fn, "FunctionBuilder")) {
    return yield callNative(new fn([value], [], score));
  }

  throw owner.throwErrorFormatters(
    FunctionBuilderCodeError.ArgumentsFirstTypeError,
    {
      expectType: "func",
      received: isTypeArgs(fn),
    },
  );
}

function convertSpawnState(handler: Spawn<any>, score: Environment) {
  return {
    // live view of the task: a handle read later must show the current state,
    // not the state at the moment `spawn` returned
    get done() {
      return handler.done;
    },
    get result() {
      return handler.result;
    },
    get error() {
      return handler.error;
    },
    get status() {
      return handler.status;
    },
    get elapsed() {
      return handler.elapsed;
    },
    cancel: class extends SpawnMethodBuilder {
      call() {
        return handler.cancel();
      }
    },
    isCancelled: class extends SpawnMethodBuilder {
      call() {
        return handler.isCancelled();
      }
    },
    isFinished: class extends SpawnMethodBuilder {
      call() {
        return handler.isFinished();
      }
    },
    // spawnHandle.output(onValue, onError?) -> new spawn that runs once `handler` settles
    output: class extends SpawnMethodBuilder {
      constructor(args: any[], astArgs: StmtType[], environment: Environment) {
        super(args, astArgs, environment);

        if (isTypeArgs(args[0]) !== "function") {
          throw super.throwErrorFormatters(
            FunctionBuilderCodeError.ArgumentsFirstTypeError,
            {
              expectType: "func",
              received: isTypeArgs(args[0]),
            },
          );
        }
      }

      call() {
        const [onValue, onError] = this.args;

        const chained = runtime.scheduler.spawn(
          () => {
            const owner = this;

            return (function* (): Gen<any> {
              yield handler.join();

              if (handler.status === "rejected" && onError) {
                return yield runCallback(owner, onError, handler.error, score);
              }

              return yield runCallback(
                owner,
                onValue,
                handler.status === "rejected" ? handler.error : handler.result,
                score,
              );
            })();
          },
          { name: "output" },
        );

        return convertSpawnState(chained, this.environment);
      }
    },
    [Environment.SpawnQueueSymbol]: handler,
  };
}

export { convertSpawnState };
