import "core:test" as { describe, test, assert, finish };
import "events";
import "time";

describe("events: EventEmitter", func() {
  test("on and emit pass the arguments to the listener", func() {
    var e = events.EventEmitter();
    var got = [];
    e.on("greet", func(a, b) { got[length(got)] = [a, b]; });
    assert.isTrue(e.emit("greet", 1, 2));
    assert.equal(got, [[1, 2]]);
  });

  test("emit returns false when nobody listens", func() {
    assert.isFalse(events.EventEmitter().emit("nobody"));
  });

  test("registration methods are chainable on the same emitter", func() {
    var e = events.EventEmitter();
    var log = [];
    e.on("a", func() { log[length(log)] = "a"; })
      .on("b", func() { log[length(log)] = "b"; })
      .once("c", func() { log[length(log)] = "c"; });
    e.emit("a");
    e.emit("b");
    e.emit("c");
    e.emit("c");
    assert.equal(log, ["a", "b", "c"]);
  });

  test("listeners run in registration order; prependListener goes first", func() {
    var e = events.EventEmitter();
    var log = [];
    e.on("x", func() { log[length(log)] = 1; });
    e.on("x", func() { log[length(log)] = 2; });
    e.prependListener("x", func() { log[length(log)] = 0; });
    e.emit("x");
    assert.equal(log, [0, 1, 2]);
  });

  test("once runs a single time", func() {
    var e = events.EventEmitter();
    var n = 0;
    e.once("x", func() { n++; });
    e.emit("x");
    e.emit("x");
    assert.equal(n, 1);
    assert.equal(e.listenerCount("x"), 0);
  });

  test("prependOnceListener runs first and only once", func() {
    var e = events.EventEmitter();
    var log = [];
    e.on("x", func() { log[length(log)] = "on"; });
    e.prependOnceListener("x", func() { log[length(log)] = "first-once"; });
    e.emit("x");
    e.emit("x");
    assert.equal(log, ["first-once", "on", "on"]);
  });

  test("off and removeListener remove one listener", func() {
    var e = events.EventEmitter();
    var n = 0;
    var f = func() { n++; };
    e.on("x", f);
    e.emit("x");
    e.off("x", f);
    e.emit("x");
    assert.equal(n, 1);
    var m = 0;
    var g = func() { m++; };
    e.on("y", g);
    e.removeListener("y", g);
    e.emit("y");
    assert.equal(m, 0);
  });

  test("off without a listener removes every listener of the event", func() {
    var e = events.EventEmitter();
    e.on("x", func() {});
    e.on("x", func() {});
    e.off("x");
    assert.equal(e.listenerCount("x"), 0);
  });

  test("removeAllListeners for one event or for all", func() {
    var e = events.EventEmitter();
    e.on("x", func() {});
    e.on("y", func() {});
    e.removeAllListeners("x");
    assert.equal(e.eventNames(), ["y"]);
    e.removeAllListeners();
    assert.equal(e.eventNames(), []);
  });

  test("listeners, rawListeners and listenerCount", func() {
    var e = events.EventEmitter();
    e.on("x", func() {});
    assert.lengthOf(e.listeners("x"), 1);
    assert.lengthOf(e.rawListeners("x"), 1);
    assert.lengthOf(e.listeners("none"), 0);
    assert.equal(e.listenerCount("x"), 1);
    assert.equal(e.listenerCount("none"), 0);
  });

  test("eventNames lists events that still have listeners", func() {
    var e = events.EventEmitter();
    e.on("a", func() {});
    e.on("b", func() {});
    e.once("c", func() {});
    e.emit("c");
    assert.equal(e.eventNames(), ["a", "b"]);
  });

  test("max listeners", func() {
    var e = events.EventEmitter();
    assert.equal(e.getMaxListeners(), 10);
    e.setMaxListeners(3);
    assert.equal(e.getMaxListeners(), 3);
  });

  test("a listener removing another during emit does not skip anyone", func() {
    var e = events.EventEmitter();
    var log = [];
    var f = func() { log[length(log)] = "f"; };
    e.on("x", func() { e.off("x", f); log[length(log)] = "g"; });
    e.on("x", f);
    e.emit("x");
    e.emit("x");
    assert.equal(log, ["g", "f", "g"]);
  });

  test("emitting from inside a listener", func() {
    var e = events.EventEmitter();
    var log = [];
    e.on("a", func() { log[length(log)] = "a1"; e.emit("b"); log[length(log)] = "a2"; });
    e.on("b", func() { log[length(log)] = "b"; });
    e.emit("a");
    assert.equal(log, ["a1", "b", "a2"]);
  });

  test("emitters are independent", func() {
    var a = events.EventEmitter();
    var b = events.EventEmitter();
    var n = 0;
    a.on("x", func() { n++; });
    b.emit("x");
    a.emit("x");
    assert.equal(n, 1);
  });

  test("an error in a listener is raised to the emitter's caller", func() {
    var e = events.EventEmitter();
    e.on("x", func() { throw "boom"; });
    assert.throws(func() { e.emit("x"); }, "boom");
  });

  test("validation", func() {
    assert.throws(func() { events.EventEmitter().on(5, func() {}); }, "must be of type string");
    assert.throws(func() { events.EventEmitter().on("x", 5); }, "must be of type function");
  });
});

