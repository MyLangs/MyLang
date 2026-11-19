import "core:test" as { describe, test, assert, finish };
import "core:process";
import "core:time";

var NODE = "node";

var ECHO = "process.stdout.write(process.argv.slice(1).join(' ') + '\\n')";
var CAT = "process.stdin.pipe(process.stdout)";
var SORT = "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(s.split('\\n').filter(Boolean).sort().join('\\n')+'\\n'))";
var COUNT_BYTES = "let n=0;process.stdin.on('data',x=>n+=x.length);process.stdin.on('end',()=>process.stdout.write(String(n)+'\\n'))";
var COUNT_LINES = "let n=0;process.stdin.on('data',x=>{for(const b of x)if(b===10)n++});process.stdin.on('end',()=>process.stdout.write(String(n)+'\\n'))";
var HEAD = "const n=Number(process.argv[1]);let count=0;process.stdin.on('data',b=>{for(const c of b){if(count>=n)break;process.stdout.write(Buffer.from([c]));if(c===10)count++}if(count>=n)process.exit(0)})";

func stage(code) {
  return [NODE, ["-e", code]];
}

describe("process: run", func() {
  test("output and exit code are reported", func() {
    var result = process.run(NODE, ["-e", ECHO, "hello", "world"]);

    assert.equal(result.code, 0);
    assert.isTrue(result.success);
    assert.equal(result.stdout.toString(), "hello world\n");
    assert.equal(result.stderr.toString(), "");
  });

  test("a failing command is a result, not an error", func() {
    var result = process.run(NODE, [
      "-e",
      "process.stderr.write('oops\\n');process.exit(3)"
    ]);

    assert.equal(result.code, 3);
    assert.isFalse(result.success);
    assert.includes(result.stderr.toString(), "oops");
  });

  test("input can be piped in", func() {
    var result = process.run(NODE, ["-e", SORT], {
      input: "b\na\nc\n"
    });

    assert.equal(result.stdout.toString(), "a\nb\nc\n");
  });

  test("binary input and output survive", func() {
    var result = process.run(NODE, ["-e", CAT], {
      input: [104, 105]
    });

    assert.equal(result.stdout.toArray(), [104, 105]);
  });

  test("a command that does not exist is reported", func() {
    assert.throws(
      func() { process.run("definitely-not-a-command-here", []); },
      "failed to run"
    );
  });

  test("numeric arguments are accepted as text", func() {
    var result = process.run(NODE, ["-e", ECHO, 42]);

    assert.equal(result.stdout.toString(), "42\n");
  });

  test("a timeout kills a command that hangs", func() {
    assert.throws(
      func() {
        process.run(NODE, [
          "-e",
          "setTimeout(()=>{},30000)"
        ], { timeout: 200 });
      },
      "was killed after"
    );
  });

  test("the command must be a string", func() {
    assert.throws(
      func() { process.run(5, []); },
      "must be of type string"
    );
  });
});

describe("process: spawn", func() {
  test("a child can be written to and read from while it runs", func() {
    var child = process.spawn(NODE, ["-e", CAT]);

    child.write("streamed\n");
    child.closeInput();

    assert.equal(child.output().toString(), "streamed\n");
    assert.equal(child.wait().code, 0);

    child.close();
  });

  test("the child reports whether it is still running", func() {
    var child = process.spawn(NODE, [
      "-e",
      "setTimeout(()=>{},5000)"
    ]);

    assert.isTrue(child.running());

    child.kill();
    child.wait();

    assert.isFalse(child.running());
    child.close();
  });

  test("the pid is available", func() {
    var child = process.spawn(NODE, [
      "-e",
      "process.stdout.write('x')"
    ]);

    assert.typeOf(child.pid, "int");

    child.wait();
    child.close();
  });

  test("stderr is read separately", func() {
    var child = process.spawn(NODE, [
      "-e",
      "process.stderr.write('to-stderr\\n')"
    ]);

    assert.includes(child.readError().toString(), "to-stderr");

    child.wait();
    child.close();
  });

  test("writing after the input is closed is an error", func() {
    var child = process.spawn(NODE, ["-e", CAT]);

    child.closeInput();
    child.wait();

    assert.throws(
      func() { child.write("x"); },
      "already closed"
    );

    child.close();
  });
});

describe("process: resources", func() {
  test("defer kills a child that is still running", func() {
    func scoped() {
      var child = defer process.spawn(NODE, [
        "-e",
        "setTimeout(()=>{},30000)"
      ]);
      return child;
    }

    var child = scoped();

    assert.isTrue(child.closed);
  });

  test("close is idempotent", func() {
    var child = process.spawn(NODE, [
      "-e",
      "process.stdout.write('x')"
    ]);

    child.wait();
    child.close();
    child.close();

    assert.isTrue(child.closed);
  });
});

describe("process: concurrency", func() {
  test("waiting for a child does not block other tasks", func() {
    var ticks = 0;
    var running = true;

    var ticker = spawn {
      while (running) {
        ticks += 1;
        wait spawn time.Sleep(1);
      }
    };

    var result = process.run(NODE, [
      "-e",
      "setTimeout(()=>{},200)"
    ]);

    running = false;
    wait ticker;

    assert.equal(result.code, 0);
    assert.greater(ticks, 1);
  });
});

