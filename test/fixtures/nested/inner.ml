// Fixture module living in a sub directory, importing a sibling of its parent
import "../math.ml" as { add };
func addTen(n) { return add(n, 10); }
export(addTen);
