import { BaseError } from "../errors/BaseError";
import { SyntaxError } from "../errors/lexer/SyntaxError";
import { Lexer } from "../lexer/Lexer";
import { Parser } from "../ast/Parser";
import { Interpreter } from "../Interpreter";
import { type Gen } from "../runtime/coroutine";

interface RunOptions {
  main: string;
  base: string;
  paths?: string[];
  cache?: Record<string, any>;
  options?: Record<string, any>;
  onSuccess?: (result: any) => void;
  onReady?: (interpreter: Interpreter) => void;
}

interface RunResult {
  result: any;
  interpreter: Interpreter;
}

function prepare(code: string, options: RunOptions): Interpreter {
  const token = new Lexer(code).analyze();

  if (token.errors.length > 0) {
    throw new BaseError(token.errors[0]!.message, {
      files: options.paths!,
      ...(token.errors[0]!.code && { code: token.errors[0]!.code }),
    });
  }

  const parse = new Parser(token.tokens).parse();

  const interpreter = new Interpreter(parse, [], {
    base: options.base,
    main: options.main,
    options: { ...(options || {}) },
  });

  options.onReady?.(interpreter);

  return interpreter;
}

function toBaseError(err: unknown, options: RunOptions): BaseError {
  if (err instanceof BaseError) {
    if (err instanceof SyntaxError) {
      err.files = options.paths || [options.main];
    }
    return err;
  }

  return new BaseError(`${err}`, {
    files: options.paths || [options.main],
  });
}

/**
 * Run a program from inside a running task (used by `import` of .ml modules).
 * The module executes on the importer's task, so it can suspend / be preempted like any code.
 */
function* runInTask(code: string, options: RunOptions): Gen<RunResult> {
  try {
    const interpreter = prepare(code, options);
    const result = yield interpreter.exec();

    if (options.onSuccess) {
      options.onSuccess(result);
    }

    return { result, interpreter };
  } catch (err) {
    throw toBaseError(err, options);
  }
}

/** Host entry point: run a program as the main task and get a Promise for its completion. */
function run(code: string, options: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let interpreter: Interpreter;

    try {
      interpreter = prepare(code, options);
    } catch (err) {
      reject(toBaseError(err, options));
      return;
    }

    interpreter.start((error, result) => {
      if (error) {
        reject(toBaseError(error, options));
        return;
      }

      try {
        if (options.onSuccess) {
          options.onSuccess(result);
        }
      } catch (err) {
        reject(toBaseError(err, options));
        return;
      }

      resolve({ result, interpreter });
    });
  });
}

export { run, runInTask };
