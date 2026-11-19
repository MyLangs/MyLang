/**
 * `process` - running external programs, and asking what this program is allowed to do.
 *
 *     var result = process.run("git", ["status", "--short"]);
 *     coreio.print(result.code, result.stdout.toString());
 *
 *     var child = defer process.spawn("sort");
 *     child.write("b\na\n");
 *     child.closeInput();
 *     coreio.print(child.output().toString());
 *
 * `run` waits for the program to finish; `spawn` hands back a live child whose streams can
 * be written to and read from while it runs. Both park the calling task instead of
 * blocking, so other tasks keep running while a child does its work.
 *
 * A running child is an owned resource: `symbol.dispose` kills it if it is still alive, so
 * `defer` guarantees no stray process is left behind when a block exits early.
 *
 * Permissions: starting any external program needs `--allow-process`, which may name the
 * commands that are allowed (`--allow-process=git,ls`). Reading the environment needs
 * `--allow-env`. The permission queries at the bottom never need a permission themselves.
 */

import { spawn as hostSpawn, type ChildProcess } from "node:child_process";
import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { type Gen, park } from "../../src/runtime/coroutine";
import { createResource } from "../kernel/resource";
import { security, PERMISSION_KINDS } from "../../src/security";

const PKG = { name: "process", path: __dirname };

abstract class ProcessMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return PKG;
  }

  /** The command and arguments, checked for type and for `--allow-process`. */
  protected command(
    command: any,
    args: any,
  ): { command: string; args: string[] } {
    this.assertString(command, "command");
    this.checkPermission("process", command);

    if (args === undefined || args === null) {
      return { command, args: [] };
    }

    this.assertArray(args, "args");

    return {
      command,
      args: args.map((arg: any, index: number) => {
        if (typeof arg === "string") return arg;
        if (typeof arg === "number" || typeof arg === "boolean") {
          return String(arg);
        }

        return this.assertString(arg, `args[${index}]`);
      }),
    };
  }

  /** `{ cwd, env, shell }` as the host's spawn options. */
  protected spawnOptions(options: any): Record<string, any> {
    if (options === undefined || options === null) return {};

    this.assertObject(options, "options");

    const mapped: Record<string, any> = {};

    if (typeof options["cwd"] === "string") {
      this.checkPermission("read", options["cwd"]);
      mapped["cwd"] = options["cwd"];
    }

    if (options["env"] !== undefined && options["env"] !== null) {
      this.assertObject(options["env"], "options.env");
      this.checkPermission("env");

      mapped["env"] = { ...process.env, ...options["env"] };
    }

    // running through a shell turns the arguments into a command line, which is the
    // usual way an injected argument becomes an injected command: it must be asked for
    if (options["shell"] === true) {
      mapped["shell"] = true;
    }

    return mapped;
  }

  call(): any {
    throw new Error("Call is not implemented");
  }
}

/**
 * Ignore the one error a pipe raises for an ordinary reason.
 *
 * A program is entitled to stop reading its input - `head`, `grep -q` and `wc` all do -
 * and the writer then gets `EPIPE`. In a shell that is a SIGPIPE the writer absorbs; here
 * it would surface as an unhandled stream error and end the program, so it is ignored
 * while any other error is left to be reported.
 */
