import "core:test" as { describe, test, assert, finish };
import "time";

// Dates are built from local components and compared through format(), so the
// tests do not depend on the time zone of the machine they run on.

describe("time: DateTime fields", func() {
  var d = time.DateTime(2024, 3, 15, 10, 30, 45, 123);

  test("components", func() {
    assert.equal(d.year(), 2024);
    assert.equal(d.month(), 3);
    assert.equal(d.day(), 15);
    assert.equal(d.hour(), 10);
    assert.equal(d.minute(), 30);
    assert.equal(d.second(), 45);
    assert.equal(d.millisecond(), 123);
  });

  test("weekday counts from Sunday = 0", func() {
    assert.equal(d.weekday(), 5);
    assert.equal(time.DateTime(2024, 3, 17).weekday(), 0);
    assert.equal(time.DateTime(2024, 3, 18).weekday(), 1);
  });

  test("missing components default to the start of the month/day", func() {
    var short = time.DateTime(2024, 3, 16);
    assert.equal(short.format(), "2024-03-16 00:00:00");
  });

  test("out-of-range months roll over into the next year", func() {
    var rolled = time.DateTime(2024, 13, 1);
    assert.equal(rolled.year(), 2025);
    assert.equal(rolled.month(), 1);
  });

  test("an ISO string with Z is parsed as UTC", func() {
    assert.equal(time.DateTime("2024-01-02T03:04:05Z").toISOString(), "2024-01-02T03:04:05.000Z");
  });

  test("an invalid string is rejected", func() {
    assert.throws(func() { time.DateTime("garbage"); }, "Invalid date");
  });

  test("DateTime() is the current moment", func() {
    var now = time.DateTime();
    assert.greaterOrEqual(now.year(), 2024);
  });

  test("a DateTime can be copied through the constructor", func() {
    assert.isTrue(time.DateTime(d).isEqual(d));
  });

  test("timestamps", func() {
    var epochPlusDay = time.DateTime("1970-01-02T00:00:00Z");
    assert.equal(epochPlusDay.toTimestamp(), 86400);
    assert.equal(epochPlusDay.toMilliseconds(), 86400000);
  });
});

describe("time: DateTime arithmetic", func() {
  var d = time.DateTime(2024, 3, 15, 10, 30, 45, 123);

  test("setters return a modified copy", func() {
    assert.equal(d.setYear(2000).year(), 2000);
    assert.equal(d.setMonth(1).month(), 1);
    assert.equal(d.setDay(1).day(), 1);
    assert.equal(d.setHour(1).hour(), 1);
    assert.equal(d.setMinute(1).minute(), 1);
    assert.equal(d.setSecond(1).second(), 1);
    assert.equal(d.year(), 2024);
  });

  test("adding units", func() {
    assert.equal(d.addYears(1).year(), 2025);
    assert.equal(d.addMonths(10).month(), 1);
    assert.equal(d.addMonths(10).year(), 2025);
    assert.equal(d.addDays(20).format("YYYY-MM-DD"), "2024-04-04");
    assert.equal(d.addHours(14).format("YYYY-MM-DD HH"), "2024-03-16 00");
    assert.equal(d.addMinutes(45).format("HH:mm"), "11:15");
    assert.equal(d.addSeconds(20).format("HH:mm:ss"), "10:31:05");
  });

  test("adding negative amounts subtracts", func() {
    assert.equal(d.addDays(-15).format("YYYY-MM-DD"), "2024-02-29");
    assert.equal(d.addMonths(-3).format("YYYY-MM"), "2023-12");
    assert.equal(d.addYears(-4).year(), 2020);
  });

  test("the original is never modified", func() {
    d.addYears(5);
    d.addDays(100);
    assert.equal(d.format(), "2024-03-15 10:30:45");
  });

  test("clone is an independent copy", func() {
    var c = d.clone();
    assert.isTrue(c.isEqual(d));
    assert.equal(c.setYear(1999).year(), 1999);
    assert.equal(d.year(), 2024);
  });

  test("setters validate their argument", func() {
    assert.throws(func() { d.setYear("x"); }, "must be of type int");
  });
});

