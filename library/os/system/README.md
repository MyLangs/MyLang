# `os/system`

The interpreter's own process: versions, identity, resource usage.

```ml
import "core:os/system";
```

Where `os` describes the machine, `os/system` describes this process. It is also the object
bound to the predefined `process` global, which `import "core:process"` replaces when you
want the external-program library instead.

## Suspension

**Every method returns immediately** — each one reads a value the host already has.

| Method | Suspends | Description |
| --- | --- | --- |
| `system.version()` / `versions()` | — | the runtime's version and its components |
| `system.platform()` / `arch()` | — | where it runs |
| `system.nodejs()` | — | details of the host runtime |
| `system.getpid()` / `getppid()` | — | process ids |
| `system.argv()` | — | the command line |
| `system.getExecPath()` | — | the executable |
| `system.cwd()` / `changecwd(path)` | — | working directory |
| `system.killProcess(pid, signal)` | — | signal a process |
| `system.getUptime()` | — | how long this process has run |
| `system.getMemoryUsage()` | — | heap and resident size |
| `system.getCpuUsage()` | — | user and system time |
| `system.getResourceUsage()` | — | the full picture |
| `system.uid()` / `gid()` / `groups()` | — | identity |
| `system.setUid(id)` / `setGid(id)` / `setGroups(ids)` | — | change it |
| `system.hrTime()` / `hrTimeBigInt()` | — | a high-resolution clock |

## Permissions

Reading identity and usage needs `--allow-sys`; changing it (`setUid`, `setGid`,
`setegid`, `seteuid`) needs it too and is refused outright under `--deny-sys`.

Every one of these is checked as it is called, with the operation as the target, so the
policy a program runs under is what decides — not what it remembers being allowed earlier:

```
mylang run report.ml --allow-sys
mylang run untrusted.ml --deny-sys
```

## Examples

### Reporting memory

```ml
import "core:os/system";

var usage = system.getMemoryUsage();

coreio.print($"heap: {usage.heapUsed / 1024 / 1024}MB of {usage.heapTotal / 1024 / 1024}MB");
```

### Measuring precisely

```ml
var start = system.hrTimeBigInt();

doTheWork();

coreio.print($"took {(system.hrTimeBigInt() - start) / 1000000n}ms");
```

### Arguments

```ml
var args = system.argv();

for (var i = 2; i < length(args); i++) {
  coreio.print("argument:", args[i]);
}
```

## Notes

- `hrTime` is monotonic: unlike the wall clock, it never jumps when the system time is
  adjusted, so it is the right one for measuring.
- To run another program, use `process`; this module only reports on the current one.