describe("events: EventBus", func() {
  test("listeners receive an event object", func() {
    var bus = events.EventBus();
    var got = [];
    bus.on("user.login", func(ev) { got[length(got)] = [ev.name, ev.data, ev.namespace]; });
    assert.isTrue(bus.emit("user.login", { id: 7 }));
    assert.equal(got, [["user.login", { id: 7 }, "default"]]);
  });

  test("the event object fields", func() {
    var bus = events.EventBus();
    var keys = [];
    bus.on("e", func(ev) { for (var k in ev) { keys[length(keys)] = k; } });
    bus.emit("e", 1);
    assert.equal(
      keys,
      ["name", "data", "timestamp", "namespace", "preventDefault", "stopPropagation"]
    );
  });

  test("on is chainable", func() {
    var bus = events.EventBus();
    var log = [];
    bus.on("a", func() { log[length(log)] = "a"; }).on("b", func() { log[length(log)] = "b"; });
    bus.emit("a");
    bus.emit("b");
    assert.equal(log, ["a", "b"]);
  });

  test("wildcard patterns", func() {
    var bus = events.EventBus();
    var log = [];
    bus.on("user.*", func(ev) { log[length(log)] = "user:" + ev.name; });
    bus.on("*", func(ev) { log[length(log)] = "all:" + ev.name; });
    bus.emit("user.login");
    bus.emit("order.created");
    assert.equal(log, ["user:user.login", "all:user.login", "all:order.created"]);
  });

  test("exact patterns match only that name", func() {
    var bus = events.EventBus();
    var n = 0;
    bus.on("a.b", func() { n++; });
    bus.emit("a.c");
    bus.emit("a.b");
    bus.emit("a.b.c");
    assert.equal(n, 1);
  });

  test("once", func() {
    var bus = events.EventBus();
    var n = 0;
    bus.once("x", func() { n++; });
    bus.emit("x");
    bus.emit("x");
    assert.equal(n, 1);
  });

  test("higher priority runs first", func() {
    var bus = events.EventBus();
    var log = [];
    bus.on("x", func() { log[length(log)] = "low"; }, { priority: 1 });
    bus.on("x", func() { log[length(log)] = "high"; }, { priority: 10 });
    bus.on("x", func() { log[length(log)] = "mid"; }, { priority: 5 });
    bus.emit("x", nil, { sync: true });
    assert.equal(log, ["high", "mid", "low"]);
  });

  test("namespaces keep listeners apart", func() {
    var bus = events.EventBus();
    var log = [];
    bus.on("x", func() { log[length(log)] = "default"; });
    bus.on("x", func() { log[length(log)] = "custom"; }, { namespace: "custom" });
    bus.emit("x");
    bus.emit("x", nil, { namespace: "custom" });
    assert.equal(log, ["default", "custom"]);
    assert.equal(bus.getNamespaces(), ["default", "custom"]);
    assert.equal(bus.getEvents(), ["x"]);
    assert.equal(bus.getEvents("custom"), ["x"]);
    assert.equal(bus.getEvents("missing"), []);
  });

  test("off removes one listener or every listener of a pattern", func() {
    var bus = events.EventBus();
    var n = 0;
    var f = func() { n++; };
    bus.on("x", f);
    bus.emit("x");
    bus.off("x", f);
    bus.emit("x");
    assert.equal(n, 1);
    bus.on("y", func() { n += 10; });
    bus.on("y", func() { n += 10; });
    bus.off("y");
    bus.emit("y");
    assert.equal(n, 1);
    assert.equal(bus.getEvents(), ["x"]);
  });

  test("clearNamespace drops a whole namespace", func() {
    var bus = events.EventBus();
    var n = 0;
    bus.on("x", func() { n++; }, { namespace: "a" });
    bus.clearNamespace("a");
    bus.emit("x", nil, { namespace: "a" });
    assert.equal(n, 0);
    assert.equal(bus.getEvents("a"), []);
  });

  test("middleware runs before the listeners", func() {
    var bus = events.EventBus();
    var log = [];
    bus.use(func(ev) { log[length(log)] = "mw:" + ev.name; });
    bus.on("x", func() { log[length(log)] = "listener"; });
    bus.emit("x");
    assert.equal(log, ["mw:x", "listener"]);
  });

  test("middleware can change the event data", func() {
    var bus = events.EventBus();
    var seen = [];
    bus.use(func(ev) { ev.data = ev.data * 2; });
    bus.on("x", func(ev) { seen[length(seen)] = ev.data; });
    bus.emit("x", 21);
    assert.equal(seen, [42]);
  });

  test("middleware can cancel an event with preventDefault", func() {
    var bus = events.EventBus();
    var n = 0;
    bus.use(func(ev) { if (ev.name == "blocked") { ev.preventDefault = true; } });
    bus.on("blocked", func() { n++; });
    bus.on("ok", func() { n += 10; });
    assert.isFalse(bus.emit("blocked"));
    assert.isTrue(bus.emit("ok"));
    assert.equal(n, 10);
  });

  test("removeMiddleware", func() {
    var bus = events.EventBus();
    var n = 0;
    var mw = func(ev) { n++; };
    bus.use(mw);
    bus.emit("a");
    bus.removeMiddleware(mw);
    bus.emit("a");
    assert.equal(n, 1);
  });

  test("stopPropagation stops lower-priority listeners (sync mode)", func() {
    var bus = events.EventBus();
    var log = [];
    bus.on(
      "x",
      func(ev) { log[length(log)] = "first"; ev.stopPropagation = true; },
      { priority: 2 }
    );
    bus.on("x", func() { log[length(log)] = "second"; }, { priority: 1 });
    bus.emit("x", nil, { sync: true });
    assert.equal(log, ["first"]);
  });

  test("history records emitted events", func() {
    var bus = events.EventBus();
    bus.emit("a", 1);
    bus.emit("b", 2);
    bus.emit("a", 3);
    var all = bus.getHistory();
    assert.lengthOf(all, 3);
    assert.equal(all[0].name, "a");
    assert.equal(all[0].data, 1);
    assert.lengthOf(bus.getHistory("a"), 2);
    var last = bus.getHistory("*", 1);
    assert.lengthOf(last, 1);
    assert.equal(last[0].data, 3);
  });

  test("history can be filtered with wildcards", func() {
    var bus = events.EventBus();
    bus.emit("user.a");
    bus.emit("user.b");
    bus.emit("other");
    assert.lengthOf(bus.getHistory("user.*"), 2);
  });

  test("setMaxHistory trims old entries; clearHistory empties it", func() {
    var bus = events.EventBus();
    bus.setMaxHistory(2);
    bus.emit("a", 1);
    bus.emit("b", 2);
    bus.emit("c", 3);
    var h = bus.getHistory();
    assert.lengthOf(h, 2);
    assert.equal(h[0].name, "b");
    bus.clearHistory();
    assert.lengthOf(bus.getHistory(), 0);
  });

  test("a failing listener does not stop the others (sync mode)", func() {
    var bus = events.EventBus();
    var n = 0;
    bus.on("x", func() { throw "bad"; });
    bus.on("x", func() { n++; });
    assert.isTrue(bus.emit("x", nil, { sync: true }));
    assert.equal(n, 1);
  });

  test("by default listeners run concurrently and emit waits for all of them", func() {
    var bus = events.EventBus();
    var log = [];
    bus.on("x", func() { time.Sleep(30); log[length(log)] = "slow"; });
    bus.on("x", func() { log[length(log)] = "fast"; });
    bus.emit("x");
    assert.equal(log, ["fast", "slow"]);
  });

  test("validation", func() {
    assert.throws(func() { events.EventBus().on(5, func() {}); }, "must be of type string");
    assert.throws(func() { events.EventBus().use(5); }, "must be of type function");
  });
});

