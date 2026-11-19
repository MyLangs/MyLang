// Fixture module: exports a struct, an enum and an object
struct Vec2 {
  var x;
  var y;
  func length() { return (this.x ** 2 + this.y ** 2) ** 0.5; }
}
enum Mode { Off, On }
var settings = { name: "fixture", version: 2 };
export(Vec2, Mode, settings);
