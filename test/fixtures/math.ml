// Fixture module: functions and a constant exported with export(...)
func add(a, b) { return a + b; }
func subtract(a, b) { return a - b; }
var PI = 3.14159;
func hidden() { return "not exported"; }
export(add, subtract, PI);