function ignoreBrokenPipe(stream: any): void {
  if (!stream) return;

  stream.on("error", (error: any) => {
    if (error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED") return;

    throw error;
  });
}

/** Collected output of a child, plus the waiters for it. */
class ChildState {
  readonly stdout: Buffer[] = [];
  readonly stderr: Buffer[] = [];
  exitCode: number | null = null;
  signal: string | null = null;
  finished = false;
  failure: any = null;
  waiter: (() => void) | null = null;

  constructor(child: ChildProcess) {
    child.stdout?.on("data", (chunk: Buffer) => {
      this.stdout.push(chunk);
      this.notify();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderr.push(chunk);
      this.notify();
    });

    child.on("error", (error) => {
      this.failure = error;
      this.finished = true;
      this.notify();
    });

    child.on("close", (code, signal) => {
      this.exitCode = code;
      this.signal = signal;
      this.finished = true;
      this.notify();
    });
  }

  private notify(): void {
    const waiter = this.waiter;

    if (!waiter) return;

    this.waiter = null;
    waiter();
  }

  /** Park until the child writes something or exits. */
  *wait(): Gen<void> {
    if (this.finished) return;

    yield park<void>((wake) => {
      this.waiter = () => wake();

      return () => {
        this.waiter = null;
      };
    });
  }

  /** Park until the child has exited. */
  *waitExit(): Gen<void> {
    while (!this.finished) {
      yield this.wait();
    }
  }
}

/** `process.run(command, args, options)` - run to completion and collect the output. */
class Run extends ProcessMethodBuilder {
  override *call(): Gen<any> {
    const [commandName, args, options] = this.args;

    const { command, args: argv } = this.command(commandName, args);
    const spawnOptions = this.spawnOptions(options);

    const input = options?.["input"];
    const timeout =
      options && typeof options["timeout"] === "number"
        ? options["timeout"]
        : 0;

    let child: ChildProcess;

    try {
      child = hostSpawn(command, argv, spawnOptions);
    } catch (error: any) {
      throw this.throwErrorFormatters(
        new Error(`cannot start "${command}": ${error?.message ?? error}`),
      );
    }

    const state = new ChildState(child);

    ignoreBrokenPipe(child.stdin);

    if (input !== undefined && input !== null) {
      this.assertBinary(input, "options.input");
      child.stdin?.end(this.toBuffer(input));
    } else {
      child.stdin?.end();
    }

    let timedOut = false;
    let cancelTimer: (() => void) | null = null;

    if (timeout > 0) {
      const { runtime } =
        require("../../src/runtime/Runtime") as typeof import("../../src/runtime/Runtime");

      cancelTimer = runtime.scheduler.after(timeout, () => {
        timedOut = true;

        try {
          child.kill("SIGKILL");
        } catch {
          // the child may have exited in the meantime
        }
      });
    }

    yield state.waitExit();

    cancelTimer?.();

    if (state.failure) {
      throw this.throwErrorFormatters(
        new Error(
          `"${command}" failed to run: ${state.failure?.message ?? state.failure}`,
        ),
      );
    }

    if (timedOut) {
      throw this.throwErrorFormatters(
        new Error(`"${command}" was killed after ${timeout}ms`),
      );
    }

    const stdout = Buffer.concat(state.stdout);
    const stderr = Buffer.concat(state.stderr);

    return {
      code: state.exitCode,
      signal: state.signal,
      success: state.exitCode === 0,
      stdout: this.toBytes(stdout),
      stderr: this.toBytes(stderr),
      [Environment.SymbolFormatedText]: `ProcessResult { code: ${state.exitCode}, stdout: ${stdout.length} bytes }`,
    };
  }
}

/** `process.spawn(command, args, options)` - a live child to talk to while it runs. */
class Spawn extends ProcessMethodBuilder {
  override *call(): Gen<any> {
    const [commandName, args, options] = this.args;

    const { command, args: argv } = this.command(commandName, args);
    const spawnOptions = this.spawnOptions(options);

    let child: ChildProcess;

    try {
      child = hostSpawn(command, argv, spawnOptions);
    } catch (error: any) {
      throw this.throwErrorFormatters(
        new Error(`cannot start "${command}": ${error?.message ?? error}`),
      );
    }

    // an explicit write still reports the failure to the task that asked for it; this
    // only stops the stream's own error event from ending the program
    ignoreBrokenPipe(child.stdin);

    const state = new ChildState(child);

    const take = (chunks: Buffer[]): Buffer => {
      const all = Buffer.concat(chunks);

      chunks.length = 0;

      return all;
    };

    const built = createResource({
      name: "Child",
      counts: "task",
      pkg: PKG,
      close: () => {
        // a resource that goes out of scope must not leave a process running
        if (!state.finished) {
          try {
            child.kill("SIGTERM");
          } catch {
            // already gone
          }
        }
      },
      describe: () =>
        `Child { "${command}", pid: ${child.pid ?? "none"}, running: ${!state.finished} }`,
      members: {
        pid: child.pid ?? null,
        command,

        /** `write(data)` - send to the child's standard input. */
        write: class extends ProcessMethodBuilder {
          override *call(): Gen<any> {
            const [data] = this.args;

            this.assertBinary(data, "data");

            if (!child.stdin || child.stdin.destroyed) {
              throw this.throwErrorFormatters(
                new Error("the child's input is already closed"),
              );
            }

            const payload = this.toBuffer(data);

            yield park<void>((wake, fail) => {
              child.stdin!.write(payload, (error) => {
                if (error) fail(error);
                else wake();
              });
            });

            return payload.length;
          }
        },

        /** Tell the child there is no more input. */
        closeInput: class extends ProcessMethodBuilder {
          override call() {
            child.stdin?.end();

            return null;
          }
        },

        /** `read()` - whatever the child has written so far, parking if nothing yet. */
        read: class extends ProcessMethodBuilder {
          override *call(): Gen<any> {
            while (state.stdout.length === 0 && !state.finished) {
              yield state.wait();
            }

            return this.toBytes(take(state.stdout));
          }
        },

        readError: class extends ProcessMethodBuilder {
          override *call(): Gen<any> {
            while (state.stderr.length === 0 && !state.finished) {
              yield state.wait();
            }

            return this.toBytes(take(state.stderr));
          }
        },

        /** `output()` - everything the child writes, until it exits. */
        output: class extends ProcessMethodBuilder {
          override *call(): Gen<any> {
            yield state.waitExit();

            return this.toBytes(take(state.stdout));
          }
        },

        /** `wait()` - park until the child exits, then report how it went. */
        wait: class extends ProcessMethodBuilder {
          override *call(): Gen<any> {
            yield state.waitExit();

            return {
              code: state.exitCode,
              signal: state.signal,
              success: state.exitCode === 0,
            };
          }
        },

        /** `kill(signal)` - "SIGTERM" by default. */
        kill: class extends ProcessMethodBuilder {
          override call() {
            const [signal = "SIGTERM"] = this.args;

            this.assertString(signal, "signal");

            try {
              child.kill(signal as NodeJS.Signals);
            } catch (error: any) {
              throw this.throwErrorFormatters(error);
            }

            return null;
          }
        },

        running: class extends ProcessMethodBuilder {
          override call() {
            return !state.finished;
          }
        },

        exitCode: class extends ProcessMethodBuilder {
          override call() {
            return state.exitCode;
          }
        },
      },
    });

    return built.value;
  }
}

/** `process.pid()` - this program's process id. */
class Pid extends ProcessMethodBuilder {
  override call() {
    return process.pid;
  }
}

/** `process.exit(code)` - end the program. */
class Exit extends ProcessMethodBuilder {
  override call() {
    const [code = 0] = this.args;

    this.assertInteger(code, "code");
    this.checkPermission("sys", "exit");

    process.exit(code);
  }
}

// ---------------------------------------------------- the security policy

/**
 * `process.permissions()` - what this program is allowed to do.
 *
 * Asking is always allowed: a program that knows it cannot reach the network can say so
 * instead of failing halfway through, which is the whole point of having the answer.
 */
class Permissions extends ProcessMethodBuilder {
  override call() {
    const described = security.permissions.describe();
    const limits = security.limits.describe();

    return {
      sandboxed: security.permissions.sandboxed,
      ...described,
      maxMemory: limits["maxMemory"],
      timeout: limits["timeout"],
      [Environment.SymbolFormatedText]: `Permissions { ${PERMISSION_KINDS.map(
        (kind) => `${kind}: ${described[kind]}`,
      ).join(", ")} }`,
    };
  }
}

/** `process.can(kind, target)` - may this program do that? Never throws. */
class Can extends ProcessMethodBuilder {
  override call() {
    const [kind, target] = this.args;

    this.assertString(kind, "kind");

    if (!(PERMISSION_KINDS as readonly string[]).includes(kind)) {
      throw this.throwErrorFormatters(
        new Error(
          `unknown permission "${kind}". Known: ${PERMISSION_KINDS.join(", ")}`,
        ),
      );
    }

    if (target !== undefined && target !== null) {
      this.assertString(target, "target");
    }

    return security.can(kind as any, target ?? undefined);
  }
}

/**
 * `process.pipeline(stages, options)` - run several programs with the output of each
 * feeding the next.
 *
 *     var out = process.pipeline([
 *       ["git", ["log", "--format=%an"]],
 *       ["sort"],
 *       ["uniq", ["-c"]],
 *       ["sort", ["-rn"]]
 *     ]);
 *     coreio.print(out.stdout.toString());
 *
 * This is the shell's `a | b | c`, and it is what a shell is usually wanted for. Building
 * it by hand means reading each program's output into memory and writing it to the next,
 * which holds the whole stream at every stage; here each stage's output goes straight into
 * the next one's input, so a large stream passes through without being collected.
 *
 * Every stage is checked against `--allow-process` separately, so a grant naming commands
 * (`--allow-process=git,sort`) covers a pipeline only if it names all of them.
 *
 * Returns `{code, stdout, stderr, stages}`: the exit code of the *last* stage, its output,
 * the errors from every stage together, and a per-stage list of codes - a pipeline where
 * an early stage failed still produces output, so the codes are worth seeing.
 *
 * `wait` is needed: the task parks until the last program exits.
 */
class Pipeline extends ProcessMethodBuilder {
  override *call(): Gen<any> {
    const [stages, options] = this.args;

    if (!Array.isArray(stages) || stages.length === 0) {
      throw this.throwErrorFormatters(
        new Error(
          "pipeline expects an array of stages, each [command, args]: " +
            'process.pipeline([["git", ["log"]], ["sort"]])',
        ),
      );
    }

    const spawnOptions = this.spawnOptions(options);
    const input = options?.["input"];
    const prepared: Array<{ command: string; args: string[] }> = [];

    // every stage is checked before anything starts, so a refused pipeline starts nothing
    for (const stage of stages) {
      const [name, args] = Array.isArray(stage) ? stage : [stage, []];

      prepared.push(this.command(name, args));
    }

    const children: ChildProcess[] = [];

    try {
      for (let i = 0; i < prepared.length; i++) {
        const { command, args: argv } = prepared[i]!;

        children.push(hostSpawn(command, argv, spawnOptions));
      }
    } catch (error: any) {
      for (const child of children) child.kill("SIGKILL");

      throw this.throwErrorFormatters(
        new Error(`cannot start the pipeline: ${error?.message ?? error}`),
      );
    }

    // the plumbing: each stage's output is piped into the next stage's input, by the host,
    // so the data never passes through the interpreter at all
    for (let i = 0; i + 1 < children.length; i++) {
      const from = children[i]!;
      const to = children[i + 1]!;

      // a stage that stops reading breaks the pipe into it, which is normal
      ignoreBrokenPipe(from.stdout);
      ignoreBrokenPipe(to.stdin);

      if (from.stdout && to.stdin) from.stdout.pipe(to.stdin);
    }

    const states = children.map((child) => new ChildState(child));
    const first = children[0]!;
    const last = children[children.length - 1]!;

    ignoreBrokenPipe(first.stdin);

    if (input !== undefined && input !== null) {
      this.assertBinary(input, "options.input");
      first.stdin?.end(this.toBuffer(input));
    } else {
      first.stdin?.end();
    }

    // Only the last stage's output is collected; the others were piped onwards. Waiting
    // for every stage, not just the last, means no child is left behind.
    const lastState = states[states.length - 1]!;

    for (const state of states) {
      yield state.waitExit();
    }

    const firstFailure = states.find((state) => state.failure);

    if (firstFailure) {
      throw this.throwErrorFormatters(
        new Error(
          `a stage of the pipeline could not run: ${firstFailure.failure?.message ?? firstFailure.failure}`,
        ),
      );
    }

    const stageCodes = states.map((state, index) => ({
      command: prepared[index]!.command,
      code: state.exitCode ?? 0,
    }));

    const errors = states
      .map((state) => state.stderr)
      .filter((chunks) => chunks.length > 0)
      .map((chunks) => Buffer.concat(chunks));

    void last;

    return {
      code: lastState.exitCode ?? 0,
      stdout: this.toBytes(Buffer.concat(lastState.stdout)),
      stderr: this.toBytes(
        errors.length > 0 ? Buffer.concat(errors) : Buffer.alloc(0),
      ),
      stages: stageCodes,
    };
  }
}

module.exports = {
  run: Run,
  pipeline: Pipeline,
  spawn: Spawn,
  pid: Pid,
  exit: Exit,
  permissions: Permissions,
  can: Can,
};
