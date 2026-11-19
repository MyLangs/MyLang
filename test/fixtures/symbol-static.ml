// `static` on a symbol member: refused at parse time.
struct Bad {
  static func [symbol.dispose]() { return 1; }
}