describe("events: EventDispatcher", func() {
  test("dispatchEvent calls listeners with a DOM-like event", func() {
    var d = events.EventDispatcher();
    var got = [];
    d.addEventListener(
      "click",
      func(ev) { got[length(got)] = [ev.type, ev.cancelable, ev.bubbles]; }
    );
    assert.isTrue(d.dispatchEvent("click"));
    assert.equal(got, [["click", false, false]]);
  });

  test("addEventListener is chainable", func() {
    var d = events.EventDispatcher();
    var log = [];
    d.addEventListener(
      "a",
      func() { log[length(log)] = "a"; }
    ).addEventListener("b", func() { log[length(log)] = "b"; });
    d.dispatchEvent("a");
    d.dispatchEvent("b");
    assert.equal(log, ["a", "b"]);
  });

  test("an event object carries its own fields", func() {
    var d = events.EventDispatcher();
    var got = [];
    d.addEventListener(
      "move",
      func(ev) { got[length(got)] = [ev.type, ev.x, ev.y, ev.cancelable]; }
    );
    d.dispatchEvent({ type: "move", x: 1, y: 2 });
    assert.equal(got, [["move", 1, 2, false]]);
  });

  test("preventDefault works on cancelable events", func() {
    var d = events.EventDispatcher();
    d.addEventListener("x", func(ev) { ev.preventDefault(); });
    assert.isFalse(d.dispatchEvent({ type: "x", cancelable: true }));
  });

  test("preventDefault is ignored on events that are not cancelable", func() {
    var d = events.EventDispatcher();
    d.addEventListener("x", func(ev) { ev.preventDefault(); });
    assert.isTrue(d.dispatchEvent("x"));
  });

  test("stopPropagation stops later listeners", func() {
    var d = events.EventDispatcher();
    var log = [];
    d.addEventListener(
      "x",
      func(ev) { log[length(log)] = "first"; ev.stopPropagation(); },
      { priority: 5 }
    );
    d.addEventListener("x", func() { log[length(log)] = "second"; });
    d.dispatchEvent("x");
    assert.equal(log, ["first"]);
  });

  test("priority and once options", func() {
    var d = events.EventDispatcher();
    var log = [];
    d.addEventListener("x", func() { log[length(log)] = "low"; });
    d.addEventListener("x", func() { log[length(log)] = "high"; }, { priority: 9 });
    d.dispatchEvent("x");
    assert.equal(log, ["high", "low"]);
    var n = 0;
    d.addEventListener("y", func() { n++; }, { once: true });
    d.dispatchEvent("y");
    d.dispatchEvent("y");
    assert.equal(n, 1);
  });

  test("capture, main and after phases run in that order", func() {
    var d = events.EventDispatcher();
    var log = [];
    d.addEventListener("x", func() { log[length(log)] = "main"; });
    d.addEventListener("x", func() { log[length(log)] = "capture"; }, { capture: true });
    d.addAfterListener("x", func() { log[length(log)] = "after"; });
    d.dispatchEvent("x");
    assert.equal(log, ["capture", "main", "after"]);
  });

  test("a passive listener cannot prevent the default", func() {
    var d = events.EventDispatcher();
    var saw = [];
    d.addEventListener("x", func(ev) {
      try { ev.preventDefault(); saw[length(saw)] = "could"; } catch (e) { saw[length(saw)] = "cannot"; }
    }, { passive: true });
    d.dispatchEvent("x");
    assert.equal(saw, ["cannot"]);
  });

  test("removeEventListener (and its capture flag)", func() {
    var d = events.EventDispatcher();
    var n = 0;
    var f = func() { n++; };
    d.addEventListener("x", f);
    d.dispatchEvent("x");
    d.removeEventListener("x", f);
    d.dispatchEvent("x");
    assert.equal(n, 1);
    var m = 0;
    var g = func() { m++; };
    d.addEventListener("y", g, { capture: true });
    d.removeEventListener("y", g);
    d.dispatchEvent("y");
    assert.equal(m, 1);
    d.removeEventListener("y", g, { capture: true });
    d.dispatchEvent("y");
    assert.equal(m, 1);
  });

  test("hasEventListener", func() {
    var d = events.EventDispatcher();
    var f = func() {};
    d.addEventListener("x", f);
    d.addAfterListener("y", func() {});
    assert.isTrue(d.hasEventListener("x"));
    assert.isTrue(d.hasEventListener("x", f));
    assert.isFalse(d.hasEventListener("x", func() {}));
    assert.isFalse(d.hasEventListener("none"));
    assert.isTrue(d.hasEventListener("y"));
  });

  test("getEventListeners and getEventTypes", func() {
    var d = events.EventDispatcher();
    d.addEventListener("x", func() {});
    d.addEventListener("x", func() {}, { capture: true });
    d.addAfterListener("x", func() {});
    assert.lengthOf(d.getEventListeners("x"), 3);
    var other = events.EventDispatcher();
    other.addEventListener("a", func() {});
    other.addAfterListener("b", func() {});
    assert.equal(other.getEventTypes(), ["a", "b"]);
  });

  test("clearEventListeners for one type or all", func() {
    var d = events.EventDispatcher();
    var n = 0;
    d.addEventListener("x", func() { n++; });
    d.addEventListener("y", func() { n++; });
    d.clearEventListeners("x");
    d.dispatchEvent("x");
    d.dispatchEvent("y");
    assert.equal(n, 1);
    d.clearEventListeners();
    d.dispatchEvent("y");
    assert.equal(n, 1);
    assert.equal(d.getEventTypes(), []);
  });

  test("dispatchEvent rejects invalid events", func() {
    assert.throws(func() { events.EventDispatcher().dispatchEvent(5); }, "Event must be a string");
    assert.throws(
      func() { events.EventDispatcher().dispatchEvent({ a: 1 }); },
      "Event must be a string"
    );
  });
});