describe("process: the security policy", func() {
  test("permissions describes what is allowed", func() {
    var p = process.permissions();

    assert.typeOf(p.sandboxed, "boolean");
    assert.typeOf(p.read, "string");
    assert.typeOf(p.net, "string");
    assert.typeOf(p.maxMemory, "string");
  });

  test("can answers without throwing", func() {
    assert.typeOf(process.can("read"), "boolean");
    assert.typeOf(process.can("process", "git"), "boolean");
  });

  test("an unknown permission is refused", func() {
    assert.throws(
      func() { process.can("flying"); },
      "unknown permission"
    );
  });

  test("pid reports this process", func() {
    assert.typeOf(process.pid(), "int");
    assert.greater(process.pid(), 0);
  });
});

describe("process: pipeline", func() {
  test("the output of each stage feeds the next", func() {
    var source = "process.stdout.write('banana\\napple\\ncherry\\napple\\nbanana\\napple\\n')";

    var count = "let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{let m={};for(const x of s.split('\\n').filter(Boolean))m[x]=(m[x]||0)+1;for(const [k,v] of Object.entries(m).sort((a,b)=>b[1]-a[1]))console.log(v+' '+k)})";

    var out = process.pipeline([
      stage(source),
      stage(SORT),
      stage(count)
    ]);

    assert.equal(out.code, 0);
    assert.includes(out.stdout.toString(), "3 apple");
    assert.includes(out.stdout.toString(), "1 cherry");
  });

  test("input is given to the first stage", func() {
    var out = process.pipeline([
      stage(CAT),
      stage(COUNT_BYTES)
    ], {
      input: "twelve bytes"
    });

    assert.equal(out.code, 0);
    assert.includes(out.stdout.toString(), "12");
  });

  test("every stage reports its own exit code", func() {
    var grep = "let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{if(s.includes('absent'))process.stdout.write(s);else process.exitCode=1})";

    var out = process.pipeline([
      stage(CAT),
      stage(grep),
      stage(COUNT_LINES)
    ], {
      input: "nothing matching\n"
    });

    assert.lengthOf(out.stages, 3);
    assert.equal(out.stages[0].command, NODE);
    assert.equal(out.stages[1].code, 1);
    assert.equal(out.code, 0);
  });

  test("a large stream passes through without being collected", func() {
    var generate = "for(let i=1;i<=200000;i++)process.stdout.write(i+'\\n')";

    var modulo = "let s='';process.stdin.on('data',x=>{s+=x;let a=s.split('\\n');s=a.pop();for(const v of a)if(v)process.stdout.write((Number(v)%97)+'\\n')})";

    var countUnique = "let s=new Set();let b='';process.stdin.on('data',x=>{b+=x;let a=b.split('\\n');b=a.pop();for(const v of a)s.add(v)});process.stdin.on('end',()=>process.stdout.write(String(s.size)+'\\n'))";

    var out = process.pipeline([
      stage(generate),
      stage(modulo),
      stage(countUnique)
    ]);

    assert.equal(out.code, 0);
    assert.includes(out.stdout.toString(), "97");
  });

  test("a stage that stops reading does not break the program", func() {
    var out = process.pipeline([
      stage(CAT),
      [NODE, ["-e", HEAD, "1"]]
    ], {
      input: "first\nsecond\nthird\nfourth\n"
    });

    assert.equal(out.stdout.toString(), "first\n");
  });

  test("a huge input to a stage that reads one line is survivable", func() {
    var big = "";

    for (var i = 0; i < 5000; i++) {
      big += $"line {i}\n";
    }

    var out = process.pipeline([
      stage(CAT),
      [NODE, ["-e", HEAD, "2"]]
    ], {
      input: big
    });

    assert.includes(out.stdout.toString(), "line 0");
    assert.includes(out.stdout.toString(), "line 1");
    assert.notIncludes(out.stdout.toString(), "line 4999");
  });

  test("run survives a command that ignores its input", func() {
    var out = process.run(NODE, [
      "-e",
      "process.exit(0)"
    ], {
      input: "ignored entirely"
    });

    assert.equal(out.code, 0);
  });

  test("an empty pipeline is refused", func() {
    assert.throws(
      func() { process.pipeline([]); },
      "array of stages"
    );

    assert.throws(
      func() { process.pipeline("sort"); },
      "array of stages"
    );
  });

  test("a stage that does not exist is reported", func() {
    assert.throws(
      func() {
        process.pipeline([
          stage("process.stdout.write('x')"),
          ["definitely-not-a-program"]
        ]);
      },
      "definitely-not-a-program"
    );
  });

  test("errors from any stage are kept", func() {
    var out = process.pipeline([
      stage("process.stdout.write('x')"),
      stage("process.stderr.write('missing file\\n');process.exit(2)")
    ]);

    assert.notEqual(out.stages[1].code, 0);
    assert.greater(length(out.stderr), 0);
  });
});

finish("process");
