import { FunctionBuilder, FunctionBuilderCodeError } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { isTypeArgs } from "../utils/utils";
import os from "node:os";
import { exec } from "node:child_process";
import { isMainThread } from "node:worker_threads";
import { type Gen } from "../../src/runtime/coroutine";
import { fromCallback } from "../kernel/async";

abstract class OSMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return {
      name: "os",
      path: __dirname,
    };
  }

  protected validateString(str: any, argName?: string): void {
    if (argName && isTypeArgs(str) !== "string") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "string",
        received: isTypeArgs(str),
      });
    } else if (isTypeArgs(str) !== "string") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsFirstTypeError, {
        expectType: "string",
        received: isTypeArgs(str),
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

  call() {
    throw new Error("Call is not implemented");
  }
}

class Platform extends OSMethodBuilder {
  override call() {
    return os.platform();
  }
}

class Arch extends OSMethodBuilder {
  override call() {
    return os.arch();
  }
}

class Type extends OSMethodBuilder {
  override call() {
    return os.type();
  }
}

class Release extends OSMethodBuilder {
  override call() {
    return os.release();
  }
}

class Version extends OSMethodBuilder {
  override call() {
    return os.version();
  }
}

class Machine extends OSMethodBuilder {
  override call() {
    return os.machine();
  }
}

class Hostname extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "hostname");
    return os.hostname();
  }
}

class Cpus extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "cpus");
    return os.cpus();
  }
}

class TotalMem extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "memory");
    return os.totalmem();
  }
}

class FreeMem extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "memory");
    return os.freemem();
  }
}

class LoadAvg extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "loadavg");
    return os.loadavg();
  }
}

class Uptime extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "uptime");
    return os.uptime();
  }
}

class UserInfo extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "user");
    const [options] = this.args;
    return os.userInfo(options);
  }
}

class Homedir extends OSMethodBuilder {
  override call() {
    return os.homedir();
  }
}

class Tmpdir extends OSMethodBuilder {
  override call() {
    return os.tmpdir();
  }
}

class NetworkInterfaces extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "network-interfaces");
    return os.networkInterfaces();
  }
}

class Getpid extends OSMethodBuilder {
  override call() {
    return process.pid;
  }
}

class Getppid extends OSMethodBuilder {
  override call() {
    return process.ppid;
  }
}

class Getuid extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "user");
    return process.getuid ? process.getuid() : null;
  }
}

class Getgid extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "user");
    return process.getgid ? process.getgid() : null;
  }
}

class Getcwd extends OSMethodBuilder {
  override call() {
    return process.cwd();
  }
}

class Chdir extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "chdir");
    const [dir] = this.args;
    this.validateString(dir, "directory");

    // The working directory belongs to the process, not to one thread, so a worker
    // cannot move it. Saying so is more use than the host's own error code.
    if (!isMainThread) {
      throw this.throwErrorFormatters(
        new Error(
          "os.chdir cannot be used on a worker thread: the working directory belongs " +
            "to the whole process. Use absolute paths, or path.resolve, instead.",
        ),
      );
    }

    process.chdir(dir);
    return true;
  }
}

class Environ extends OSMethodBuilder {
  override call() {
    this.checkPermission("env");
    // a plain snapshot: the live `process.env` is an exotic host object whose
    // keys the member sandbox cannot read
    return { ...process.env };
  }
}

class Getenv extends OSMethodBuilder {
  override call() {
    const [key, defaultValue] = this.args;
    this.validateString(key, "key");
    this.checkPermission("env", key);
    return process.env[key] ?? defaultValue ?? null;
  }
}

class Setenv extends OSMethodBuilder {
  override call() {
    const [key, value] = this.args;
    this.validateString(key, "key");
    this.validateString(value, "value");
    this.checkPermission("env", key);
    process.env[key] = value;
    return true;
  }
}

class Unsetenv extends OSMethodBuilder {
  override call() {
    const [key] = this.args;
    this.validateString(key, "key");
    this.checkPermission("env", key);
    delete process.env[key];
    return true;
  }
}

/**
 * `os.system(command)` - run a shell command and collect its output.
 *
 * The command runs through a shell, which is how an argument becomes a command, so this
 * needs `--allow-process`. It no longer blocks the interpreter while the command runs:
 * the task parks and every other task keeps going.
 *
 * `process.run(command, args)` is the safer choice when the arguments are not fixed text,
 * because it does not involve a shell at all.
 */