describe("events: Observable", func() {
  test("subscribers receive pushed values", func() {
    var o = events.Observable();
    var got = [];
    o.subscribe(func(v) { got[length(got)] = v; });
    o.next(1).next(2);
    assert.equal(got, [1, 2]);
    assert.equal(o.observerCount(), 1);
  });

  test("several subscribers each get every value", func() {
    var o = events.Observable();
    var a = [];
    var b = [];
    o.subscribe(func(v) { a[length(a)] = v; });
    o.subscribe(func(v) { b[length(b)] = v * 10; });
    o.next(1);
    o.next(2);
    assert.equal(a, [1, 2]);
    assert.equal(b, [10, 20]);
    assert.equal(o.observerCount(), 2);
  });

  test("unsubscribe stops delivery", func() {
    var o = events.Observable();
    var got = [];
    var sub = o.subscribe(func(v) { got[length(got)] = v; });
    o.next(1);
    sub.unsubscribe();
    o.next(2);
    assert.equal(got, [1]);
    assert.equal(o.observerCount(), 0);
  });

  test("an observer object with next, error and complete", func() {
    var o = events.Observable();
    var log = [];
    o.subscribe({
      next: func(v) { log[length(log)] = "n" + v; },
      error: func(e) { log[length(log)] = "e"; },
      complete: func() { log[length(log)] = "c"; }
    });
    o.next(1);
    o.complete();
    assert.equal(log, ["n1", "c"]);
    assert.isTrue(o.isCompleted());
  });

  test("positional error and complete handlers", func() {
    var o = events.Observable();
    var log = [];
    o.subscribe(
      func(v) { log[length(log)] = v; },
      func(e) { log[length(log)] = "err:" + e; },
      func() { log[length(log)] = "done"; }
    );
    o.next(1);
    o.error("bad");
    assert.equal(log, [1, "err:bad"]);
    assert.isTrue(o.hasError());
    assert.equal(o.getError(), "bad");
    assert.equal(o.observerCount(), 0);
  });

  test("after complete nothing more is delivered", func() {
    var o = events.Observable();
    var got = [];
    o.subscribe(func(v) { got[length(got)] = v; });
    o.next(1);
    o.complete();
    o.next(2);
    assert.equal(got, [1]);
    assert.isTrue(o.isCompleted());
    assert.equal(o.observerCount(), 0);
  });

  test("a late subscriber is told about completion or error immediately", func() {
    var done = events.Observable();
    done.complete();
    var log = [];
    done.subscribe(func(v) {}, nil, func() { log[length(log)] = "done"; });
    var failed = events.Observable();
    failed.error("boom");
    failed.subscribe(func(v) {}, func(e) { log[length(log)] = e; });
    time.Sleep(10);
    assert.includes(log, "done");
    assert.includes(log, "boom");
  });

  test("an exception in an observer goes to its error handler", func() {
    var o = events.Observable();
    var errors = [];
    o.subscribe(func(v) { throw "oops"; }, func(e) { errors[length(errors)] = e.message; });
    o.next(1);
    assert.equal(errors, ["oops"]);
  });

  test("map transforms values", func() {
    var o = events.Observable();
    var got = [];
    o.map(func(v) { return v * 2; }).subscribe(func(v) { got[length(got)] = v; });
    o.next(1).next(2).next(3);
    assert.equal(got, [2, 4, 6]);
  });

  test("filter keeps matching values", func() {
    var o = events.Observable();
    var got = [];
    o.filter(func(v) { return v % 2 == 0; }).subscribe(func(v) { got[length(got)] = v; });
    o.next(1).next(2).next(3).next(4);
    assert.equal(got, [2, 4]);
  });

  test("map and filter compose", func() {
    var o = events.Observable();
    var got = [];
    o.map(func(v) { return v * v; }).filter(func(v) { return v > 4; }).subscribe(func(v) { got[length(got)] = v; });
    o.next(1).next(2).next(3).next(4);
    assert.equal(got, [9, 16]);
  });

  test("a derived observable does not disturb the source's other subscribers", func() {
    var o = events.Observable();
    var raw = [];
    var mapped = [];
    o.subscribe(func(v) { raw[length(raw)] = v; });
    o.map(func(v) { return v + 100; }).subscribe(func(v) { mapped[length(mapped)] = v; });
    o.next(1);
    assert.equal(raw, [1]);
    assert.equal(mapped, [101]);
  });

  test("completion and errors flow through map", func() {
    var o = events.Observable();
    var log = [];
    var m = o.map(func(v) { return v; });
    m.subscribe(
      func(v) { log[length(log)] = v; },
      func(e) { log[length(log)] = "err"; },
      func() { log[length(log)] = "done"; }
    );
    o.next(1);
    o.complete();
    time.Sleep(10);
    assert.equal(log, [1, "done"]);
    assert.isTrue(m.isCompleted());
    var o2 = events.Observable();
    var errs = [];
    var m2 = o2.map(func(v) { return v; });
    m2.subscribe(func(v) {}, func(e) { errs[length(errs)] = e; });
    o2.error("bad");
    time.Sleep(10);
    assert.equal(errs, ["bad"]);
    assert.isTrue(m2.hasError());
  });

  test("an exception inside the mapper becomes an error of the derived observable", func() {
    var o = events.Observable();
    var errs = [];
    var m = o.map(func(v) { throw "mapfail"; });
    m.subscribe(func(v) {}, func(e) { errs[length(errs)] = e.message; });
    o.next(1);
    assert.equal(errs, ["mapfail"]);
    assert.isTrue(m.hasError());
  });

  test("pipe applies operators in order", func() {
    var o = events.Observable();
    var got = [];
    var out = o.pipe(
      func(src) { return src.map(func(v) { return v + 1; }); },
      func(src) { return src.filter(func(v) { return v > 2; }); }
    );
    out.subscribe(func(v) { got[length(got)] = v; });
    o.next(1).next(2).next(3);
    assert.equal(got, [3, 4]);
  });

  test("pipe without operators returns the same observable", func() {
    var o = events.Observable();
    assert.isTrue(o.pipe() == o);
  });

  test("validation", func() {
    assert.throws(func() { events.Observable().subscribe(5); }, "must be of type function");
    assert.throws(func() { events.Observable().map(5); }, "must be of type function");
    assert.throws(func() { events.Observable().filter(5); }, "must be of type function");
    assert.throws(func() { events.Observable().pipe(5); }, "must be of type function");
  });
});

