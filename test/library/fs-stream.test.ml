import "core:test" as { describe, test, assert, beforeEach, finish };
import "fs";
import "fs/stream";
import "os";
import "path";
import "time";
import "uuid";

var root = path.join(os.tmpdir(), "mylang-test-stream-" + uuid.v4());
var dir = "";

func freshDir() {
  dir = path.join(root, uuid.v4());
  fs.makedir(dir, { recursive: true });
}

func waitUntil(check) {
  for (var i = 0; i < 100; i++) {
    if (check()) { return true; }
    time.Sleep(10);
  }
  return false;
}

describe("fs/stream: ReadableStream", func() {
  beforeEach(freshDir);

  test("emits data and end events", func() {
    var src = path.join(dir, "src.txt");
    fs.writeFile(src, "line1\nline2\nline3");
    var chunks = [];
    var ended = [];
    var rs = stream.ReadableStream(src);
    rs.on("data", func(chunk) { chunks[length(chunks)] = chunk.toString(); });
    rs.on("end", func() { ended[length(ended)] = true; });
    assert.isTrue(waitUntil(func() { return length(ended) > 0; }));
    assert.equal(chunks, ["line1\nline2\nline3"]);
  });

  test("emits close after the data", func() {
    var src = path.join(dir, "src.txt");
    fs.writeFile(src, "x");
    var order = [];
    var rs = stream.ReadableStream(src);
    rs.on("data", func(c) { order[length(order)] = "data"; });
    rs.on("close", func() { order[length(order)] = "close"; });
    assert.isTrue(waitUntil(func() { return length(order) >= 2; }));
    assert.equal(order, ["data", "close"]);
  });

  test("a missing file reports an error event instead of crashing", func() {
    var errors = [];
    var rs = stream.ReadableStream(path.join(dir, "nope.txt"));
    rs.on("error", func(err) { errors[length(errors)] = err; });
    assert.isTrue(waitUntil(func() { return length(errors) > 0; }));
    assert.typeOf(errors[0], "object");
  });

  test("start and end options select a byte range", func() {
    var src = path.join(dir, "src.txt");
    fs.writeFile(src, "abcdef");
    var got = [];
    var rs = stream.ReadableStream(src, { start: 1, end: 3 });
    rs.on("data", func(c) { got[length(got)] = c.toString(); });
    assert.isTrue(waitUntil(func() { return length(got) > 0; }));
    assert.equal(got, ["bcd"]);
  });

  test("exposes its path", func() {
    var src = path.join(dir, "src.txt");
    fs.writeFile(src, "x");
    var rs = stream.ReadableStream(src);
    assert.equal(rs.path(), src);
    rs.destroy();
  });

  test("the path must be a string", func() {
    assert.throws(func() { stream.ReadableStream(5); }, "must be of type string");
  });
});

describe("fs/stream: WritableStream", func() {
  beforeEach(freshDir);

  test("write then end produces the file", func() {
    var dst = path.join(dir, "dst.txt");
    var ws = stream.WritableStream(dst);
    assert.isTrue(ws.write("hello "));
    assert.isTrue(ws.write("world"));
    ws.end("!");
    assert.isTrue(waitUntil(func() { return fs.exists(dst) && fs.readFile(dst).length == 12; }));
    assert.equal(fs.readFile(dst).toString(), "hello world!");
  });

  test("emits finish and close", func() {
    var events = [];
    var ws = stream.WritableStream(path.join(dir, "w.txt"));
    ws.on("finish", func() { events[length(events)] = "finish"; });
    ws.on("close", func() { events[length(events)] = "close"; });
    ws.write("data");
    ws.end();
    assert.isTrue(waitUntil(func() { return length(events) >= 2; }));
    assert.equal(events, ["finish", "close"]);
  });

  test("append mode keeps existing content", func() {
    var f = path.join(dir, "log.txt");
    var first = stream.WritableStream(f, { flags: "a" });
    first.write("1");
    first.end();
    waitUntil(func() { return fs.exists(f) && fs.readFile(f).length == 1; });
    var second = stream.WritableStream(f, { flags: "a" });
    second.write("2");
    second.end();
    assert.isTrue(waitUntil(func() { return fs.readFile(f).length == 2; }));
    assert.equal(fs.readFile(f).toString(), "12");
  });

  test("write rejects unsupported chunks", func() {
    var ws = stream.WritableStream(path.join(dir, "w.txt"));
    assert.throws(func() { ws.write(5); }, "must be of type buffer, bytes or string");
    ws.end();
  });

  test("the path must be a string", func() {
    assert.throws(func() { stream.WritableStream(nil); }, "must be of type string");
  });
});

describe("fs/stream: pipe and transform", func() {
  beforeEach(freshDir);

  test("a readable can be piped into a writable", func() {
    var src = path.join(dir, "src.txt");
    var dst = path.join(dir, "dst.txt");
    fs.writeFile(src, "line1\nline2\nline3");
    var rs = stream.ReadableStream(src);
    var ws = stream.WritableStream(dst);
    var returned = rs.pipe(ws);
    assert.typeOf(returned, "object");
    assert.isTrue(waitUntil(func() { return fs.exists(dst) && fs.readFile(dst).length == 17; }));
    assert.equal(fs.readFile(dst).toString(), "line1\nline2\nline3");
  });

  test("pipe rejects a destination that is not a stream", func() {
    var src = path.join(dir, "src.txt");
    fs.writeFile(src, "x");
    var rs = stream.ReadableStream(src);
    assert.throws(func() { rs.pipe({}); }, "must be a writable or transform stream");
    rs.destroy();
  });

  test("a transform changes the data flowing through it", func() {
    var src = path.join(dir, "src.txt");
    var dst = path.join(dir, "dst.txt");
    fs.writeFile(src, "abc");
    var upper = stream.TransformStream(func(chunk, encoding) { return "T:" + chunk.toString(); });
    var rs = stream.ReadableStream(src);
    var ws = stream.WritableStream(dst);
    rs.pipe(upper);
    upper.pipe(ws);
    assert.isTrue(waitUntil(func() { return fs.exists(dst) && fs.readFile(dst).length == 5; }));
    assert.equal(fs.readFile(dst).toString(), "T:abc");
  });

  test("a transform can be fed by hand", func() {
    var dst = path.join(dir, "dst.txt");
    var marker = stream.TransformStream(func(chunk, encoding) { return chunk.toString() + "|"; });
    var ws = stream.WritableStream(dst);
    marker.pipe(ws);
    marker.write("x");
    marker.write("y");
    marker.end();
    assert.isTrue(waitUntil(func() { return fs.exists(dst) && fs.readFile(dst).length == 4; }));
    assert.equal(fs.readFile(dst).toString(), "x|y|");
  });

  test("a transform function returning nil drops the chunk", func() {
    var dst = path.join(dir, "dst.txt");
    var dropper = stream.TransformStream(func(chunk, encoding) { return nil; });
    var ws = stream.WritableStream(dst);
    dropper.pipe(ws);
    dropper.write("ignored");
    dropper.end();
    time.Sleep(80);
    assert.equal(fs.exists(dst) ? fs.readFile(dst).length : 0, 0);
  });

  test("the transform function must be a function", func() {
    assert.throws(func() { stream.TransformStream(5); }, "must be of type function");
  });
});

fs.removedir(root, { recursive: true, force: true });

finish("fs-stream");