describe("time: DateTime comparison", func() {
  var a = time.DateTime(2024, 3, 15, 10, 30);
  var b = time.DateTime(2024, 3, 16);

  test("isBefore and isAfter accept another DateTime", func() {
    assert.isTrue(a.isBefore(b));
    assert.isFalse(a.isAfter(b));
    assert.isTrue(b.isAfter(a));
    assert.isFalse(b.isBefore(a));
  });

  test("isEqual", func() {
    assert.isTrue(a.isEqual(a));
    assert.isTrue(a.isEqual(a.clone()));
    assert.isFalse(a.isEqual(b));
  });

  test("a value is neither before nor after itself", func() {
    assert.isFalse(a.isBefore(a));
    assert.isFalse(a.isAfter(a));
  });

  test("comparison needs a date", func() {
    assert.throws(func() { a.isBefore("tomorrow"); }, "must be of type date");
    assert.throws(func() { a.isAfter(5); }, "must be of type date");
  });
});

describe("time: DateTime formatting and calendar helpers", func() {
  var d = time.DateTime(2024, 3, 15, 10, 30, 45, 123);

  test("default format", func() {
    assert.equal(d.format(), "2024-03-15 10:30:45");
  });

  test("format tokens", func() {
    assert.equal(d.format("YYYY/MM/DD"), "2024/03/15");
    assert.equal(d.format("D.M.YY H:m:s"), "15.3.24 10:30:45");
    assert.equal(d.format("HH:mm:ss.fff"), "10:30:45.123");
    assert.equal(d.format("YYYY-MM-DDTHH:mm:ss"), "2024-03-15T10:30:45");
  });

  test("start of period", func() {
    assert.equal(d.startOfDay().format(), "2024-03-15 00:00:00");
    assert.equal(d.startOfMonth().format("YYYY-MM-DD"), "2024-03-01");
    assert.equal(d.startOfYear().format("YYYY-MM-DD HH:mm"), "2024-01-01 00:00");
  });

  test("start of week defaults to Monday and can start on Sunday", func() {
    assert.equal(d.startOfWeek().format("YYYY-MM-DD"), "2024-03-11");
    assert.equal(d.startOfWeek(0).format("YYYY-MM-DD"), "2024-03-10");
  });

  test("end of day", func() {
    assert.equal(d.endOfDay().format("HH:mm:ss.fff"), "23:59:59.999");
  });

  test("leap years", func() {
    assert.isTrue(time.DateTime(2024, 1, 1).isLeapYear());
    assert.isTrue(time.DateTime(2000, 1, 1).isLeapYear());
    assert.isFalse(time.DateTime(2023, 1, 1).isLeapYear());
    assert.isFalse(time.DateTime(1900, 1, 1).isLeapYear());
  });

  test("weekend and weekday", func() {
    assert.isFalse(d.isWeekend());
    assert.isTrue(d.isWeekday());
    assert.isTrue(time.DateTime(2024, 3, 16).isWeekend());
    assert.isTrue(time.DateTime(2024, 3, 17).isWeekend());
    assert.isFalse(time.DateTime(2024, 3, 17).isWeekday());
  });
});

