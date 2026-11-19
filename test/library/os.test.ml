import "core:test" as { describe, test, assert, finish, skip };
import "os";
import "os/system";
import "workers";

describe("os: system information", func() {
  test("platform, arch and type are strings", func() {
    assert.typeOf(os.platform(), "string");
    assert.typeOf(os.arch(), "string");
    assert.typeOf(os.type(), "string");
    assert.includes(
      ["linux", "darwin", "win32", "freebsd", "openbsd", "sunos", "aix", "android"],
      os.platform()
    );
  });

  test("release, version, machine and hostname are non-empty strings", func() {
    assert.typeOf(os.release(), "string");
    assert.typeOf(os.version(), "string");
    assert.typeOf(os.machine(), "string");
    assert.greater(length(os.hostname()), 0);
  });

  test("cpus lists at least one processor", func() {
    var cpus = os.cpus();
    assert.typeOf(cpus, "array");
    assert.greater(length(cpus), 0);
    assert.typeOf(cpus[0], "object");
  });

  test("memory figures are consistent", func() {
    assert.greater(os.totalmem(), 0);
    assert.greater(os.freemem(), 0);
    assert.lessOrEqual(os.freemem(), os.totalmem());
  });

  test("loadavg has three entries", func() {
    var load = os.loadavg();
    assert.typeOf(load, "array");
    assert.lengthOf(load, 3);
  });

  test("uptime is positive", func() {
    assert.greater(os.uptime(), 0);
  });

  test("userinfo describes the current user", func() {
    var user = os.userinfo();
    assert.typeOf(user, "object");
    assert.typeOf(user.username, "string");
  });

  test("home and temp directories", func() {
    assert.typeOf(os.homedir(), "string");
    assert.typeOf(os.tmpdir(), "string");
    assert.greater(length(os.tmpdir()), 0);
  });

  test("network helpers", func() {
    assert.typeOf(os.networkInterfaces(), "object");
    assert.typeOf(os.getLocalIP(), "string");
    assert.typeOf(os.getAllIPs(), "object");
  });

  test("constants and the end-of-line marker", func() {
    assert.typeOf(os.constants, "object");
    assert.typeOf(os.eol, "string");
    assert.includes(["\n", "\r\n"], os.eol);
  });

  test("systemInfo bundles the basics", func() {
    var info = os.systemInfo();
    assert.equal(info.platform, os.platform());
    assert.equal(info.arch, os.arch());
    assert.typeOf(info.memory, "object");
    assert.equal(info.memory.total, os.totalmem());
    assert.typeOf(info.cpu, "object");
    assert.greater(info.cpu.count, 0);
  });

  test("memoryUsage reports total, free, used and percent", func() {
    var m = os.memoryUsage();
    assert.equal(m.total, os.totalmem());
    assert.lessOrEqual(m.used, m.total);
    assert.isTrue(m.percent >= 0 && m.percent <= 100);
  });

  test("cpuUsage reports a percentage and the core count", func() {
    var c = os.cpuUsage();
    assert.isTrue(c.usage >= 0 && c.usage <= 100);
    assert.equal(c.usage + c.idle, 100);
    assert.greater(c.count, 0);
    assert.typeOf(c.model, "string");
  });
});

describe("os: process", func() {
  test("process and parent ids", func() {
    assert.greater(os.getpid(), 0);
    assert.typeOf(os.getppid(), "int");

    if (os.platform() == "win32") {
      skip("getuid and getgid are not supported on Windows");
    } else {
      assert.typeOf(os.getuid(), "int");
      assert.typeOf(os.getgid(), "int");
    }
  });

  test("args and executable", func() {
    assert.typeOf(os.args(), "array");
    assert.typeOf(os.executable(), "string");
    assert.greater(length(os.executable()), 0);
  });

  test("standard streams are available", func() {
    assert.typeOf(os.stdin, "function");
    assert.typeOf(os.stdout, "function");
    assert.typeOf(os.stderr, "function");
  });

  test("kill reports an error for a process that does not exist", func() {
    assert.throws(func() { os.kill(2147483646, 0); }, "Cannot kill process");
  });

  test("kill requires a numeric pid", func() {
    assert.throws(func() { os.kill("abc"); }, "must be of type int");
  });
});

