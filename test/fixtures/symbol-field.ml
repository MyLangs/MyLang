// A symbol member has to be a method, not a field.
struct Bad {
  var [symbol.dispose] = 1;
}