describe("time: Duration", func() {
  var d = time.Duration({ days: 1, hours: 2, minutes: 3, seconds: 4, milliseconds: 500 });

  test("built from an object", func() {
    assert.equal(d.totalMilliseconds, 93784500);
    assert.equal(d.totalSeconds, 93784.5);
    assert.closeTo(d.totalMinutes, 1563.075);
    assert.closeTo(d.totalHours, 26.05125);
    assert.closeTo(d.totalDays, 1.08546875);
  });

  test("components", func() {
    assert.equal(d.days(), 1);
    assert.equal(d.hours(), 2);
    assert.equal(d.minutes(), 3);
    assert.equal(d.seconds(), 4);
    assert.equal(d.milliseconds(), 500);
  });

  test("built from milliseconds", func() {
    var x = time.Duration(90061001);
    assert.equal(x.days(), 1);
    assert.equal(x.hours(), 1);
    assert.equal(x.minutes(), 1);
    assert.equal(x.seconds(), 1);
    assert.equal(x.milliseconds(), 1);
  });

  test("zero by default", func() {
    assert.equal(time.Duration().totalMilliseconds, 0);
    assert.isTrue(time.Duration(0).isZero());
  });

  test("add and subtract accept durations or milliseconds", func() {
    var a = time.Duration(1000);
    assert.equal(a.add(time.Duration(500)).totalMilliseconds, 1500);
    assert.equal(a.add(250).totalMilliseconds, 1250);
    assert.equal(a.subtract(time.Duration(400)).totalMilliseconds, 600);
    assert.equal(a.subtract(1500).totalMilliseconds, -500);
  });

  test("multiply and divide", func() {
    var a = time.Duration(1000);
    assert.equal(a.multiply(3).totalMilliseconds, 3000);
    assert.equal(a.divide(4).totalMilliseconds, 250);
  });

  test("dividing by zero is an error", func() {
    assert.throws(func() { time.Duration(1).divide(0); }, "Division by zero");
  });

  test("comparison", func() {
    var a = time.Duration(1000);
    var b = time.Duration(2000);
    assert.isTrue(a.isEqual(time.Duration(1000)));
    assert.isTrue(a.isEqual(1000));
    assert.isFalse(a.isEqual(b));
    assert.isTrue(a.isLessThan(b));
    assert.isFalse(b.isLessThan(a));
    assert.isTrue(b.isGreaterThan(a));
    assert.isFalse(a.isGreaterThan(1500));
  });

  test("sign helpers", func() {
    assert.isTrue(time.Duration(5).isPositive());
    assert.isTrue(time.Duration(-5).isNegative());
    assert.isFalse(time.Duration(5).isNegative());
    assert.equal(time.Duration(-5).abs().totalMilliseconds, 5);
    assert.equal(time.Duration(5).negate().totalMilliseconds, -5);
  });

  test("components of a negative duration are absolute values", func() {
    var x = time.Duration(-90000);
    assert.equal(x.minutes(), 1);
    assert.equal(x.seconds(), 30);
  });

  test("format", func() {
    var x = time.Duration({ hours: 1, minutes: 5, seconds: 9, milliseconds: 7 });
    assert.equal(x.format(), "01:05:09");
    assert.equal(x.format("HH:mm:ss.fff"), "01:05:09.007");
    assert.equal(x.format("H:m:s"), "1:5:9");
    assert.equal(time.Duration(-61000).format("mm:ss"), "-01:01");
  });

  test("toString", func() {
    assert.equal(time.Duration(0).toString(), "0s");
    assert.equal(time.Duration(90061001).toString(), "1d 1h 1m 1.001s");
    assert.equal(time.Duration(3600000).toString(), "1h");
    assert.equal(time.Duration(1500).toString(), "1.500s");
    assert.equal(time.Duration(-60000).toString(), "-1m");
  });

  test("validation", func() {
    assert.throws(func() { time.Duration("x"); }, "must be of type int");
    assert.throws(func() { time.Duration(1).add("x"); }, "must be of type int");
  });
});

