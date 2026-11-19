import "core:test" as { describe, test, assert, finish };
import "core:process";
import "core:path";
import "core:fs";
import "core:time";

// The permission policy is built from the command line, so it can only be exercised by
// running a program with those flags. Each test starts a child interpreter and reads
// back what it printed.

// The child is started from the project root, so the fixture paths and the flags in
// these tests are both written relative to it.
var fixtures = "test/fixtures";

// `node dist/bin/index.js run <file> <flags...>` - the entry point the CLI installs.
func runSandboxed(file, flags) {
  var args = ["dist/bin/index.js", "run", path.join(fixtures, file)];
  for (var flag in flags) { args[length(args)] = flag; }

  return process.run("node", args, { timeout: 30000 });
}

describe("permissions: file access", func() {
  test("reading outside the allowed paths is refused", func() {
    var r = runSandboxed("perm-read.ml", ["--allow-read=./test/fixtures"]);

    assert.includes(r.stdout.toString(), "inside: ok");
    assert.includes(r.stdout.toString(), "outside: denied");
  });

  test("without --allow-write a program cannot write", func() {
    var r = runSandboxed("perm-write.ml", ["--allow-read=."]);

    assert.includes(r.stdout.toString(), "write: denied");
  });

  test("--allow-write permits writing under the given path", func() {
    var r = runSandboxed("perm-write.ml", ["--allow-read=.", "--allow-write=./test/fixtures"]);

    assert.includes(r.stdout.toString(), "write: ok");
  });

  test("with no flags at all nothing is restricted", func() {
    var r = runSandboxed("perm-read.ml", []);

    assert.includes(r.stdout.toString(), "inside: ok");
    assert.includes(r.stdout.toString(), "outside: ok");
  });

  test("--deny-read refuses even without any --allow flag", func() {
    var r = runSandboxed("perm-read.ml", ["--deny-read"]);

    assert.includes(r.stdout.toString(), "inside: denied");
  });
});

describe("permissions: processes and network", func() {
  test("--deny-process stops a program starting commands", func() {
    var r = runSandboxed("perm-process.ml", ["--deny-process"]);

    assert.includes(r.stdout.toString(), "process: denied");
  });

  test("--allow-process may name the commands that are allowed", func() {
    var r = runSandboxed("perm-process.ml", ["--allow-process=node"]);

    assert.includes(r.stdout.toString(), "process: ok");
  });

  test("a sandboxed program cannot reach the network", func() {
    var r = runSandboxed("perm-net.ml", ["--allow-read=."]);

    assert.includes(r.stdout.toString(), "net: denied");
  });

  test("--allow-net may name the hosts that are allowed", func() {
    var r = runSandboxed("perm-net.ml", ["--allow-net=127.0.0.1"]);

    assert.includes(r.stdout.toString(), "net: ok");
  });
});

describe("permissions: resource limits", func() {
  test("--timeout ends a program that runs too long", func() {
    var r = runSandboxed("perm-spin.ml", ["--timeout=1s"]);

    assert.notEqual(r.code, 0);
    assert.includes(r.stderr.toString(), "timed out");
  });

  test("a program cannot catch its own timeout", func() {
    var r = runSandboxed("perm-catch-timeout.ml", ["--timeout=1s"]);

    assert.notIncludes(r.stdout.toString(), "caught");
    assert.includes(r.stderr.toString(), "timed out");
  });

  test("--max-memory ends a program that allocates too much", func() {
    var r = runSandboxed("perm-memory.ml", ["--max-memory=64MB"]);

    assert.notEqual(r.code, 0);
    assert.includes(r.stderr.toString(), "Memory limit exceeded");
  });

  test("a program with resources still open ends promptly", func() {
    var watch = time.Stopwatch();

    watch.start();
    var r = runSandboxed("perm-open-socket.ml", ["--allow-net=127.0.0.1", "--timeout=1s"]);
    watch.stop();

    assert.includes(r.stderr.toString(), "timed out");
    assert.less(watch.elapsed(), 10000);
  });

  test("an invalid limit is reported instead of ignored", func() {
    var r = runSandboxed("perm-read.ml", ["--timeout=soon"]);

    assert.notEqual(r.code, 0);
    assert.includes(r.stderr.toString(), "--timeout");
  });
});

describe("permissions: a program can ask what it may do", func() {
  test("process.permissions reports the policy", func() {
    var p = process.permissions();

    assert.typeOf(p.sandboxed, "boolean");
    assert.typeOf(p.read, "string");
    assert.typeOf(p.maxMemory, "string");
    assert.typeOf(p.timeout, "string");
  });

  test("process.can never throws", func() {
    assert.typeOf(process.can("net"), "boolean");
    assert.typeOf(process.can("read", "/etc/hosts"), "boolean");
    assert.throws(func() { process.can("nonsense"); }, "unknown permission");
  });
});

finish("permissions");
