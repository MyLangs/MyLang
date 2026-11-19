// Fixture module: private mutable state behind exported functions
var count = 0;
func increment() { count += 1; return count; }
func current() { return count; }
export(increment, current);