describe("time: Stopwatch", func() {
  test("a new stopwatch is idle", func() {
    var sw = time.Stopwatch();
    assert.isFalse(sw.isRunning());
    assert.equal(sw.elapsed(), 0);
    assert.equal(sw.splits(), []);
    assert.isNil(sw.lastSplit());
  });

  test("start, elapsed and stop", func() {
    var sw = time.Stopwatch();
    assert.isTrue(sw.start());
    wait spawn time.Sleep(30);
    assert.isTrue(sw.isRunning());
    assert.greaterOrEqual(sw.elapsed(), 25);
    assert.isTrue(sw.stop());
    var frozen = sw.elapsed();
    wait spawn time.Sleep(20);
    assert.equal(sw.elapsed(), frozen);
    assert.isFalse(sw.isRunning());
  });

  test("start and stop report when nothing changed", func() {
    var sw = time.Stopwatch();
    sw.start();
    assert.isFalse(sw.start());
    sw.stop();
    assert.isFalse(sw.stop());
  });

  test("elapsedSeconds", func() {
    var sw = time.Stopwatch();
    sw.start();
    wait spawn time.Sleep(20);
    assert.greater(sw.elapsedSeconds(), 0);
    assert.less(sw.elapsedSeconds(), 5);
  });

  test("splits record cumulative elapsed times", func() {
    var sw = time.Stopwatch();
    sw.start();
    wait spawn time.Sleep(15);
    var s1 = sw.split();
    wait spawn time.Sleep(15);
    var s2 = sw.split();
    assert.greater(s1, 0);
    assert.greater(s2, s1);
    var splits = sw.splits();
    assert.lengthOf(splits, 2);
    assert.equal(splits[0].elapsed, s1);
    assert.equal(splits[1].elapsed, s2);
    assert.equal(sw.lastSplit().elapsed, s2);
  });

  test("split statistics", func() {
    var sw = time.Stopwatch();
    sw.start();
    wait spawn time.Sleep(10);
    sw.split();
    wait spawn time.Sleep(30);
    sw.split();
    wait spawn time.Sleep(10);
    sw.split();
    assert.greater(sw.averageSplitTime(), 0);
    assert.greater(sw.slowestSplit().time, sw.fastestSplit().time);
    assert.equal(sw.slowestSplit().splitIndex, 1);
  });

  test("statistics need at least two splits", func() {
    var sw = time.Stopwatch();
    assert.equal(sw.averageSplitTime(), 0);
    assert.isNil(sw.fastestSplit());
    assert.isNil(sw.slowestSplit());
  });

  test("splitTime is the time since the last split", func() {
    var sw = time.Stopwatch();
    assert.equal(sw.splitTime(), 0);
    sw.start();
    sw.split();
    wait spawn time.Sleep(20);
    assert.greaterOrEqual(sw.splitTime(), 15);
  });

  test("reset clears everything", func() {
    var sw = time.Stopwatch();
    sw.start();
    sw.split();
    sw.reset();
    assert.isFalse(sw.isRunning());
    assert.equal(sw.elapsed(), 0);
    assert.equal(sw.splits(), []);
  });

  test("restart begins again from zero", func() {
    var sw = time.Stopwatch();
    sw.start();
    wait spawn time.Sleep(40);
    sw.restart();
    assert.isTrue(sw.isRunning());
    assert.less(sw.elapsed(), 30);
  });

  test("waitFor suspends until the elapsed time is reached", func() {
    var sw = time.Stopwatch();
    sw.start();
    var reached = sw.waitFor(40);
    assert.greaterOrEqual(reached, 40);
  });

  test("onInterval fires repeatedly until cleared", func() {
    var sw = time.Stopwatch();
    sw.start();
    var ticks = 0;
    var id = sw.onInterval(func() { ticks++; }, 20);
    wait spawn time.Sleep(110);
    sw.clearInterval(id);
    var seen = ticks;
    assert.greaterOrEqual(seen, 3);
    wait spawn time.Sleep(50);
    assert.equal(ticks, seen);
  });

  test("clearAllIntervals stops every interval", func() {
    var sw = time.Stopwatch();
    sw.start();
    var ticks = 0;
    sw.onInterval(func() { ticks++; }, 15);
    sw.onInterval(func() { ticks++; }, 15);
    wait spawn time.Sleep(40);
    sw.clearAllIntervals();
    var seen = ticks;
    assert.greater(seen, 0);
    wait spawn time.Sleep(50);
    assert.equal(ticks, seen);
  });

  test("format and toString produce text", func() {
    var sw = time.Stopwatch();
    assert.equal(sw.format("mm:ss.fff"), "00:00.000");
    assert.typeOf(sw.toString(), "string");
  });
});

