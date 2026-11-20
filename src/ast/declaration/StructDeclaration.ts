import { StmtType } from "../StmtType";
import { Environment } from "../../Environment";
import { VariableDeclaration } from "./VariableDeclaration";
import { FunctionDeclaration } from "./FunctionDeclaration";
import { type Position } from "../../lexer/token/Position";
import { type Gen } from "../../runtime/coroutine";
import {
  type StructModifiers,
  type StructSymbolMethod,
} from "../../runtime/structMembers";
import { instantiate, initialiseStatics } from "../struct/instantiate";

class StructDeclaration extends StmtType {
  public name: string;
  public fields: VariableDeclaration[];
  public methods: FunctionDeclaration[];
  public modifiers: StructModifiers;
  /** Members named after a language symbol: `func [symbol.dispose]() { ... }`. */
  public symbolMethods: StructSymbolMethod[];
  public parentEnv: Environment = new Environment();
  public position: Position;
  /** Values of the `static` members; created when the declaration is evaluated. */
  public statics: Record<string, any> = Object.create(null);

  constructor(
    name: string,
    fields: VariableDeclaration[],
    methods: FunctionDeclaration[],
    position: Position,
    modifiers: StructModifiers = Object.create(null),
    symbolMethods: StructSymbolMethod[] = [],
  ) {
    super();

    this.name = name;

    this.fields = fields;

    this.methods = methods;

    this.modifiers = modifiers;

    this.symbolMethods = symbolMethods;

    this.position = position;
  }

  *call(args: any[]): Gen<any> {
    return yield instantiate(this, args);
  }

  *evaluate(score: Environment): Gen<any> {
    const struct = new StructDeclaration(
      this.name,
      this.fields,
      this.methods,
      this.position,
      this.modifiers,
      this.symbolMethods,
    );

    struct.parentEnv = score;

    score.create(struct.name, struct);

    yield initialiseStatics(struct);

    return struct;
  }
}

export { StructDeclaration };