class System extends OSMethodBuilder {
  override *call(): Gen<any> {
    const [command] = this.args;
    this.validateString(command, "command");
    this.checkPermission("process", command);

    try {
      const result = yield fromCallback<{ stdout: string; stderr: string }>(
        (done) => {
          exec(command, { encoding: "utf8" }, (error, stdout, stderr) => {
            // a non-zero exit is reported in the result, not as a failure; when the
            // command said nothing on stderr, the host's description of the failure is
            // the only explanation there is
            const text = String(stderr ?? "");

            done(null, {
              stdout: String(stdout ?? ""),
              stderr: error && text === "" ? error.message : text,
              ...(error ? { code: (error as any).code ?? 1 } : {}),
            } as any);
          });
        },
      );

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        returncode: (result as any).code ?? 0,
      };
    } catch (error: any) {
      return {
        stdout: "",
        stderr: error?.message ?? String(error),
        returncode: 1,
      };
    }
  }
}

class MemoryUsage extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "memory");
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;

    return {
      total,
      free,
      used,
      percent: (used / total) * 100,
    };
  }
}

class CpuUsage extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "cpu");
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach((cpu) => {
      const times = cpu.times;
      totalIdle += times.idle;
      totalTick += times.idle + times.irq + times.nice + times.sys + times.user;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - ~~((100 * idle) / total);

    return {
      usage,
      idle: 100 - usage,
      count: cpus.length,
      model: cpus[0]?.model || "Unknown",
    };
  }
}

class SystemInfo extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "system-info");
    return {
      platform: os.platform(),
      arch: os.arch(),
      type: os.type(),
      release: os.release(),
      version: os.version(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
      },
      cpu: {
        count: os.cpus().length,
        model: os.cpus()[0]?.model || "Unknown",
        speed: os.cpus()[0]?.speed || 0,
      },
      user: os.userInfo(),
      loadavg: os.loadavg(),
    };
  }
}

class GetLocalIP extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "network-interfaces");
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];

    Object.values(interfaces).forEach((nets) => {
      nets?.forEach((net) => {
        if (net.family === "IPv4" && !net.internal) {
          addresses.push(net.address);
        }
      });
    });

    return addresses[0] || "127.0.0.1";
  }
}

class GetAllIPs extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "network-interfaces");
    const interfaces = os.networkInterfaces();
    const result: { [key: string]: any[] } = {};

    Object.entries(interfaces).forEach(([name, nets]) => {
      result[name] =
        nets?.map((net) => ({
          address: net.address,
          family: net.family,
          internal: net.internal,
          mac: net.mac,
          cidr: net.cidr,
        })) || [];
    });

    return result;
  }
}

class Kill extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "kill");
    const [pid, signal = "SIGTERM"] = this.args;
    this.validateNumber(pid, "pid");

    try {
      process.kill(pid, signal);
      return true;
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`Cannot kill process ${pid}: ${error.message}`));
    }
  }
}

class Exit extends OSMethodBuilder {
  override call() {
    this.checkPermission("sys", "exit");
    const [code = 0] = this.args;
    if (code !== 0) this.validateNumber(code, "code");
    process.exit(code);
  }
}

class Args extends OSMethodBuilder {
  override call() {
    return process.argv.slice(2);
  }
}

class Executable extends OSMethodBuilder {
  override call() {
    return process.execPath;
  }
}

class Stdin extends OSMethodBuilder {
  override call() {
    return process.stdin;
  }
}

class Stdout extends OSMethodBuilder {
  override call() {
    return process.stdout;
  }
}

class Stderr extends OSMethodBuilder {
  override call() {
    return process.stderr;
  }
}

module.exports = {
  platform: Platform,
  arch: Arch,
  type: Type,
  release: Release,
  version: Version,
  machine: Machine,
  hostname: Hostname,
  cpus: Cpus,
  totalmem: TotalMem,
  freemem: FreeMem,
  loadavg: LoadAvg,
  uptime: Uptime,
  userinfo: UserInfo,
  homedir: Homedir,
  tmpdir: Tmpdir,
  networkInterfaces: NetworkInterfaces,
  constants: os.constants,
  eol: os.EOL,
  getpid: Getpid,
  getppid: Getppid,
  getuid: Getuid,
  getgid: Getgid,
  getcwd: Getcwd,
  chdir: Chdir,
  environ: Environ,
  getenv: Getenv,
  setenv: Setenv,
  unsetenv: Unsetenv,
  system: System,
  memoryUsage: MemoryUsage,
  cpuUsage: CpuUsage,
  systemInfo: SystemInfo,
  getLocalIP: GetLocalIP,
  getAllIPs: GetAllIPs,
  kill: Kill,
  exit: Exit,
  args: Args,
  executable: Executable,
  stdin: Stdin,
  stdout: Stdout,
  stderr: Stderr,
};
