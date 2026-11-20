import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { type Environment } from "../../Environment";
import { type Gen } from "../../runtime/coroutine";
import { isTypeArgs } from "../../../library/utils/utils";
import { hasMember, lookupMember } from "../../runtime/members";
import {
  AssignmentError,
  AssignmentCodeError,
} from "../../errors/runtime/AssignmentError";

interface DestructuringTarget {
  /** the variable that is created */
  name: string;
  /** the property it is read from (objects only; `{ key: name }`) */
  key: string;
  /** `...rest` (arrays only) */
  rest: boolean;
  /** `= expression`, used when the value is missing or nil */
  defaultValue?: StmtType;
}

/**
 * `var [first, second, ...rest] = list;`
 * `var { name, age: years, role = "user" } = person;`
 *
 * Every target becomes an ordinary variable of the current scope. A missing
 * element or property is `nil` unless the target has a default.
 */
class DestructuringDeclaration extends StmtType {
  public readonly kind: "array" | "object";
  public readonly targets: DestructuringTarget[];
  public readonly value: StmtType;
  public readonly position: Position;

  constructor(
    kind: "array" | "object",
    targets: DestructuringTarget[],
    value: StmtType,
    position: Position,
  ) {
    super();

    this.kind = kind;
    this.targets = targets;
    this.value = value;
    this.position = position;
  }

  *evaluate(score: Environment): Gen<any> {
    const source = yield this.value.evaluate(score);

    const fail = (what: string): never => {
      throw new AssignmentError(AssignmentCodeError.AssignmentInvalid, {
        err: `cannot destructure ${what} as ${this.kind === "array" ? "an array" : "an object"}`,
        files: score.get("import").paths,
      });
    };

    let read: (target: DestructuringTarget, index: number) => any;

    if (this.kind === "array") {
      const type = isTypeArgs(source);

      if (type !== "array" && type !== "string") {
        fail(type);
      }

      const items: any[] = Array.from(source);

      read = (target, index) =>
        target.rest ? items.slice(index) : items[index];
    } else {
      const type = isTypeArgs(source);

      if (type !== "object" && type !== "struct") {
        fail(type);
      }

      read = (target) =>
        hasMember(source, target.key)
          ? lookupMember(source, target.key)
          : undefined;
    }

    for (let i = 0; i < this.targets.length; i++) {
      const target = this.targets[i]!;
      let value = read(target, i);

      if ((value === undefined || value === null) && target.defaultValue) {
        value = yield target.defaultValue.evaluate(score);
      }

      score.create(target.name, value === undefined ? null : value);
    }
  }
}

export { DestructuringDeclaration, type DestructuringTarget };