describe("os: working directory", func() {
  test("getcwd returns a string", func() {
    assert.typeOf(os.getcwd(), "string");
  });

  // The working directory belongs to the process, so a thread cannot move it. Under
  // `mylang test --jobs` these files run on worker threads, where chdir is refused.
  if (workers.isWorker()) {
    test("chdir says why it cannot work on a worker thread", func() {
      assert.throws(func() { os.chdir(os.tmpdir()); }, "worker thread");
    });
  } else {
    test("chdir changes it and can be undone", func() {
      var before = os.getcwd();
      os.chdir(os.tmpdir());
      assert.equal(os.getcwd(), os.tmpdir());
      os.chdir(before);
      assert.equal(os.getcwd(), before);
    });

    test("chdir into a missing directory is an error", func() {
      var before = os.getcwd();
      assert.throws(func() { os.chdir("/definitely/not/a/real/directory"); }, "ENOENT");
      assert.equal(os.getcwd(), before);
    });
  }
});

describe("os: environment variables", func() {
  test("setenv and getenv round-trip", func() {
    assert.isTrue(os.setenv("MYLANG_TEST_VAR", "hello"));
    assert.equal(os.getenv("MYLANG_TEST_VAR"), "hello");
    os.unsetenv("MYLANG_TEST_VAR");
  });

  test("getenv of an unset variable is nil", func() {
    assert.isNil(os.getenv("MYLANG_TEST_SURELY_UNSET"));
  });

  test("getenv accepts a default", func() {
    assert.equal(os.getenv("MYLANG_TEST_SURELY_UNSET", "fallback"), "fallback");
    os.setenv("MYLANG_TEST_DEFAULTED", "real");
    assert.equal(os.getenv("MYLANG_TEST_DEFAULTED", "fallback"), "real");
    os.unsetenv("MYLANG_TEST_DEFAULTED");
  });

  test("an empty value is kept, not replaced by nil", func() {
    os.setenv("MYLANG_TEST_EMPTY", "");
    assert.equal(os.getenv("MYLANG_TEST_EMPTY"), "");
    os.unsetenv("MYLANG_TEST_EMPTY");
  });

  test("unsetenv removes the variable", func() {
    os.setenv("MYLANG_TEST_GONE", "x");
    assert.isTrue(os.unsetenv("MYLANG_TEST_GONE"));
    assert.isNil(os.getenv("MYLANG_TEST_GONE"));
  });

  test("environ is a readable snapshot that includes new variables", func() {
    os.setenv("MYLANG_TEST_SNAPSHOT", "1");
    var env = os.environ();
    assert.typeOf(env, "object");
    assert.equal(env["MYLANG_TEST_SNAPSHOT"], "1");
    assert.isTrue("MYLANG_TEST_SNAPSHOT" in env);
    os.unsetenv("MYLANG_TEST_SNAPSHOT");
  });

  test("values must be strings", func() {
    assert.throws(func() { os.setenv("MYLANG_TEST_NUM", 5); }, "must be of type string");
    assert.throws(func() { os.setenv(5, "x"); }, "must be of type string");
    assert.throws(func() { os.getenv(5); }, "must be of type string");
  });
});

describe("os: running commands", func() {
  test("system captures stdout and the exit code", func() {
    var r = os.system("echo hello");

    assert.equal(
      r.stdout,
      os.platform() == "win32" ? "hello\r\n" : "hello\n"
    );
    assert.equal(r.returncode, 0);
    assert.equal(r.stderr, "");
  });

  test("system reports a failing command", func() {
    var r = os.system("exit 3");
    assert.equal(r.returncode, 3);
    assert.notEqual(r.stderr, "");
  });

  test("system needs a string command", func() {
    assert.throws(func() { os.system(5); }, "must be of type string");
  });
});

describe("os/system", func() {
  test("exposes platform and arch consistently with os", func() {
    assert.equal(system.platform, os.platform());
    assert.equal(system.arch, os.arch());
  });

  test("exposes the working directory and version", func() {
    assert.equal(system.cwd(), os.getcwd());
    assert.typeOf(system.version, "string");
    assert.includes(system.version, ".");
    assert.typeOf(system.versions, "object");
  });

  test("hides dangerous members", func() {
    assert.throws(func() { var v = system.env; }, "does not exist");
    assert.throws(func() { var v = system.exit; }, "does not exist");
    assert.throws(func() { var v = system.kill; }, "does not exist");
    assert.throws(func() { var v = system.binding; }, "does not exist");
    assert.throws(func() { var v = system.mainModule; }, "does not exist");
  });

  test("prototype access is forbidden", func() {
    assert.throws(func() { var v = system.__proto__; }, "not allowed");
    assert.throws(func() { var v = system.constructor; }, "not allowed");
  });
});

finish("os");
