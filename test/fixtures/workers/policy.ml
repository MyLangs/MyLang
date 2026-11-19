// Reports the permissions the worker inherited.
import "core:process";

func report() {
  return $"net={process.can(\"net\")} process={process.can(\"process\")} sandboxed={process.permissions().sandboxed}";
}

report();