describe("time: Sleep and Delay", func() {
  test("Sleep suspends for about the requested time", func() {
    var start = time.now();
    wait spawn time.Sleep(40);
    var elapsed = time.now() - start;
    assert.greaterOrEqual(elapsed, 35);
    assert.less(elapsed, 300);
  });

  test("Sleep validates its argument", func() {
    assert.throws(func() { time.Sleep(-1); }, "cannot be negative");
    assert.throws(func() { time.Sleep("x"); }, "must be of type int");
  });

  test("Sleep only suspends the calling task", func() {
    var log = [];
    var other = spawn { log[length(log)] = "other ran"; };
    wait spawn time.Sleep(10);
    assert.equal(log, ["other ran"]);
    wait other;
  });

  test("Delay runs the callback after the delay and returns its result", func() {
    var hits = 0;
    var d = time.Delay(func() { hits++; return "done"; }, 20);
    var h = d.start();
    assert.equal(hits, 0);
    var r = wait h;
    assert.equal(hits, 1);
    assert.equal(r.result, "done");
    assert.equal(r.status, "fulfilled");
  });

  test("a delay can be cancelled before it fires", func() {
    var hits = 0;
    var d = time.Delay(func() { hits++; }, 50);
    d.start();
    assert.isTrue(d.cancel());
    wait spawn time.Sleep(80);
    assert.equal(hits, 0);
    assert.isFalse(d.cancel());
  });
});

describe("time: Debounce and Throttle", func() {
  test("debounce runs once with the latest arguments", func() {
    var calls = [];
    var db = time.Debounce(func(x) { calls[length(calls)] = x; }, 30);
    db.execute(1);
    db.execute(2);
    db.execute(3);
    assert.isTrue(db.pending());
    wait spawn time.Sleep(80);
    assert.equal(calls, [3]);
    assert.isFalse(db.pending());
  });

  test("debounce can be cancelled", func() {
    var calls = [];
    var db = time.Debounce(func(x) { calls[length(calls)] = x; }, 30);
    db.execute(1);
    assert.isTrue(db.cancel());
    wait spawn time.Sleep(60);
    assert.equal(calls, []);
    assert.isFalse(db.cancel());
  });

  test("flush runs the pending call immediately with its arguments", func() {
    var calls = [];
    var db = time.Debounce(func(x) { calls[length(calls)] = x; }, 500);
    db.execute(7);
    assert.isTrue(db.flush());
    wait spawn time.Sleep(20);
    assert.equal(calls, [7]);
    assert.isFalse(db.flush());
  });

  test("immediate debounce fires on the leading edge only", func() {
    var calls = [];
    var db = time.Debounce(func(x) { calls[length(calls)] = x; }, 30, true);
    db.execute(1);
    db.execute(2);
    wait spawn time.Sleep(60);
    assert.equal(calls, [1]);
  });

  test("throttle runs at most once per window, plus a trailing call", func() {
    var calls = [];
    var th = time.Throttle(func(x) { calls[length(calls)] = x; }, 50);
    th.execute(1);
    th.execute(2);
    th.execute(3);
    wait spawn time.Sleep(10);
    assert.equal(calls, [1]);
    wait spawn time.Sleep(100);
    assert.equal(calls, [1, 3]);
  });

  test("a pending throttled call can be cancelled", func() {
    var calls = [];
    var th = time.Throttle(func(x) { calls[length(calls)] = x; }, 80);
    th.execute(1);
    th.execute(2);
    assert.isTrue(th.cancel());
    wait spawn time.Sleep(120);
    assert.equal(calls, [1]);
  });

  test("validation", func() {
    assert.throws(func() { time.Debounce(5, 10); }, "must be of type function");
    assert.throws(func() { time.Throttle(5, 10); }, "must be of type function");
  });
});

