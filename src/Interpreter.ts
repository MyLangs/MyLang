import fs from "node:fs";
import path from "node:path";
import { type StmtType } from "./ast/StmtType";
import { Position } from "./lexer/token/Position";
import {
  FileReadFaildError,
  FileReadFaildCodeError,
} from "./errors/runtime/FileReadFaildError";
import { BaseError } from "./errors/BaseError";
import { BlockStatement } from "./ast/statement/BlockStatement";
import { Environment } from "./Environment";
import { runtime } from "./runtime/Runtime";
import { type Gen } from "./runtime/coroutine";

// @ts-ignore
import process from "../library/os/system/index";
import {
  resolve as resolveNativeFunc,
  asImport as asImportNativeFunc,
} from "./native/function/import";
import {
  allWait as waitAllNativeFunc,
  raceWait as raceAllNativeFunc,
  allSettledWait as allSettledNativeFunc,
  anyWait as anyWaitNativeFunc,
} from "./native/function/wait";
import { Length as LengthNativeFunc } from "./native/function/global";

class Interpreter {
  public readonly ast: StmtType[];
  public readonly globalScore: Environment;

  constructor(ast: StmtType[], paths: string[], options: Record<string, any>) {
    this.ast = ast;

    const globalScore = new Environment();

    this.globalScore = globalScore;

    this.globalScore.create("import", {
      base: options.base,
      main: options.main,
      cache: options.cache || {},
      paths,
      resolve: resolveNativeFunc,
      as: asImportNativeFunc,
    });

    this.globalScore.create("wait", {
      all: waitAllNativeFunc,
      race: raceAllNativeFunc,
      allSettled: allSettledNativeFunc,
      any: anyWaitNativeFunc,
    });

    this.globalScore.create("symbol", {
      dispose: Environment.SymbolDeferred,
      iterator: Environment.SymbolIterator,
    });

    this.globalScore.create("length", LengthNativeFunc);

    this.globalScore.create("process", process);

    this.globalScore.create("global", {});

    const fullPathJSON = path.join(options.base, "mylang.json");

    if (fs.existsSync(fullPathJSON)) {
      try {
        const myLangJSON = JSON.parse(fs.readFileSync(fullPathJSON).toString());

        this.globalScore.update("import", {
          ...this.globalScore.get("import"),
          myLangJSON,
        });

        if (myLangJSON.initScript) {
          const initFileScript = path.join(options.base, myLangJSON.initScript);

          if (!fs.existsSync(initFileScript)) {
            throw new FileReadFaildError(
              FileReadFaildCodeError.NotFountInitFileScript,
              {
                fullPath: initFileScript,
                files: [options.base],
              },
            );
          }

          this.addCustomFunction(initFileScript);
        }
      } catch (err) {
        throw new FileReadFaildError(
          FileReadFaildCodeError.FaildInitFileScript,
          {
            err: String(err),
            files: [options.base],
          },
        );
      }
    }

    this.globalScore.create("#exports", {});

    this.globalScore.create("#options", options.options);

    // An `import` may bind over these: asking for a module by name is explicit, and a
    // predefined global should not make a module unusable (`import "core:process"`).
    this.globalScore.markInterpreterGlobals([
      "process",
      "global",
      "length",
      "symbol",
    ]);
  }

  /** Run the whole program as one task. Must be called from inside a task (e.g. by `import`). */
  *exec(): Gen<any> {
    const blockStmt = new BlockStatement(
      this.ast,
      new Position(0, this.ast.at(-1)!.position.column),
    );

    yield blockStmt.evaluate(this.globalScore);

    return runtime.getLastRuntimeExecutionResult();
  }

  /**
   * Start the program as the "main" task on the scheduler and report completion through
   * `done`. Interpreter code itself is synchronous and Promise-free; this callback is the
   * only bridge to the host.
   *
   * `done` fires when the main task finishes. Tasks spawned by it keep running afterwards
   * (the Node.js process stays alive until their timers / host operations are done).
   */
  start(done: (error: unknown, result?: any) => void): void {
    runtime.beginLimits();

    const main = runtime.scheduler.spawn(() => this.exec(), { name: "main" });

    // Node's event loop ran dry while main is still blocked: nothing can ever wake it.
    const onDeadlock = () => {
      if (main.status === "pending") {
        done(
          new BaseError(
            "Deadlock: every task is blocked and nothing can wake them up",
            {
              files: [String(this.globalScore.get("import").main)],
            },
          ),
        );
      }
    };

    globalThis.process.once("beforeExit", onDeadlock);

    main.onSettled(() => {
      globalThis.process.off("beforeExit", onDeadlock);
      runtime.endLimits();

      if (main.status === "rejected") {
        done(main.error);
      } else {
        done(null, main.result);
      }
    });
  }

  /** Host entry point: resolves with the result of the main task. */
  run(): Promise<any> {
    return new Promise((resolve, reject) => {
      this.start((error, result) => (error ? reject(error) : resolve(result)));
    });
  }

  addCustomFunction(fileInit: string) {
    try {
      const initialize = require(fileInit).init;

      for (const name in initialize) {
        try {
          const globalObject = this.globalScore.get("global");
          globalObject[name] = initialize[name];
          this.globalScore.update("global", globalObject);
        } catch {
          throw new BaseError(`Invalid added "${name}"`);
        }
      }
    } catch (err) {
      throw new FileReadFaildError(FileReadFaildCodeError.FaildInitFileScript, {
        err: String(err),
        files: [fileInit],
      });
    }
  }
}

export { Interpreter };
