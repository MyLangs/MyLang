import { Spawn } from "../../runtime/Spawn";
import { Environment } from "../../Environment";
import { type StmtType } from "../../ast/StmtType";
import { BaseError } from "../../errors/BaseError";
import { FunctionBuilder } from "../../../library/FunctionBuilder";
import {
  SpawnQueueError,
  SpawnQueueCodeError,
} from "../../errors/runtime/SpawnQueueError";
import { type Gen, park } from "../../runtime/coroutine";

abstract class WaitBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return {
      name: "wait",
      path: __dirname,
    };
  }

  /** wait.xxx(task1, task2, task3) or wait.xxx([task1, task2, task3]) */
  protected collect(): { value: any; handler: Spawn<any> }[] {
    const tasks: any[] =
      this.args.length === 1 && Array.isArray(this.args[0])
        ? this.args[0]
        : this.args;

    return tasks.map((value) => {
      const handler = value?.[Environment.SpawnQueueSymbol];

      if (!(handler instanceof Spawn)) {
        throw new SpawnQueueError(SpawnQueueCodeError.ValueIsNotSpawn);
      }

      return { value, handler };
    });
  }
}

class allWait extends WaitBuilder {
  *call(): Gen<any[]> {
    const tasks = this.collect();
    const results: any[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const { handler } = tasks[i]!;

      yield handler.join();

      if (handler.error) {
        for (const { handler: rest } of tasks.slice(i)) rest.cancel();

        (handler.error as any).cause = { index: i };
        (handler.error as any).message += ` (index ${i})`;
        throw handler.error;
      }

      results.push(handler.result);
    }

    return results;
  }
}

class raceWait extends WaitBuilder {
  *call(): Gen<any> {
    const tasks = this.collect();

    // the first task (in argument order for already settled ones) that settles decides
    const first: Spawn<any> = yield park<Spawn<any>>((wake) => {
      const unsubscribe = tasks.map(({ handler }) =>
        handler.onSettled(() => wake(handler)),
      );

      return () => unsubscribe.forEach((off) => off());
    });

    if (first.error) throw first.error;

    return first.result;
  }
}

class allSettledWait extends WaitBuilder {
  *call(): Gen<any[]> {
    const tasks = this.collect();
    const results: {
      status: "fulfilled" | "rejected" | "pending" | "cancelled";
      reason?: string;
      value?: any;
    }[] = [];

    for (const { handler } of tasks) {
      yield handler.join();

      if (handler.error) {
        results.push({
          status: handler.status,
          reason: (handler.error as Error).message,
        });
        continue;
      }

      results.push({ status: handler.status, value: handler.result });
    }

    return results;
  }
}

class anyWait extends WaitBuilder {
  *call(): Gen<any> {
    const tasks = this.collect();

    if (tasks.length === 0) {
      throw super.throwErrorFormatters(
        new BaseError("All promises were rejected"),
      );
    }

    const winner: Spawn<any> | null = yield park<Spawn<any> | null>((wake) => {
      let failed = 0;

      const unsubscribe = tasks.map(({ handler }) =>
        handler.onSettled(() => {
          if (handler.status === "fulfilled") {
            wake(handler);
          } else if (++failed === tasks.length) {
            wake(null);
          }
        }),
      );

      return () => unsubscribe.forEach((off) => off());
    });

    if (!winner) {
      throw super.throwErrorFormatters(
        new BaseError("All promises were rejected"),
      );
    }

    return winner.result;
  }
}

export { allWait, raceWait, allSettledWait, anyWait };
