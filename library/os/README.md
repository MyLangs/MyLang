# `os`

The machine the program runs on: platform, memory, users, environment variables, commands.

```ml
import "core:os";
```

## Suspension

| Method | Suspends | Description |
| --- | --- | --- |
| `os.system(command)` | yes | run a shell command, returning `{ stdout, stderr, returncode }` |
| everything else | — | reads a value the host already has |

`os.system` parks the calling task while the command runs, so the rest of the program keeps
going. Use `spawn` to run several at once.

## Permissions

| Method | Needs |
| --- | --- |
| `os.system` | `--allow-process` |
| `os.getenv`, `setenv`, `unsetenv`, `environ` | `--allow-env` |
| `os.cpus`, `totalmem`, `freemem`, `userinfo`, `networkInterfaces`, `kill`, `chdir`, `exit` | `--allow-sys` |

Each one is checked as it is called, with the variable or the operation as the target, so a
grant may name what is allowed:

```
mylang run app.ml --allow-env=HOME,PATH --deny-sys
```

Reading a variable the grant does not name is refused by name, rather than the program
seeing `nil` and carrying on with a wrong default.

## Methods

### The machine

| Method | Description |
| --- | --- |
| `os.platform()` / `arch()` / `type()` / `release()` / `version()` / `machine()` | identity |
| `os.hostname()` | host name |
| `os.cpus()` | one entry per core |
| `os.totalmem()` / `freemem()` | memory, in bytes |
| `os.loadavg()` / `uptime()` | load and uptime |
| `os.homedir()` / `tmpdir()` | well-known directories |
| `os.networkInterfaces()` | addresses of each interface |
| `os.getLocalIP()` / `getAllIPs()` | this machine's addresses |
| `os.systemInfo()` | the common ones in one object |
| `os.eol` / `os.constants` | fields |

### This process

| Method | Description |
| --- | --- |
| `os.getpid()` / `getppid()` / `getuid()` / `getgid()` | identity |
| `os.getcwd()` / `chdir(path)` | working directory (`chdir` is refused on a worker thread) |
| `os.args()` / `os.executable()` | how it was started |
| `os.memoryUsage()` / `cpuUsage()` | current usage |
| `os.exit(code)` | end the program |
| `os.kill(pid, signal)` | signal another process |
| `os.stdin` / `stdout` / `stderr` | the standard streams |

### Environment variables

| Method | Description |
| --- | --- |
| `os.getenv(name)` | read one |
| `os.setenv(name, value)` | set one |
| `os.unsetenv(name)` | remove one |
| `os.environ()` | all of them |

## Notes on `chdir`

The working directory belongs to the process, not to one thread, so `os.chdir` cannot work
inside a worker — including a test file run by `mylang test --jobs`. It says so rather than
reporting a host error code. Absolute paths, or `path.resolve`, work everywhere.

## Examples

### Branching on the platform

```ml
import "core:os";

if (os.platform() == "win32") {
  coreio.print("Windows", os.release());
} else {
  coreio.print(os.type(), os.release());
}
```

### Configuration from the environment

```ml
var port = os.getenv("PORT");

server.listen(port ? +port : 8080);
```

### Running a command

```ml
var result = os.system("git rev-parse --short HEAD");

if (result.returncode == 0) {
  coreio.print("commit:", strings.trim(result.stdout));
}
```

### Reporting resources

```ml
var info = os.systemInfo();

coreio.print($"{info.platform} {info.arch}, {length(os.cpus())} cores");
coreio.print($"{os.freemem() / 1024 / 1024}MB free of {os.totalmem() / 1024 / 1024}MB");
```

## Notes

- `os.system` runs a command line through a shell, which is how an argument becomes a
  command. When any part of the command comes from outside, use `process.run(command,
  args)` instead — it never involves a shell.
- `os/system` is a companion module with the interpreter's own process details (versions,
  resource usage, uid/gid).