describe("events: Signal", func() {
  test("emit calls every slot and collects the results", func() {
    var s = events.Signal();
    var log = [];
    s.connect(func(a, b) { log[length(log)] = a + b; return "r1"; });
    s.connect(func(a, b) { return "r2"; });
    assert.equal(s.emit(1, 2), ["r1", "r2"]);
    assert.equal(log, [3]);
    assert.equal(s.connectionCount(), 2);
    assert.isTrue(s.hasConnections());
  });

  test("a signal without slots", func() {
    var s = events.Signal();
    assert.equal(s.emit(1), []);
    assert.isFalse(s.hasConnections());
    assert.equal(s.connectionCount(), 0);
  });

  test("higher priority slots run first", func() {
    var s = events.Signal();
    var log = [];
    s.connect(func() { log[length(log)] = "low"; });
    s.connect(func() { log[length(log)] = "high"; }, { priority: 5 });
    s.emit();
    assert.equal(log, ["high", "low"]);
  });

  test("once slots disconnect after running", func() {
    var s = events.Signal();
    var n = 0;
    s.connect(func() { n++; }, { once: true });
    s.emit();
    s.emit();
    assert.equal(n, 1);
    assert.equal(s.connectionCount(), 0);
  });

  test("a connection can be disconnected", func() {
    var s = events.Signal();
    var n = 0;
    var c = s.connect(func() { n++; });
    s.emit();
    assert.isTrue(c.isConnected());
    c.disconnect();
    s.emit();
    assert.equal(n, 1);
    assert.isFalse(c.isConnected());
    assert.equal(s.connectionCount(), 0);
  });

  test("a single connection can be blocked", func() {
    var s = events.Signal();
    var n = 0;
    var c = s.connect(func() { n++; });
    c.block();
    s.emit();
    assert.isTrue(c.isBlocked());
    c.unblock();
    s.emit();
    assert.equal(n, 1);
    assert.isFalse(c.isBlocked());
  });

  test("the whole signal can be blocked", func() {
    var s = events.Signal();
    var n = 0;
    s.connect(func() { n++; });
    s.block();
    assert.equal(s.emit(), []);
    assert.isTrue(s.isBlocked());
    s.unblock();
    s.emit();
    assert.equal(n, 1);
    assert.isFalse(s.isBlocked());
  });

  test("groups", func() {
    var s = events.Signal();
    s.connect(func() {}, { group: "ui" });
    s.connect(func() {}, { group: "ui" });
    s.connect(func() {}, { group: "io" });
    s.connect(func() {});
    assert.equal(s.connectionCount(), 4);
    assert.equal(s.connectionCount("ui"), 2);
    assert.equal(s.connectionCount("io"), 1);
    assert.equal(s.connectionCount("none"), 0);
    s.disconnectAll("ui");
    assert.equal(s.connectionCount(), 2);
  });

  test("disconnectAll removes every slot", func() {
    var s = events.Signal();
    s.connect(func() {});
    s.connect(func() {});
    s.disconnectAll();
    assert.equal(s.connectionCount(), 0);
    assert.isFalse(s.hasConnections());
  });

  test("getConnections describes the slots", func() {
    var s = events.Signal();
    s.connect(func() {}, { priority: 2, group: "g" });
    s.connect(func() {});
    assert.lengthOf(s.getConnections(), 2);
    assert.lengthOf(s.getConnections("g"), 1);
    var first = s.getConnections()[0];
    assert.equal(first.priority, 2);
    assert.equal(first.group, "g");
    assert.isFalse(first.once);
  });

  test("a failing slot does not stop the others", func() {
    var s = events.Signal();
    s.connect(func() { throw "bad"; });
    s.connect(func() { return "ok"; });
    var results = s.emit();
    assert.lengthOf(results, 2);
    assert.equal(results[1], "ok");
  });

  test("a slot disconnected during emit does not run", func() {
    var s = events.Signal();
    var log = [];
    var second = nil;
    s.connect(func() { log[length(log)] = "a"; second.disconnect(); });
    second = s.connect(func() { log[length(log)] = "b"; });
    s.emit();
    s.emit();
    assert.equal(log, ["a", "a"]);
  });

  test("block, unblock and disconnectAll return the signal", func() {
    var s = events.Signal();
    assert.isTrue(s.block().unblock().disconnectAll() == s);
  });

  test("validation", func() {
    assert.throws(func() { events.Signal().connect(5); }, "must be of type function");
    assert.throws(func() { events.Signal().disconnectAll(5); }, "must be of type string");
  });
});

finish("events");