describe("time: Interval and Timeout", func() {
  test("an interval ticks with an execution counter", func() {
    var ticks = [];
    var iv = time.Interval(func(n) { ticks[length(ticks)] = n; }, 20);
    assert.isTrue(iv.start());
    assert.isFalse(iv.start());
    wait spawn time.Sleep(110);
    assert.isTrue(iv.isRunning());
    assert.isTrue(iv.stop());
    var count = iv.executionCount();
    assert.greaterOrEqual(count, 3);
    assert.equal(length(ticks), count);
    assert.equal(ticks[0], 1);
    assert.equal(ticks[1], 2);
    wait spawn time.Sleep(50);
    assert.equal(length(ticks), count);
    assert.isFalse(iv.isRunning());
    assert.isFalse(iv.stop());
  });

  test("reset stops the interval and clears the counter", func() {
    var iv = time.Interval(func(n) {}, 15);
    iv.start();
    wait spawn time.Sleep(50);
    iv.reset();
    assert.isFalse(iv.isRunning());
    assert.equal(iv.executionCount(), 0);
  });

  test("a timeout fires once", func() {
    var hits = 0;
    var t = time.Timeout(func() { hits++; }, 20);
    assert.isTrue(t.isPending() == false);
    assert.isTrue(t.start());
    assert.isTrue(t.isPending());
    assert.isFalse(t.start());
    wait spawn time.Sleep(70);
    assert.equal(hits, 1);
    assert.isTrue(t.hasExecuted());
    assert.isFalse(t.isPending());
  });

  test("a timeout can be cancelled", func() {
    var hits = 0;
    var t = time.Timeout(func() { hits++; }, 50);
    t.start();
    assert.isTrue(t.cancel());
    assert.isTrue(t.isCancelled());
    wait spawn time.Sleep(80);
    assert.equal(hits, 0);
    assert.isFalse(t.hasExecuted());
    assert.isFalse(t.start());
  });
});

describe("time: TimeZone", func() {
  var utc = time.TimeZone("UTC");

  test("name and offsets of UTC", func() {
    assert.equal(utc.name(), "UTC");
    assert.equal(utc.offsetHours(), 0);
    assert.equal(utc.offsetString(), "+00:00");
    assert.equal(utc.abbreviation(), "UTC");
    assert.equal(utc.longName(), "Coordinated Universal Time");
  });

  test("a named zone reports its own name", func() {
    assert.equal(time.TimeZone("Europe/London").name(), "Europe/London");
    assert.isTrue(time.TimeZone("Europe/London").isValid());
  });

  test("daylight saving depends on the date", func() {
    var london = time.TimeZone("Europe/London");
    assert.isTrue(london.isDST(time.DateTime("2024-07-01T12:00:00Z")));
    assert.isFalse(london.isDST(time.DateTime("2024-01-01T12:00:00Z")));
    assert.isFalse(utc.isDST(time.DateTime("2024-07-01T12:00:00Z")));
  });

  test("format renders a date in the zone", func() {
    var d = time.DateTime("2024-01-01T12:00:00Z");
    assert.equal(utc.format(d), "01/01/2024, 12:00:00 PM");
    assert.equal(utc.format(d, { hour12: false }), "01/01/2024, 12:00:00");
    assert.equal(time.TimeZone("Asia/Tokyo").format(d), "01/01/2024, 09:00:00 PM");
  });

  test("compare reports the difference between zones", func() {
    var c = utc.compare("America/New_York");
    assert.equal(c.differenceHours, 5);
    assert.isTrue(c.ahead);
    assert.isFalse(c.behind);
    assert.isTrue(utc.compare("UTC").same);
  });

  test("convert returns a DateTime", func() {
    var d = time.DateTime("2024-01-01T12:00:00Z");
    var converted = utc.convert(d, "Asia/Tokyo");
    assert.typeOf(converted, "object");
    assert.typeOf(converted.year(), "int");
  });

  test("now returns a DateTime", func() {
    assert.typeOf(utc.now(), "object");
  });

  test("an unknown zone is rejected", func() {
    assert.throws(func() { time.TimeZone("Not/AZone"); }, "Invalid timezone");
  });
});

