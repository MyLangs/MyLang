// `private` on a symbol member: refused at parse time.
struct Bad {
  private func [symbol.dispose]() { return 1; }
}
