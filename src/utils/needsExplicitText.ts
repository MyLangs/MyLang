import { isSubclassOfByName } from "./isSubclassOfByName";

function needsExplicitText(value: any): boolean {
  if (value === null || value === undefined) return false;

  if (typeof value !== "object" && typeof value !== "function") return false;

  return isSubclassOfByName(value.toString, "FunctionBuilder");
}

export { needsExplicitText };