describe("time: TimeZones", func() {
  var zones = time.TimeZones();

  test("list contains the IANA zones", func() {
    var all = zones.list();
    assert.typeOf(all, "array");
    assert.greater(length(all), 100);
    assert.includes(all, "Europe/London");
  });

  test("common maps abbreviations to zones", func() {
    var common = zones.common();
    assert.typeOf(common, "object");
    assert.isTrue("UTC" in common);
    assert.isTrue("JST" in common);
  });

  test("get, utc and local return zones", func() {
    assert.equal(zones.get("UTC").name(), "UTC");
    assert.equal(zones.utc().name(), "UTC");
    assert.typeOf(zones.local().name(), "string");
  });

  test("findByOffset returns zone names", func() {
    var found = zones.findByOffset(0);
    assert.typeOf(found, "array");
    assert.greater(length(found), 0);
    assert.typeOf(found[0], "string");
  });
});

describe("time: TimeUtils", func() {
  var u = time.TimeUtils();

  test("now, timestamp and microtime", func() {
    assert.greater(u.now(), 1700000000000);
    assert.greater(u.timestamp(), 1700000000);
    assert.typeOf(u.microtime(), "float");
    assert.equal(time.now() / 1000000000000 > 1, true);
  });

  test("parse an ISO string", func() {
    assert.equal(u.parse("2024-03-15T10:30:00Z").toISOString(), "2024-03-15T10:30:00.000Z");
  });

  test("parse a number: seconds or milliseconds", func() {
    assert.equal(u.parse(86400).toISOString(), "1970-01-02T00:00:00.000Z");
    assert.equal(u.parse(86400000000).toISOString(), "1972-09-27T00:00:00.000Z");
  });

  test("parse with a format follows the token order in the text", func() {
    assert.equal(
      u.parse("15/03/2024 10:30:45", "DD/MM/YYYY HH:mm:ss").format(),
      "2024-03-15 10:30:45"
    );
    assert.equal(
      u.parse("2024-03-15", "YYYY-MM-DD").format("YYYY-MM-DD HH:mm"),
      "2024-03-15 00:00"
    );
    assert.equal(u.parse("03.15.24", "MM.DD.YY").format("YYYY-MM-DD"), "2024-03-15");
    assert.equal(u.parse("10:30", "HH:mm").format("HH:mm"), "10:30");
  });

  test("parse rejects text that does not match the format", func() {
    assert.throws(func() { u.parse("2024/03/15", "DD-MM-YYYY"); }, "doesn't match format");
  });

  test("parse rejects invalid input", func() {
    assert.throws(func() { u.parse("nonsense"); }, "Invalid date string");
    assert.throws(func() { u.parse(true); }, "string or number");
  });

  test("format", func() {
    var d = time.DateTime(2024, 3, 15, 10, 30, 45);
    assert.equal(u.format(d, "YYYY-MM-DD"), "2024-03-15");
    assert.equal(u.format(d, "HH:mm:ss"), "10:30:45");
    assert.typeOf(u.format(d), "string");
  });

  test("fromNow describes the past and the future", func() {
    var now = time.DateTime();
    assert.equal(u.fromNow(now.addHours(-3)), "3 hours ago");
    assert.equal(u.fromNow(now.addDays(-2)), "2 days ago");
    assert.equal(u.fromNow(now.addMinutes(-1)), "1 minute ago");
    assert.equal(u.fromNow(now.addDays(2).addMinutes(1)), "in 2 days");
    assert.equal(u.fromNow(now), "just now");
  });

  test("toNow describes the time left", func() {
    var now = time.DateTime();
    assert.equal(u.toNow(now.addHours(3).addMinutes(1)), "3 hours");
    assert.equal(u.toNow(now.addDays(-1)), "now");
  });

  test("diff in different units", func() {
    var a = time.DateTime(2024, 3, 15);
    var b = time.DateTime(2024, 3, 10);
    assert.equal(u.diff(a, b), 432000000);
    assert.equal(u.diff(a, b, "days"), 5);
    assert.equal(u.diff(a, b, "hours"), 120);
    assert.closeTo(u.diff(a, b, "weeks"), 0.7142857142857143);
    assert.equal(u.diff(b, a, "d"), -5);
    assert.equal(u.diff(a, time.DateTime(2023, 1, 15), "months"), 14);
    assert.equal(u.diff(a, time.DateTime(2020, 1, 1), "years"), 4);
  });

  test("diff rejects an unknown unit", func() {
    assert.throws(func() { u.diff(time.DateTime(), time.DateTime(), "parsecs"); }, "Invalid unit");
  });

  test("isValid", func() {
    assert.isTrue(u.isValid(time.DateTime()));
    assert.isFalse(u.isValid("x"));
    assert.isFalse(u.isValid(5));
    assert.isFalse(u.isValid(nil));
  });

  test("isSame at several granularities", func() {
    var a = time.DateTime(2024, 3, 15, 10, 30);
    var b = time.DateTime(2024, 3, 15, 18, 0);
    var c = time.DateTime(2024, 4, 1);
    assert.isTrue(u.isSame(a, b, "day"));
    assert.isFalse(u.isSame(a, b, "hour"));
    assert.isFalse(u.isSame(a, c, "month"));
    assert.isTrue(u.isSame(a, c, "year"));
    assert.isTrue(u.isSame(a, a.clone()));
    assert.isFalse(u.isSame(a, b, "minute"));
  });

  test("startOf", func() {
    var a = time.DateTime(2024, 3, 15, 10, 30, 45, 123);
    assert.equal(u.startOf(a, "year").format(), "2024-01-01 00:00:00");
    assert.equal(u.startOf(a, "month").format(), "2024-03-01 00:00:00");
    assert.equal(u.startOf(a, "week").format("YYYY-MM-DD"), "2024-03-11");
    assert.equal(u.startOf(a, "day").format(), "2024-03-15 00:00:00");
    assert.equal(u.startOf(a, "hour").format(), "2024-03-15 10:00:00");
    assert.equal(u.startOf(a, "minute").format(), "2024-03-15 10:30:00");
    assert.equal(u.startOf(a, "second").format("HH:mm:ss.fff"), "10:30:45.000");
  });

  test("endOf", func() {
    var a = time.DateTime(2024, 3, 15, 10, 30, 45, 123);
    assert.equal(u.endOf(a, "year").format("YYYY-MM-DD HH:mm:ss.fff"), "2024-12-31 23:59:59.999");
    assert.equal(u.endOf(a, "month").format("YYYY-MM-DD HH:mm:ss"), "2024-03-31 23:59:59");
    assert.equal(u.endOf(a, "week").format("YYYY-MM-DD"), "2024-03-17");
    assert.equal(u.endOf(a, "day").format("HH:mm:ss.fff"), "23:59:59.999");
    assert.equal(u.endOf(a, "hour").format("HH:mm:ss"), "10:59:59");
    assert.equal(u.endOf(a, "minute").format("HH:mm:ss"), "10:30:59");
    assert.equal(u.endOf(a, "second").format("HH:mm:ss.fff"), "10:30:45.999");
  });

  test("startOf and endOf reject an unknown unit", func() {
    assert.throws(func() { u.startOf(time.DateTime(), "decade"); }, "Invalid unit");
    assert.throws(func() { u.endOf(time.DateTime(), "decade"); }, "Invalid unit");
  });

  test("results of startOf are DateTime objects", func() {
    var s = u.startOf(time.DateTime(2024, 3, 15, 10), "day");
    assert.equal(s.year(), 2024);
    assert.isTrue(s.isBefore(time.DateTime(2024, 3, 15, 10)));
  });

  test("measure times a function and returns its result", func() {
    var m = u.measure(func() { wait spawn time.Sleep(20); return 5; }, "work");
    assert.equal(m.result, 5);
    assert.equal(m.label, "work");
    assert.greaterOrEqual(m.duration, 15);
    assert.greater(m.end, m.start);
  });

  test("convert between time units", func() {
    assert.equal(u.convert(1, "hours", "minutes"), 60);
    assert.equal(u.convert(90, "minutes", "hours"), 1.5);
    assert.equal(u.convert(2, "days", "hours"), 48);
    assert.equal(u.convert(1500, "ms", "seconds"), 1.5);
    assert.equal(u.convert(1, "weeks", "days"), 7);
  });

  test("convert rejects unknown units", func() {
    assert.throws(func() { u.convert(1, "x", "y"); }, "Invalid from unit");
  });
});

finish("time");
