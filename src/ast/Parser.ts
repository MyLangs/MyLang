import { type StmtType } from "./StmtType";
import { Lexer } from "../lexer/Lexer";
import { Token } from "../lexer/token/Token";
import { Position } from "../lexer/token/Position";
import {
  TokenType,
  OperatorType,
  KeywordType,
  ReflectType,
  TokenList,
} from "../lexer/token/TokenType";
import { SyntaxError, SyntaxCodeError } from "../errors/lexer/SyntaxError";

import { StringLiteral } from "./types/StringLiteral";
import { InterpolatedString } from "./types/InterpolatedString";
import { IntLiteral } from "./types/IntLiteral";
import { FloatLiteral } from "./types/FloatLiteral";
import { BoolLiteral } from "./types/BoolLiteral";
import { NilLiteral } from "./types/NilLiteral";
import { IdentifierLiteral } from "./types/IdentifierLiteral";
import { BinaryExpression } from "./expression/BinaryExpression";
import { CallExpression } from "./expression/CallExpression";
import { VisitUnaryExpression } from "./expression/VisitUnaryExpression";
import { FunctionCall } from "./expression/FunctionCall";
import { FunctionExpression } from "./expression/FunctionExpression";
import { MemberExpression } from "./expression/MemberExpression";
import { AssignmentExpression } from "./expression/AssignmentExpression";
import { UpdateExpression } from "./expression/UpdateExpression";
import { ArrayExpression } from "./expression/ArrayExpression";
import { ObjectExpression } from "./expression/ObjectExpression";
import { TernaryExpression } from "./expression/TernaryExpression";
import { StructExpression } from "./expression/StructExpression";
import { ReflectionExpression } from "./expression/ReflectionExpression";
import { DeferDeclaration } from "./declaration/DeferDeclaration";
import { DeferExpression } from "./expression/DeferExpression";
import { ImportDeclaration } from "./declaration/ImportDeclaration";
import { ExportsDeclaration } from "./declaration/ExportsDeclaration";
import { VariableDeclaration } from "./declaration/VariableDeclaration";
import {
  DestructuringDeclaration,
  type DestructuringTarget,
} from "./declaration/DestructuringDeclaration";
import { CombinedVariableDeclaration } from "./declaration/CombinedVariableDeclaration";
import { FunctionDeclaration } from "./declaration/FunctionDeclaration";
import { EnumDeclaration } from "./declaration/EnumDeclaration";
import { ThrowDeclaration } from "./declaration/ThrowDeclaration";
import { StructDeclaration } from "./declaration/StructDeclaration";
import {
  noModifiers,
  type StructModifiers,
  type StructSymbolMethod,
} from "../runtime/structMembers";
import { WaitExpression } from "./expression/WaitExpression";
import { SpawnExpression } from "./expression/SpawnExpression";
import { BlockStatement } from "./statement/BlockStatement";
import { ReturnStatement } from "./statement/ReturnStatement";
import { ForStatement } from "./statement/ForStatement";
import { ForInStatement } from "./statement/ForInStatement";
import { BreakStatement } from "./statement/BreakStatement";
import { ContinueStatement } from "./statement/ContinueStatement";
import { IfStatement } from "./statement/IfStatement";
import { WhileStatement } from "./statement/WhileStatement";
import { TryCatchStatement } from "./statement/TryCatchStatement";
import { TryCatchExpression } from "./expression/TryCatchExpression";
import { MatchStatement } from "./statement/MatchStatement";
import { emitWarning } from "../errors/utils/WarningError";

import { type IOptionsVar } from "../Environment";

class Parser {
  private offset: number = 0;
  private ast: StmtType[] = [];
  private isSpawnExperimental: boolean = false;
  /**
   * While set, `parseMemberExpressions` returns the member chain on its own instead of
   * continuing into the expression around it.
   *
   * `typeof` binds tighter than any binary operator, so `typeof a.b + "!"` is
   * `(typeof a.b) + "!"`. A bare name already parsed that way, because `parsePrimary`
   * hands it back untouched and the `parseExpression` loop takes the `+`. A member chain
   * did not: `parseMemberExpressions` finished by handing the rest of the expression to
   * `parseExpression`, so the whole `a.b + "!"` ended up under the `typeof` and the
   * answer was the type of the concatenation. The flag is consumed by the first member
   * chain parsed after the operator, so a sub-expression inside that chain
   * (`typeof a[i + 1].b`) is parsed normally.
   */
  private tightMember: boolean = false;
  public readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): StmtType[] {
    while (!this.eof()) {
      const statement = this.parseStatement();
      if (statement) {
        this.ast.push(statement);
      }
    }

    return this.ast;
  }

  parseStatement(): StmtType {
    const token = this.peek();

    switch (token.type) {
      case TokenType.String:
      case TokenType.Int:
      case TokenType.Float:
      case TokenType.Bool:
      case TokenType.Nil:
      case TokenType.Identifier:
      case TokenType.InterpolatedString: {
        return this.parseExpression();
      }
      case TokenType.Keyword: {
        return this.parseKeyword();
      }
      case TokenType.BracketOpen: {
        return this.parseArrayExpression(token);
      }
      case TokenType.OperatorAdd:
      case TokenType.OperatorSubtract:
      case TokenType.OperatorNot:
      case TokenType.OperatorBitNot: {
        this.next(); // Move past operator
        const right = this.parsePrimary();
        const unary = new VisitUnaryExpression(
          token.value as OperatorType,
          right,
          token.position,
        );
        return this.parseExpression(unary);
      }
      case TokenType.Reflect: {
        const reflect = this.parseReflectExpression(token);
        return this.parseExpression(reflect);
      }
      case TokenType.ParenthesisOpen: {
        return this.parseExpression();
      }
      case TokenType.BraceOpen: {
        this.next(); // Skip '{'
        const expr = this.parseBlockStatement(token);
        this.expect(TokenType.BraceClose);
        this.next(); // Skip '}'
        return expr;
      }
      default: {
        this.throwError(SyntaxCodeError.InvalidUnexpectedToken, token);
      }
    }
  }

  parseInterpolatedString(identifier: Token) {
    const interpolatedList = [];
    let interpolatedString = "";
    let i = 0;

    while (i < identifier.value.length) {
      const char = identifier.value[i];

      if (char === TokenList.BraceOpen) {
        const closeIndex = identifier.value.indexOf(TokenList.BraceClose, i);

        if (closeIndex === -1) {
          this.throwError(SyntaxCodeError.UnclosedInterpolation, {
            position: identifier.position,
          });
        }

        const expression = identifier.value.slice(i + 1, closeIndex);

        interpolatedList.push(new Lexer(expression).analyze());

        interpolatedString += `{${interpolatedList.length - 1}}`;

        i = closeIndex + 1;
      } else {
        interpolatedString += char;
        i++;
      }
    }

    return new InterpolatedString(
      interpolatedString,
      interpolatedList,
      identifier.position,
    );
  }

  parseArrayExpression(identifier: Token) {
    this.next(); // Skip '['

    const elements = [];

    while (this.peek().type !== TokenType.BracketClose) {
      elements.push(this.parseExpression());

      if (this.peek().type === TokenType.Comma) {
        this.next(); // Skip ','
      } else if (this.peek().type === TokenType.BracketClose) {
        break;
      } else {
        this.expect(TokenType.BracketClose);
      }
    }

    this.next(); // Skip ']'

    this.expectSemicolonOrEnd();

    const arrayExpression = new ArrayExpression(elements, identifier.position);

    if (
      this.peek(-1).type !== TokenType.Semicolon &&
      (this.peek().type === TokenType.BracketOpen ||
        this.peek().type === TokenType.Period ||
        (this.peek(0).type === TokenType.QuestionMark &&
          (this.peek(1).type === TokenType.BracketOpen ||
            this.peek(1).type === TokenType.Period)))
    ) {
      return this.parseMemberExpressions(arrayExpression);
    }

    if (
      this.peek(-1).type !== TokenType.Semicolon &&
      (this.isOperator(this.peek().type) ||
        this.isReflectOperator(this.peek().value) ||
        this.peek().type === TokenType.QuestionMark)
    ) {
      return this.parseExpression(arrayExpression);
    }

    return arrayExpression;
  }

  parseObjectExpression(identifier: Token) {
    this.next(); // Skip '{'

    const obj: {
      key: StmtType | string;
      value: StmtType | null;
      computed?: true;
    }[] = [];

    while (this.peek().type !== TokenType.BraceClose) {
      if (
        this.peek().type === TokenType.Identifier &&
        this.peek(1).type === TokenType.ParenthesisOpen
      ) {
        const methodName = this.peek().value;
        this.next(); // Move past the method name

        obj.push({
          key: methodName,
          value: this.parseFunctionExpression(this.peek()),
        });
      } else if (this.peek().type === TokenType.Identifier) {
        const propertyName = this.parsePrimary();

        if (this.peek().type === TokenType.Colon) {
          this.next(); // Move past ':'
          obj.push({ key: propertyName, value: this.parseExpression() });
        } else
          obj.push({
            key: (<IdentifierLiteral>propertyName).value,
            value: propertyName,
          });
      } else if (this.peek().type === TokenType.String) {
        const propertyName = this.parsePrimary();

        if (this.peek().type === TokenType.Colon) {
          this.next(); // Move past ':'
          obj.push({ key: propertyName, value: this.parseExpression() });
        }
      } else if (this.peek().type === TokenType.BracketOpen) {
        this.next(); // Move past '['
        const propertyName = this.parseExpression();
        this.expect(TokenType.BracketClose);
        this.next(); // Move past ']'

        this.expect(TokenType.Colon);
        this.next(); // Move past ':'

        const propertyValue = this.parseExpression();

        obj.push({ key: propertyName, value: propertyValue, computed: true });
      }

      if (this.peek().type === TokenType.Comma) {
        this.next(); // Skip ','
      } else this.expect(TokenType.BraceClose);
    }

    this.expect(TokenType.BraceClose);
    this.next(); // Skip '}'

    this.expectSemicolonOrEnd();

    const objExpression = new ObjectExpression(obj, identifier.position);

    if (
      this.peek(-1).type !== TokenType.Semicolon &&
      (this.peek().type === TokenType.BracketOpen ||
        this.peek().type === TokenType.Period ||
        (this.peek().type === TokenType.QuestionMark &&
          (this.peek(1).type === TokenType.BracketOpen ||
            this.peek(1).type === TokenType.Period)))
    ) {
      return this.parseMemberExpressions(objExpression);
    }

    if (
      this.peek(-1).type !== TokenType.Semicolon &&
      (this.isOperator(this.peek().type) ||
        this.isReflectOperator(this.peek().value) ||
        this.peek().type === TokenType.QuestionMark)
    ) {
      return this.parseExpression(objExpression);
    }

    return objExpression;
  }

  parseKeyword(): StmtType {
    const token = this.peek();

    switch (token.value) {
      case KeywordType.Var:
        this.next();
        return this.parseVariableDeclaration(this.peek());
      case KeywordType.Func:
        this.next();
        return this.parseFunctionDeclaration(this.peek());
      case KeywordType.Return:
        this.next();
        return this.parseReturnStatement(this.peek());
      case KeywordType.If:
        this.next();
        return this.parseIfStatement(this.peek());
      case KeywordType.For:
        this.next();
        return this.parseForStatement(this.peek());
      case KeywordType.While:
        this.next();
        return this.parseWhileStatement(this.peek());
      case KeywordType.Break:
        this.next();
        return this.parseBreakStatement(this.peek(-1));
      case KeywordType.Continue:
        this.next();
        return this.parseContinueStatement(this.peek(-1));
      case KeywordType.Try:
        this.next();
        return this.parseTryCatchStatement(this.peek());
      case KeywordType.Throw:
        this.next();
        return this.parseThrowDeclaration(this.peek(-1));
      case KeywordType.Match:
        this.next();
        return this.parseMatchStatement(this.peek());
      case KeywordType.Defer:
        this.next();
        return this.parseDeferDeclaration(this.peek(-1));
      case KeywordType.Import:
        if (
          this.peek(1).type === TokenType.BracketOpen ||
          this.peek(1).type === TokenType.Period ||
          (this.peek(1).type === TokenType.QuestionMark &&
            (this.peek(2).type === TokenType.BracketOpen ||
              this.peek(2).type === TokenType.Period))
        ) {
          this.next();
          return this.parseMemberExpressions(
            new IdentifierLiteral(token.value, token.position),
          );
        }
        this.next();
        return this.parseImportDeclaration(this.peek());
      case KeywordType.Export:
        this.next();
        return this.parseExportDeclaration(this.peek());
      case KeywordType.Enum:
        this.next();
        return this.parseEnumDeclaration(this.peek());
      case KeywordType.Spawn:
        if (!this.isSpawnExperimental) {
          emitWarning('"spawn" or "wait" is experimental.', {
            name: "WaitExperimental",
            code: "WARN003",
          });
          this.isSpawnExperimental = true;
        }
        this.next();
        return this.parseSpawnExpression(this.peek(-1));
      case KeywordType.Wait:
        if (
          this.peek(1).type === TokenType.BracketOpen ||
          this.peek(1).type === TokenType.Period ||
          (this.peek(1).type === TokenType.QuestionMark &&
            (this.peek(2).type === TokenType.BracketOpen ||
              this.peek(2).type === TokenType.Period))
        ) {
          this.next();
          return this.parseMemberExpressions(
            new IdentifierLiteral(token.value, token.position),
          );
        }
        this.next();
        return this.parseWaitExpression(this.peek(-1));
      case KeywordType.Struct:
        this.next();
        return this.parseStructDeclaration(this.peek(-1));
      default: {
        this.throwError(SyntaxCodeError.InvalidUnexpectedToken, token.position);
      }
    }
  }

  /**
   * `var [a, b, ...rest] = expr;` and `var { x, y: alias, z = 1 } = expr;`
   */
  parseDestructuringDeclaration(identifier: Token): DestructuringDeclaration {
    const isArray = this.peek().type === TokenType.BracketOpen;
    const closing = isArray ? TokenType.BracketClose : TokenType.BraceClose;
    const targets: DestructuringTarget[] = [];

    this.next(); // Move past '[' or '{'

    while (this.peek().type !== closing) {
      let rest = false;

      if (isArray && this.peek().type === TokenType.OperatorRest) {
        rest = true;
        this.next(); // Move past '...'
      }

      this.expect(TokenType.Identifier);
      const first = this.peek();
      this.next(); // Move past the name

      let name = first.value;

      // `{ key: alias }`
      if (!isArray && this.peek().type === TokenType.Colon) {
        this.next(); // Move past ':'
        this.expect(TokenType.Identifier);
        name = this.peek().value;
        this.next(); // Move past the alias
      }

      let defaultValue: StmtType | undefined;

      if (this.peek().type === TokenType.OperatorAssign) {
        this.next(); // Move past '='
        defaultValue = this.parseExpression();
      }

      targets.push({
        name,
        key: first.value,
        rest,
        ...(defaultValue ? { defaultValue } : {}),
      });

      if (this.peek().type === TokenType.Comma) {
        this.next(); // Move past ','
      } else {
        this.expect(closing);
      }
    }

    this.next(); // Move past ']' or '}'

    this.expect(TokenType.OperatorAssign);
    this.next(); // Move past '='

    const value = this.parseExpression();

    this.expectSemicolonOrEnd();

    return new DestructuringDeclaration(
      isArray ? "array" : "object",
      targets,
      value,
      identifier.position,
    );
  }

  parseVariableDeclaration(
    identifier: Token,
  ):
    | VariableDeclaration
    | CombinedVariableDeclaration
    | DestructuringDeclaration {
    if (
      this.peek().type === TokenType.BracketOpen ||
      this.peek().type === TokenType.BraceOpen
    ) {
      return this.parseDestructuringDeclaration(identifier);
    }

    if (this.peek().type === TokenType.ParenthesisOpen) {
      this.next(); // Move past '('

      const variableList: {
        name: string;
        value: StmtType;
        options?: IOptionsVar;
      }[] = [];

      while (this.peek().type !== TokenType.ParenthesisClose) {
        this.expect(TokenType.Identifier);
        const name = this.peek();
        this.next(); // Move past identifier
        if (this.peek().type === TokenType.OperatorAssign) {
          this.next(); // Move past '='
          const value = this.parseExpression();

          if (this.peek().value === KeywordType.As) {
            this.next(); // Move past 'as'
            if (this.peek().value === KeywordType.Const) {
              this.next(); // Move past 'const'
              variableList.push({
                name: name.value,
                value,
                options: {
                  constant: true,
                },
              });
            } else if (this.peek().value === KeywordType.Readonly) {
              this.next(); // Move past 'readonly'
              variableList.push({
                name: name.value,
                value,
                options: {
                  constant: true,
                  readonly: true,
                },
              });
            } else if (this.peek().value === KeywordType.Lazy) {
              this.next(); // Move past 'lazy'
              variableList.push({
                name: name.value,
                value,
                options: {
                  constant: true,
                  lazy: true,
                },
              });
            }
          } else {
            variableList.push({
              name: name.value,
              value,
            });
          }
        } else {
          variableList.push({
            name: name.value,
            value: new NilLiteral(name.position),
          });
        }

        if (this.peek().type === TokenType.Comma) {
          this.next(); // Move past ','
        } else this.expect(TokenType.ParenthesisClose);
      }

      this.next(); // Move past ')'

      if (this.peek().type === TokenType.OperatorAssign) {
        this.next(); // Move past "="
        const iterableValue = this.parseExpression();
        this.expectSemicolonOrEnd();
        return new CombinedVariableDeclaration(
          variableList,
          iterableValue,
          null,
          identifier.position,
        );
      }

      let allOptionsVar: IOptionsVar | null = null;

      if (this.peek().value === KeywordType.As) {
        this.next(); // Move past 'as'
        if (this.peek().value === KeywordType.Const) {
          this.next(); // Move past 'const'
          allOptionsVar = { constant: true };
        } else if (this.peek().value === KeywordType.Readonly) {
          this.next(); // Move past 'readonly'
          allOptionsVar = { constant: true, readonly: true };
        } else if (this.peek().value === KeywordType.Lazy) {
          this.next(); // Move past 'lazy'
          allOptionsVar = { constant: true, lazy: true };
        }
      }

      if (allOptionsVar) {
        variableList.forEach(({ name, options }) => {
          if (options) {
            this.throwError(SyntaxCodeError.AlreadyAsInvalid, {
              name,
              varType: options.readonly ? "readonly" : "const",
              currentAsType: allOptionsVar.readonly ? "readonly" : "const",
              position: this.peek(-1).position,
            });
          }
        });
      }

      this.expectSemicolonOrEnd();

      return new CombinedVariableDeclaration(
        variableList,
        null,
        allOptionsVar,
        identifier.position,
      );
    }

    this.next(); // Move past Identifier

    if (this.peek().type !== TokenType.OperatorAssign) {
      this.expectSemicolonOrEnd();

      return new VariableDeclaration(
        identifier.value,
        new NilLiteral(identifier.position),
        null,
        identifier.position,
      );
    }

    this.expect(TokenType.OperatorAssign);
    this.next(); // Move past '='

    const expression = this.parseExpression();

    if (this.peek().value === KeywordType.As) {
      this.next(); // Move past 'as

      if (this.peek().value === KeywordType.Const) {
        this.next(); // Move past 'const'

        this.expectSemicolonOrEnd();

        return new VariableDeclaration(
          identifier.value,
          expression,
          { constant: true },
          identifier.position,
        );
      } else if (this.peek().value === KeywordType.Readonly) {
        this.next(); // Move past 'readonly'

        this.expectSemicolonOrEnd();

        return new VariableDeclaration(
          identifier.value,
          expression,
          { constant: true, readonly: true },
          identifier.position,
        );
      } else if (this.peek().value === KeywordType.Lazy) {
        this.next(); // Move past 'lazy'

        this.expectSemicolonOrEnd();

        return new VariableDeclaration(
          identifier.value,
          expression,
          { constant: true, lazy: true },
          identifier.position,
        );
      }
    }

    this.expectSemicolonOrEnd();

    return new VariableDeclaration(
      identifier.value,
      expression,
      null,
      identifier.position,
    );
  }

  parseSpawnExpression(
    identifier: Token,
    isWait: boolean = false,
  ): SpawnExpression {
    if (this.peek().type === TokenType.BraceOpen) {
      this.next(); // Move past '{'

      const blockStatement = this.parseBlockStatement(this.peek(-1));

      this.expect(TokenType.BraceClose);
      this.next(); // Move past '}'

      return new SpawnExpression(blockStatement, isWait, identifier.position);
    }

    const value = this.parseExpression();

    return new SpawnExpression(value, isWait, identifier.position);
  }

  parseWaitExpression(identifier: Token): WaitExpression | SpawnExpression {
    if (this.peek().value === KeywordType.Spawn) {
      this.next();

      const spawnExpression = this.parseSpawnExpression(this.peek(-1), true);
      return new WaitExpression(spawnExpression, identifier.position);
    }

    const value = this.parseExpression();

    this.expectSemicolonOrEnd();

    return new WaitExpression(value, identifier.position);
  }

  parseFunctionDeclaration(identifier: Token): FunctionDeclaration {
    this.next(); // Move past identifier
    this.expect(TokenType.ParenthesisOpen);
    this.next(); // Move past '('

    const args = this.parseArgumentsAndDefault();

    this.expect(TokenType.ParenthesisClose);
    this.next(); // Move past ')'
    this.expect(TokenType.BraceOpen);

    this.next(); // Move past '{'
    const statement = this.parseBlockStatement(identifier);

    this.next(); // Move past '}'

    return new FunctionDeclaration(
      identifier.value,
      args,
      statement,
      identifier.position,
    );
  }

  parseReturnStatement(identifier: Token): ReturnStatement {
    if (this.peek().type === TokenType.Semicolon) {
      this.next(); // Move past ';'
      return new ReturnStatement(
        new NilLiteral(identifier.position),
        identifier.position,
      );
    }

    if (this.peek().type === TokenType.ParenthesisOpen) {
      // `return (a, b);` is a tuple. Anything else that starts with a
      // parenthesis (`return (a + b) * c;`, `return (a + b);`) is an ordinary
      // expression, so remember where we are and rewind when there is no comma.
      const start = this.offset;

      this.next(); // Move past '('

      const firstExpression = this.parseExpression();

      if (this.peek().type === TokenType.Comma) {
        this.next(); // Move past ','

        const valuesExpression = [firstExpression];

        while (this.peek().type !== TokenType.ParenthesisClose) {
          valuesExpression.push(this.parseExpression());

          if (this.peek().type === TokenType.Comma) {
            this.next();
          }
        }

        this.expect(TokenType.ParenthesisClose);
        this.next(); // Move past ')'
        this.expectSemicolonOrEnd();

        return new ReturnStatement(valuesExpression, identifier.position);
      }

      this.offset = start; // not a tuple: parse again as a normal expression
    }

    const valueExpression = this.parseExpression();

    if (this.peek().type === TokenType.Comma) {
      this.next(); // Move past ','

      const valuesExpression = [valueExpression];

      while (this.peek().type !== TokenType.Semicolon) {
        valuesExpression.push(this.parseExpression());

        if (this.peek().type === TokenType.Comma) {
          this.next();
        }
      }

      this.expectSemicolonOrEnd();

      return new ReturnStatement(valuesExpression, identifier.position);
    }

    this.expectSemicolonOrEnd();

    return new ReturnStatement(valueExpression, identifier.position);
  }

  parseIfStatement(identifier: Token): IfStatement {
    this.expect(TokenType.ParenthesisOpen);
    this.next(); // Move past '('
    let test = this.parseExpression();
    this.expect(TokenType.ParenthesisClose);
    this.next(); // Move past ')'

    let consequent: StmtType | null = null;

    if (this.peek().type === TokenType.BraceOpen) {
      this.next(); // Move past '{'
      consequent = this.parseBlockStatement(identifier);
      this.expect(TokenType.BraceClose);
      this.next(); // Move past '}'
    } else {
      consequent = this.parseStatement();
    }

    if (
      this.peek().type === TokenType.Keyword &&
      this.peek().value === KeywordType.Else
    ) {
      this.next(); // Move past 'else'
      if (
        this.peek().type === TokenType.Keyword &&
        this.peek().value === KeywordType.If
      ) {
        this.next(); // Move past 'if'
        const alternate = this.parseIfStatement(identifier);
        return new IfStatement(
          test,
          consequent,
          alternate,
          identifier.position,
        );
      }

      let alternate: StmtType | null = null;

      if (this.peek().type === TokenType.BraceOpen) {
        this.next(); // Move past '{'
        alternate = this.parseBlockStatement(identifier);
        this.expect(TokenType.BraceClose);
        this.next(); // Move past '}'
      } else {
        alternate = this.parseStatement();
      }

      this.expectSemicolonOrEnd();

      return new IfStatement(test, consequent, alternate, identifier.position);
    }

    this.expectSemicolonOrEnd();

    return new IfStatement(test, consequent, null, identifier.position);
  }

  parseForStatement(identifier: Token): ForStatement | ForInStatement {
    if (this.peek().type === TokenType.BraceOpen) {
      this.next(); // Move past '{'
      const statement = this.parseBlockStatement(identifier);
      this.next(); // Move past '}'

      this.expectSemicolonOrEnd();

      return new ForStatement(null, null, null, statement, identifier.position);
    }

    this.expect(TokenType.ParenthesisOpen);
    this.next(); // Move past '('

    if (this.peek().type === TokenType.Semicolon) {
      if (
        this.peek(1).type === TokenType.Semicolon &&
        this.peek(2).type === TokenType.ParenthesisClose
      ) {
        this.next(); // Move past ';'
        this.next(); // Move past ';'
        this.next(); // Move past ')'

        this.expect(TokenType.BraceOpen);
        this.next(); // Move past '{'
        const statement = this.parseBlockStatement(identifier);
        this.next(); // Move past '}'

        this.expectSemicolonOrEnd();

        return new ForStatement(
          null,
          null,
          null,
          statement,
          identifier.position,
        );
      } else if (
        this.peek(1).type === TokenType.Semicolon &&
        this.peek(2).type !== TokenType.ParenthesisClose
      ) {
        this.next(); // Move past ';'
        this.next(); // Move past ';'

        if (this.peek(-1).type !== TokenType.Semicolon) {
          this.expect(TokenType.Semicolon);
          this.next(); // Move past ';'
        }

        const update = this.parseExpression();

        this.expect(TokenType.ParenthesisClose);
        this.next(); // Move past ')'

        this.expect(TokenType.BraceOpen);
        this.next(); // Move past '{'
        const statement = this.parseBlockStatement(identifier);
        this.next(); // Move past '}'

        this.expectSemicolonOrEnd();

        return new ForStatement(
          null,
          null,
          update,
          statement,
          identifier.position,
        );
      } else if (this.peek().type === TokenType.Semicolon) {
        this.next(); // Move past ';'
        const test = this.parseStatement();
        if (
          this.peek().type === TokenType.Semicolon &&
          this.peek(1).type === TokenType.ParenthesisClose
        ) {
          this.next(); // Move past ';'
          this.expect(TokenType.ParenthesisClose);
          this.next(); // Move past ')'

          this.expect(TokenType.BraceOpen);
          this.next(); // Move past '{'
          const statement = this.parseBlockStatement(identifier);
          this.next(); // Move past '}'

          this.expectSemicolonOrEnd();

          return new ForStatement(
            null,
            test,
            null,
            statement,
            identifier.position,
          );
        } else {
          if (this.peek(-1).type !== TokenType.Semicolon) {
            this.expect(TokenType.Semicolon);
            this.next(); // Move past ';'
          }

          const update = this.parseExpression();

          this.expect(TokenType.ParenthesisClose);
          this.next(); // Move past ')'

          this.expect(TokenType.BraceOpen);
          this.next(); // Move past '{'
          const statement = this.parseBlockStatement(identifier);
          this.next(); // Move past '}'

          this.expectSemicolonOrEnd();

          return new ForStatement(
            null,
            test,
            update,
            statement,
            identifier.position,
          );
        }
      }
    }

    const init = this.parseStatement();

    if (this.peek().type === TokenType.Semicolon) {
      if (this.peek(1).type === TokenType.ParenthesisClose) {
        this.next(); // Move past ';'
        this.next(); // Move past ')'

        this.expect(TokenType.BraceOpen);
        this.next(); // Move past '{'
        const statement = this.parseBlockStatement(identifier);
        this.next(); // Move past '}'

        this.expectSemicolonOrEnd();

        return new ForStatement(
          init,
          null,
          null,
          statement,
          identifier.position,
        );
      }
    }

    if (this.peek().value === ReflectType.In) {
      this.next(); // Move past 'in'
      const iterable = this.parseExpression();

      this.expect(TokenType.ParenthesisClose);
      this.next(); // Move past ')'

      this.expect(TokenType.BraceOpen);
      this.next(); // Move past '{'
      const statement = this.parseBlockStatement(identifier);
      this.next(); // Move past '}'

      this.expectSemicolonOrEnd();

      return new ForInStatement(init, iterable, statement, identifier.position);
    }

    if (this.peek(-1).type !== TokenType.Semicolon) {
      this.expect(TokenType.Semicolon);
      this.next(); // Move past ';'
    }

    if (
      this.peek(-1).type === TokenType.Semicolon &&
      this.peek().type !== TokenType.ParenthesisClose
    ) {
      const test = this.parseExpression();
      if (this.peek(-1).type !== TokenType.Semicolon) {
        this.expect(TokenType.Semicolon);
        this.next(); // Move past ';'
      }

      if (this.peek().type !== TokenType.ParenthesisClose) {
        if (this.peek(-1).type !== TokenType.Semicolon) {
          this.expect(TokenType.Semicolon);
          this.next(); // Move past ';'
        }

        const update = this.parseExpression();

        this.expect(TokenType.ParenthesisClose);
        this.next(); // Move past ')'

        this.expect(TokenType.BraceOpen);
        this.next(); // Move past '{'
        const statement = this.parseBlockStatement(identifier);
        this.next(); // Move past '}'

        this.expectSemicolonOrEnd();

        return new ForStatement(
          init,
          test,
          update,
          statement,
          identifier.position,
        );
      }

      this.expect(TokenType.ParenthesisClose);
      this.next(); // Move past ')'

      this.expect(TokenType.BraceOpen);
      this.next(); // Move past '{'
      const statement = this.parseBlockStatement(identifier);
      this.next(); // Move past '}'

      this.expectSemicolonOrEnd();

      return new ForStatement(init, test, null, statement, identifier.position);
    }

    const test = this.parseExpression();

    if (this.peek(-1).type !== TokenType.Semicolon) {
      this.expect(TokenType.Semicolon);
      this.next(); // Move past ';'
    }

    const update = this.parseExpression();

    this.expect(TokenType.ParenthesisClose);
    this.next(); // Move past ')'

    this.expect(TokenType.BraceOpen);
    this.next(); // Move past '{'
    const statement = this.parseBlockStatement(identifier);
    this.next(); // Move past '}'

    this.expectSemicolonOrEnd();

    return new ForStatement(init, test, update, statement, identifier.position);
  }

  parseWhileStatement(identifier: Token): WhileStatement {
    this.expect(TokenType.ParenthesisOpen);
    this.next(); // Move past '('

    const test = this.parseExpression();

    this.expect(TokenType.ParenthesisClose);
    this.next(); // Move past ')'

    this.expect(TokenType.BraceOpen);
    this.next(); // Move past '{'
    const statement = this.parseBlockStatement(identifier);
    this.next(); // Move past '}'

    this.expectSemicolonOrEnd();

    return new WhileStatement(test, statement, identifier.position);
  }

  parseBreakStatement(identifier: Token): BreakStatement {
    this.expectSemicolonOrEnd();
    return new BreakStatement(identifier.position);
  }

  parseContinueStatement(identifier: Token): ContinueStatement {
    this.expectSemicolonOrEnd();
    return new ContinueStatement(identifier.position);
  }

  parseTryCatchStatement(identifier: Token): TryCatchStatement {
    this.expect(TokenType.BraceOpen);
    this.next(); // Move past '{'

    const tryBlock = this.parseBlockStatement(identifier);
    this.next(); // Move past '}'

    if (
      this.peek().value !== KeywordType.Catch &&
      this.peek().value !== KeywordType.Finally
    ) {
      this.throwError(SyntaxCodeError.MissingCatchOrTry, this.peek());
    }

    if (this.peek().value === KeywordType.Finally) {
      this.next(); // Move past 'finally'

      this.expect(TokenType.BraceOpen);
      this.next(); // Move past '{'
      const finallyBlock = this.parseBlockStatement(identifier);
      this.next(); // Move past '}'

      return new TryCatchStatement(
        tryBlock,
        null,
        finallyBlock,
        identifier.position,
      );
    }

    this.next(); // Move past 'catch'

    let catchVariables = null;

    if (this.peek().type === TokenType.ParenthesisOpen) {
      this.next(); // Move past '('

      this.expect(TokenType.Identifier);
      catchVariables = this.peek().value;
      this.next(); // Move past 'identifier'

      this.expect(TokenType.ParenthesisClose);
      this.next(); // Move past ')'
    }

    this.expect(TokenType.BraceOpen);
    this.next(); // Move past '{'
    const catchBlock: [string | null, BlockStatement] = [
      catchVariables,
      this.parseBlockStatement(identifier),
    ];
    this.next(); // Move past '}'

    if (this.peek().value === KeywordType.Finally) {
      this.next(); // Move past 'finally'

      this.expect(TokenType.BraceOpen);
      this.next(); // Move past '{'
      const finallyBlock = this.parseBlockStatement(identifier);
      this.next(); // Move past '}'

      return new TryCatchStatement(
        tryBlock,
        catchBlock,
        finallyBlock,
        identifier.position,
      );
    }

    return new TryCatchStatement(
      tryBlock,
      catchBlock,
      null,
      identifier.position,
    );
  }

  parseTryCatchExpression(identifier: Token): TryCatchExpression {
    const tryBlock = this.parseExpression();

    if (
      this.peek().value !== KeywordType.Catch &&
      this.peek().value !== KeywordType.Else
    ) {
      this.throwError(SyntaxCodeError.MissingCatchOrElse, this.peek());
    }

    if (this.peek().value === KeywordType.Catch) {
      let catchVariables = null;

      this.next(); // Move past 'catch'

      if (this.peek().type === TokenType.ParenthesisOpen) {
        this.next(); // Move past '('

        this.expect(TokenType.Identifier);
        catchVariables = this.peek().value;
        this.next(); // Move past 'identifier'

        this.expect(TokenType.ParenthesisClose);
        this.next(); // Move past ')'
      }

      this.expect(TokenType.BraceOpen);

      this.next(); // Move past '{'
      const catchBlock: [string | null, BlockStatement] = [
        catchVariables,
        this.parseBlockStatement(identifier),
      ];

      this.next(); // Move past '}'

      return new TryCatchExpression(tryBlock, catchBlock, identifier.position);
    }

    this.next(); // Move past 'else'

    this.expect(TokenType.BraceOpen);
    this.next(); // Move past '{'
    const elseBlock = this.parseBlockStatement(identifier);
    this.next(); // Move past '}'

    return new TryCatchExpression(tryBlock, elseBlock, identifier.position);
  }

  parseThrowDeclaration(identifier: Token): ThrowDeclaration {
    const expression = this.parseExpression();

    if (this.peek().value === KeywordType.As) {
      this.next(); // Move past 'as'
      const throwOptions = this.parseExpression();
      this.expectSemicolonOrEnd();
      return new ThrowDeclaration(
        expression,
        throwOptions,
        identifier.position,
      );
    }

    this.expectSemicolonOrEnd();
    return new ThrowDeclaration(expression, null, identifier.position);
  }

  parseMatchStatement(identifier: Token): MatchStatement {
    this.expect(TokenType.ParenthesisOpen);
    this.next(); // Move past '('

    const test = this.parseExpression();

    this.expect(TokenType.ParenthesisClose);
    this.next(); // Move past ')'

    this.expect(TokenType.BraceOpen);
    this.next(); // Move past '{'

    let defaultCase: StmtType | null = null;
    const cases: { condition: StmtType; block: StmtType }[] = [];

    while (this.peek().type !== TokenType.BraceClose) {
      if (this.peek().value === KeywordType.Case) {
        this.next(); // Move past 'case'

        const hasParenthesis = this.peek().type === TokenType.ParenthesisOpen;

        if (hasParenthesis) {
          this.next(); // Move past '('
        }

        let condition!: StmtType;

        if (this.peek().type === TokenType.Period) {
          this.next(); // Move past '.'
          if (
            this.peek().type === TokenType.Identifier &&
            this.peek(1).type === TokenType.ParenthesisClose
          ) {
            const property = this.peek();

            condition = new MemberExpression(
              test,
              new StringLiteral(property.value, property.position),
              false,
              false,
              this.peek(-1).position,
            );

            this.next(); // Move past 'identifier'
          } else if (
            this.peek().type === TokenType.Identifier &&
            (this.peek(1).type === TokenType.Period ||
              this.peek(1).type === TokenType.BracketOpen ||
              (this.peek(1).type === TokenType.QuestionMark &&
                (this.peek(2).type === TokenType.BracketOpen ||
                  this.peek(2).type === TokenType.Period)))
          ) {
            this.next(); // Move past '[' or '.'

            const property = this.peek(-1);
            condition = this.parseMemberExpressions(
              new MemberExpression(
                test,
                new StringLiteral(property.value, property.position),
                this.peek().type === TokenType.BracketOpen,
                false,
                property.position,
              ),
            );
          } else if (
            this.peek().type === TokenType.Identifier &&
            this.peek(1).type === TokenType.ParenthesisOpen
          ) {
            const identifier = this.peek();
            this.next(); // Move past 'identifier'
            this.next(); // Move past '('

            const args = this.parseArguments();

            this.expect(TokenType.ParenthesisClose);
            this.next(); // Move past ')'

            condition = new CallExpression(
              identifier.value,
              identifier.value,
              test as IdentifierLiteral,
              args,
              identifier.position,
            );
          }
        } else {
          condition = this.parseExpression();
        }

        if (hasParenthesis) {
          this.expect(TokenType.ParenthesisClose);
          this.next(); // Move past ')'
        }

        this.expect(TokenType.Colon);
        this.next(); // Move past ':'

        const listCase = [];

        if (this.peek().value === KeywordType.Case) {
          while (this.peek().value === KeywordType.Case) {
            this.next(); // Move past 'case'

            const stackedParenthesis =
              this.peek().type === TokenType.ParenthesisOpen;

            if (stackedParenthesis) {
              this.next(); // Move past '('
            }

            const condition = this.parseExpression();

            if (stackedParenthesis) {
              this.expect(TokenType.ParenthesisClose);
              this.next(); // Move past ')'
            }

            this.expect(TokenType.Colon);
            this.next(); // Move past ':'

            listCase.push(condition);
          }
        }

        if (this.peek().type === TokenType.BraceOpen) {
          this.next(); // Move past '{'
          const blockStatement = this.parseBlockStatement(this.peek(-1));
          cases.push({
            condition,
            block: blockStatement,
          });
          this.next(); // Move past '}'
        } else if (this.peek().value === KeywordType.Return) {
          this.next(); // Move past 'return'
          const returnStatement = this.parseReturnStatement(this.peek(-1));
          cases.push({
            condition,
            block: returnStatement,
          });
        } else if (this.peek().value === KeywordType.Break) {
          this.next(); // Move past 'break'
          const breakStatement = this.parseBreakStatement(this.peek(-1));
          cases.push({
            condition,
            block: breakStatement,
          });
        } else if (this.peek().value === KeywordType.Continue) {
          this.next(); // Move past 'continue'
          const continueStatement = this.parseContinueStatement(this.peek(-1));
          cases.push({
            condition,
            block: continueStatement,
          });
        } else {
          const caseExpr = this.parseExpression();
          cases.push({
            condition,
            block: caseExpr,
          });
        }
      } else if (this.peek().value === KeywordType.Default) {
        this.next(); // Move past 'default'
        this.expect(TokenType.Colon);
        this.next(); // Move past ':'

        if (this.peek().type === TokenType.BraceOpen) {
          this.next(); // Move past '{'
          defaultCase = this.parseBlockStatement(this.peek(-1));
          this.next(); // Move past '}'
        } else if (this.peek().value === KeywordType.Return) {
          this.next(); // Move past 'return'
          defaultCase = this.parseReturnStatement(this.peek(-1));
        } else if (this.peek().value === KeywordType.Break) {
          this.next(); // Move past 'break'
          defaultCase = this.parseBreakStatement(this.peek(-1));
        } else if (this.peek().value === KeywordType.Continue) {
          this.next(); // Move past 'continue'
          defaultCase = this.parseContinueStatement(this.peek(-1));
        } else {
          defaultCase = this.parseExpression();
        }
      } else {
        this.throwError(SyntaxCodeError.Unexpected, this.peek());
      }
    }

    this.next(); // Move past '}'

    return new MatchStatement(test, cases, defaultCase, identifier.position);
  }

  parseFunctionExpression(identifier: Token): FunctionExpression {
    let functionName = null;

    if (this.peek().type === TokenType.Identifier) {
      functionName = this.peek().value;
      this.next();
    }

    this.expect(TokenType.ParenthesisOpen);
    this.next(); // Move past '('

    const args = this.parseArgumentsAndDefault();

    this.expect(TokenType.ParenthesisClose);
    this.next(); // Move past ')'
    this.expect(TokenType.BraceOpen);

    this.next(); // Move past '{'
    const statement = this.parseBlockStatement(identifier);
    this.next(); // Move past '}'

    this.expectSemicolonOrEnd();

    return new FunctionExpression(
      functionName,
      args,
      statement,
      identifier.position,
    );
  }

  parseFunctionCall(identifier: Token) {
    this.next(); // Move past identifier
    this.expect(TokenType.ParenthesisOpen);
    this.next(); // Move past '('

    const args = this.parseArguments();

    this.expect(TokenType.ParenthesisClose);
    this.next(); // Move past ')'

    const functionCall = new FunctionCall(
      identifier.value,
      args,
      identifier.position,
    );

    if (
      this.peek().type === TokenType.BracketOpen ||
      this.peek().type === TokenType.Period ||
      (this.peek().type === TokenType.QuestionMark &&
        (this.peek(1).type === TokenType.BracketOpen ||
          this.peek(1).type === TokenType.Period))
    ) {
      return this.parseMemberExpressions(functionCall);
    }

    if (
      this.isOperator(this.peek().type) ||
      this.isReflectOperator(this.peek().value) ||
      this.peek().type === TokenType.QuestionMark
    ) {
      return this.parseExpression(functionCall);
    }

    this.expectSemicolonOrEnd();

    return functionCall;
  }

  parseDeferDeclaration(identifier: Token): DeferDeclaration {
    if (this.peek().type === TokenType.BraceOpen) {
      this.next(); // Move past '{'
      const value = this.parseBlockStatement(identifier);
      this.next(); // Move past '}'
      this.expectSemicolonOrEnd();
      return new DeferDeclaration(value, identifier.position);
    }

    const value = this.parseExpression();
    this.expectSemicolonOrEnd();
    return new DeferDeclaration(value, identifier.position);
  }

  parseDeferExpression(identifier: Token): DeferExpression {
    if (this.peek().type === TokenType.BraceOpen) {
      this.next(); // Move past '{'
      const value = this.parseBlockStatement(identifier);
      this.next(); // Move past '}'
      this.expectSemicolonOrEnd();
      return new DeferExpression(value, identifier.position);
    }

    const value = this.parseExpression();
    this.expectSemicolonOrEnd();
    return new DeferExpression(value, identifier.position);
  }

  parseImportDeclaration(
    identifier: Token,
    expression: boolean = false,
  ): ImportDeclaration {
    if (this.peek().type !== TokenType.ParenthesisOpen && expression) {
      this.throwError(SyntaxCodeError.InvalidDynamicImportUsage, identifier);
    }

    if (this.peek().type === TokenType.ParenthesisOpen && !expression) {
      const packages: Record<string, StmtType> = {};

      this.next(); // Move past '('

      while (this.peek().type !== TokenType.ParenthesisClose) {
        if (this.peek().type === TokenType.String) {
          const packageName = this.peek().value;
          this.next(); // Move past string

          packages[packageName] = new StringLiteral(
            packageName,
            this.peek(-1).position,
          );

          if (
            this.peek().type !== TokenType.Identifier &&
            this.peek().type !== TokenType.String &&
            this.peek().type !== TokenType.ParenthesisClose
          ) {
            this.expect(TokenType.Comma);
          }
        } else if (this.peek().type === TokenType.Identifier) {
          const packageName = this.peek();
          this.next(); // Move past identifier

          this.expect(TokenType.Colon);
          this.next(); // Move past ':'

          this.expect(TokenType.String);
          const importNamePackage = this.parsePrimary();

          packages[packageName.value] = importNamePackage;

          if (
            this.peek().type !== TokenType.Identifier &&
            this.peek().type !== TokenType.String &&
            this.peek().type !== TokenType.ParenthesisClose
          ) {
            this.expect(TokenType.Comma);
          }
        } else if (this.peek().type === TokenType.Comma) {
          this.next(); // Move past ','
        } else {
          this.throwError(SyntaxCodeError.Unexpected, identifier);
        }
      }
      this.expect(TokenType.ParenthesisClose);
      this.next(); // Move past ')'

      this.expectSemicolonOrEnd();

      return new ImportDeclaration(
        packages,
        null,
        null,
        expression,
        identifier.position,
      );
    }

    if (this.peek().type === TokenType.ParenthesisOpen && expression) {
      this.next(); // Move past '('

      this.expect(TokenType.String);
      const packageName = this.peek().value;
      this.next(); // Move past string
      this.expect(TokenType.ParenthesisClose);
      this.next(); // Move past ')'

      this.expectSemicolonOrEnd();

      return new ImportDeclaration(
        packageName,
        null,
        null,
        expression,
        identifier.position,
      );
    }

    this.expect(TokenType.String);
    const packageName = this.peek().value;
    this.next(); // Move past string

    if (this.peek().value === KeywordType.As) {
      this.next(); // Move past 'as'

      if (this.peek().type === TokenType.Identifier) {
        const value = this.peek().value;
        this.next(); // Move past identifier
        this.expectSemicolonOrEnd();

        return new ImportDeclaration(
          packageName,
          null,
          value,
          expression,
          identifier.position,
        );
      } else {
        this.expect(TokenType.BraceOpen);
        this.next(); // Move past '{'

        const destructuringList: string[] = [];

        while (this.peek().type !== TokenType.BraceClose) {
          this.expect(TokenType.Identifier);
          destructuringList.push(this.peek().value);
          this.next(); // Move past identifier
          if (this.peek().type !== TokenType.BraceClose) {
            this.expect(TokenType.Comma);
            this.next(); // Move past ','
          }
        }

        this.next(); // Move past '}'

        this.expectSemicolonOrEnd();

        return new ImportDeclaration(
          packageName,
          destructuringList,
          null,
          expression,
          identifier.position,
        );
      }
    }

    this.expectSemicolonOrEnd();

    return new ImportDeclaration(
      packageName,
      null,
      null,
      expression,
      identifier.position,
    );
  }

  parseExportDeclaration(identifier: Token): ExportsDeclaration {
    this.expect(TokenType.ParenthesisOpen);
    const exports: Record<string, StmtType> = {};

    this.next(); // Move past '('

    while (this.peek().type !== TokenType.ParenthesisClose) {
      if (this.peek().type === TokenType.Identifier) {
        const exportName = this.peek();
        this.next(); // Move past identifier

        if (this.peek().type === TokenType.Colon) {
          this.next(); // Move past ':'

          const importValue = this.parsePrimary();

          exports[exportName.value] = importValue;

          if (
            this.peek().type !== TokenType.Identifier &&
            this.peek().type !== TokenType.String &&
            this.peek().type !== TokenType.ParenthesisClose
          ) {
            this.expect(TokenType.Comma);
          } else continue;
        }

        exports[exportName.value] = new IdentifierLiteral(
          exportName.value,
          exportName.position,
        );

        if (
          this.peek().type !== TokenType.Identifier &&
          this.peek().type !== TokenType.String &&
          this.peek().type !== TokenType.ParenthesisClose
        ) {
          this.expect(TokenType.Comma);
        }
      } else if (this.peek().type === TokenType.String) {
        const exportName = this.peek();
        this.next(); // Move past string

        this.expect(TokenType.Colon);
        this.next(); // Move past ':'

        const importValue = this.parsePrimary();

        exports[exportName.value] = importValue;

        if (
          this.peek().type !== TokenType.Identifier &&
          this.peek().type !== TokenType.String &&
          this.peek().type !== TokenType.ParenthesisClose
        ) {
          this.expect(TokenType.Comma);
        }
      } else if (this.peek().type === TokenType.Comma) {
        this.next(); // Move past ','
      } else {
        this.throwError(SyntaxCodeError.Unexpected, identifier);
      }
    }
    this.expect(TokenType.ParenthesisClose);
    this.next(); // Move past ')'

    this.expectSemicolonOrEnd();

    return new ExportsDeclaration(exports, identifier.position);
  }

  parseEnumDeclaration(identifier: Token): EnumDeclaration {
    this.expect(TokenType.Identifier);
    this.next(); // Move past 'identifier'
    this.expect(TokenType.BraceOpen);
    this.next(); // Move past '{'

    const identifierList: { name: IdentifierLiteral; value?: StmtType }[] = [];
    const functionsList: FunctionDeclaration[] = [];

    while (this.peek().type !== TokenType.BraceClose) {
      if (this.peek().type === TokenType.Identifier) {
        const name = new IdentifierLiteral(
          this.peek().value,
          this.peek().position,
        );
        this.next(); // Move past identifier

        if (
          this.peek().type === TokenType.Semicolon ||
          this.peek().type === TokenType.Comma
        ) {
          this.next(); // Move past ';' or ','
          identifierList.push({
            name,
          });
          continue;
        }

        if (this.peek().type === TokenType.BraceClose) {
          identifierList.push({ name });
          continue;
        }

        this.expect(TokenType.OperatorAssign);
        this.next(); // Move past '='

        const value = this.parseExpression();

        identifierList.push({
          name,
          value,
        });

        if (this.peek().type === TokenType.Comma) {
          this.next(); // Move past ','
        } else {
          this.expectSemicolonOrEnd();
        }
      } else if (this.peek().value === KeywordType.Func) {
        this.next(); // Move past 'func'
        functionsList.push(this.parseFunctionDeclaration(this.peek()));
        if (this.peek().type === TokenType.Comma) {
          this.next(); // Move past ','
        } else {
          this.expectSemicolonOrEnd();
        }
      } else this.expect(TokenType.BraceClose);
    }

    this.next(); // Move past '}'

    this.expectSemicolonOrEnd();

    return new EnumDeclaration(
      identifier.value,
      identifierList,
      functionsList,
      identifier.position,
    );
  }

  /**
   * The body shared by `struct Name { ... }` and the `struct { ... }` expression.
   *
   * A member may be preceded by the modifiers `private` and `static`, in either order:
   *
   *     struct Counter {
   *       static var created = 0;
   *       private var count;
   *
   *       private func bump() { ... }
   *       static func describe() { ... }
   *     }
   *
   * They are contextual: `private` and `static` are ordinary identifiers everywhere else
   * in the language, and only act as modifiers directly inside a struct body.
   *
   * A method may also be named after a language symbol instead of an identifier, which is
   * how a struct joins a protocol of the language itself:
   *
   *     struct Report {
   *       func [symbol.dispose]() { ... }    // `defer Report(...)` releases it
   *       func [symbol.iterator]() { ... }   // `for (x in report)` walks it
   *     }
   *
   * The brackets hold an ordinary expression, evaluated once per instance, so
   * `[symbol.dispose]` and anything that reaches the same symbol are the same member.
   */
  parseStructBody(): {
    fields: VariableDeclaration[];
    methods: FunctionDeclaration[];
    modifiers: StructModifiers;
    symbolMethods: StructSymbolMethod[];
  } {
    this.expect(TokenType.BraceOpen);
    this.next();

    const fields: VariableDeclaration[] = [];
    const methods: FunctionDeclaration[] = [];
    const symbolMethods: StructSymbolMethod[] = [];
    const modifiers: StructModifiers = Object.create(null);

    while (this.peek().type !== TokenType.BraceClose) {
      const member = noModifiers();
      let sawModifier = false;
      let modifierToken = this.peek();

      // collect `private` / `static` in any order, at most once each
      for (;;) {
        const token = this.peek();

        if (
          token.type !== TokenType.Identifier ||
          (token.value !== "private" && token.value !== "static")
        ) {
          break;
        }

        const kind = token.value as "private" | "static";

        if (member[kind]) {
          this.throwError(SyntaxCodeError.StructModifierDuplicate, {
            modifier: kind,
            position: token.position,
          });
        }

        member[kind] = true;
        sawModifier = true;
        modifierToken = token;

        this.next(); // Move past the modifier
      }

      if (this.peek().value === KeywordType.Var) {
        this.next(); // Move past 'var'

        if (this.peek().type === TokenType.BracketOpen) {
          this.throwError(SyntaxCodeError.StructSymbolField, this.peek());
        }

        const variable = this.parseVariableDeclaration(this.peek());

        if (
          variable instanceof CombinedVariableDeclaration ||
          variable instanceof DestructuringDeclaration
        ) {
          this.throwError(SyntaxCodeError.StructValidFields, variable);
        }

        fields.push(variable);
        modifiers[variable.name] = member;
      } else if (this.peek().value === KeywordType.Func) {
        this.next(); // Move past 'func'

        if (this.peek().type === TokenType.BracketOpen) {
          if (sawModifier) {
            this.throwError(SyntaxCodeError.StructSymbolModifier, {
              modifier: member.private ? "private" : "static",
              position: modifierToken.position,
            });
          }

          symbolMethods.push(this.parseStructSymbolMethod());

          continue;
        }

        const method = this.parseFunctionDeclaration(this.peek());

        methods.push(method);
        modifiers[method.name] = member;
      } else if (sawModifier) {
        this.throwError(SyntaxCodeError.StructModifierInvalid, {
          modifier:
            member.private && member.static
              ? "private static"
              : member.private
                ? "private"
                : "static",
          position: modifierToken.position,
        });
      } else {
        this.expect(TokenType.BraceClose);
      }
    }

    this.next(); // Move past '}'

    this.expectSemicolonOrEnd();

    return { fields, methods, modifiers, symbolMethods };
  }

  /**
   * `func [<expression>](args) { body }` inside a struct body, with the leading `func`
   * already consumed.
   *
   * The function is given the bracketed source as its name (`[symbol.dispose]`) so a stack
   * trace reads the way the member was written; nothing looks it up by that name, because
   * the real key is the symbol the expression evaluates to at instantiation.
   */
  parseStructSymbolMethod(): StructSymbolMethod {
    const open = this.peek();

    this.next(); // Move past '['

    const start = this.offset;
    const key = this.parseExpression();

    this.expect(TokenType.BracketClose);

    const source = this.tokens
      .slice(start, this.offset)
      .map(({ value }) => value)
      .join("");

    this.next(); // Move past ']'

    this.expect(TokenType.ParenthesisOpen);
    this.next(); // Move past '('

    const args = this.parseArgumentsAndDefault();

    this.expect(TokenType.ParenthesisClose);
    this.next(); // Move past ')'

    this.expect(TokenType.BraceOpen);
    this.next(); // Move past '{'

    const body = this.parseBlockStatement(open);

    this.next(); // Move past '}'

    this.expectSemicolonOrEnd();

    return {
      key,
      method: new FunctionDeclaration(`[${source}]`, args, body, open.position),
    };
  }

  parseStructDeclaration(identifier: Token): StructDeclaration {
    this.expect(TokenType.Identifier);
    const structName = this.peek().value;
    this.next(); // Move past 'identifier'

    const { fields, methods, modifiers, symbolMethods } =
      this.parseStructBody();

    return new StructDeclaration(
      structName,
      fields,
      methods,
      identifier.position,
      modifiers,
      symbolMethods,
    );
  }

  parseStructExpression(identifier: Token): StructExpression {
    let structName = null;

    if (this.peek().type === TokenType.Identifier) {
      structName = this.peek().value;
      this.next(); // Move past 'identifier'
    }

    const { fields, methods, modifiers, symbolMethods } =
      this.parseStructBody();

    return new StructExpression(
      structName,
      fields,
      methods,
      identifier.position,
      modifiers,
      symbolMethods,
    );
  }

  parseExpression(left?: StmtType, precedence = 0): StmtType {
    left ??= this.parsePrimary();

    while (this.getPrecedence(this.peek()) > precedence) {
      const token = this.peek();

      if (token.type === TokenType.QuestionMark) {
        this.next(); // Move past '?'
        const expressionIfTrue = this.parseExpression(undefined, 0);

        this.expect(TokenType.Colon);
        this.next(); // Move past ':'

        // right associative: `a ? b : c ? d : e` is `a ? b : (c ? d : e)`
        const expressionIfFalse = this.parseExpression(
          undefined,
          this.getPrecedence(token) - 1,
        );

        left = new TernaryExpression(
          left,
          expressionIfTrue,
          expressionIfFalse,
          left.position,
        );
      } else {
        this.next();
        const right = this.parseExpression(
          undefined,
          this.getPrecedence(token),
        );
        left = new BinaryExpression(
          token.value as OperatorType,
          left,
          right,
          token.position,
        );
      }
    }

    if (this.isReflectOperator(this.peek().value)) {
      return this.parseReflectExpression(left);
    }

    return left;
  }

  parseUpdateExpression(identifier: IdentifierLiteral): UpdateExpression {
    const operator = this.peek();

    this.next(); // Move past '++' or '--'

    this.expectSemicolonOrEnd();

    return new UpdateExpression(
      identifier,
      operator.value as OperatorType,
      operator.position,
    );
  }

  parseUnaryExpression(operator: Token): VisitUnaryExpression {
    this.next(); // Move past '!', '+', '~' and '-'

    const right = this.parsePrimary();

    return new VisitUnaryExpression(
      operator.value as OperatorType,
      right,
      operator.position,
    );
  }

  parseReflectExpression(left: Token | StmtType): StmtType {
    const operator = this.peek();
    this.next();

    if (this.peek().type === TokenType.ParenthesisOpen) {
      this.next(); // Move past '('

      const right = this.parseExpression();
      this.expect(TokenType.ParenthesisClose);
      this.next(); // Move past ')'

      const reflect = new ReflectionExpression(
        operator.value as ReflectType,
        left instanceof Token ? null : left,
        right,
        operator.position,
      );

      if (this.isReflectOperator(this.peek().value)) {
        return this.parseReflectExpression(reflect);
      } else if (this.isOperator(this.peek().type)) {
        return this.parseExpression(reflect);
      }

      return reflect;
    }

    const previousTight = this.tightMember;

    if (operator.value === ReflectType.Typeof) this.tightMember = true;

    const right = this.parsePrimary();

    this.tightMember = previousTight;

    const reflect = new ReflectionExpression(
      operator.value as ReflectType,
      left instanceof Token ? null : left,
      right,
      operator.position,
    );

    if (this.isReflectOperator(this.peek().value)) {
      return this.parseReflectExpression(reflect);
    }

    return reflect;
  }

  parseArguments(): StmtType[] {
    const args: StmtType[] = [];

    while (this.peek().type !== TokenType.ParenthesisClose) {
      args.push(this.parseExpression());
      if (this.peek().type === TokenType.Comma) {
        this.next(); // Skip comma
      }
    }

    return args;
  }

  parseArgumentsAndDefault(): [string, StmtType, true?][] {
    const args: [string, StmtType, true?][] = [];

    while (this.peek().type !== TokenType.ParenthesisClose) {
      if (this.peek().type === TokenType.OperatorRest) {
        this.next(); // Move past '...'
        this.expect(TokenType.Identifier);
        const param = this.peek();
        this.next(); // Move past identifier
        args.push([param.value, new NilLiteral(param.position), true]);

        if (this.peek().type !== TokenType.ParenthesisClose) {
          this.throwError(SyntaxCodeError.RestInvalid, this.peek());
        }
        break;
      }

      this.expect(TokenType.Identifier);
      const param = this.peek();
      this.next(); // Move past identifier

      if (this.peek().type === TokenType.OperatorAssign) {
        this.next(); // Move past '='
        const defaultParameters = this.parseExpression();
        args.push([param.value, defaultParameters]);
        if (this.peek().type === TokenType.Comma) {
          this.next(); // Skip comma
        }
      } else {
        args.push([param.value, new NilLiteral(param.position)]);
        if (this.peek().type === TokenType.Comma) {
          this.next(); // Skip comma
        }
      }
    }

    return args;
  }

  parseMethodCall(identifier: Token) {
    this.next(); // Move past '.'

    const method = this.peek();
    this.next(); // Move past 'identifier' method

    this.expect(TokenType.ParenthesisOpen);
    this.next(); // Move past '('

    const args = this.parseArguments();

    this.expect(TokenType.ParenthesisClose);
    this.next(); // Move past ')'

    const callExpression = new CallExpression(
      identifier.value,
      method.value,
      new IdentifierLiteral(identifier.value, identifier.position),
      args,
      identifier.position,
    );

    if (
      this.peek().type === TokenType.BracketOpen ||
      this.peek().type === TokenType.Period ||
      (this.peek().type === TokenType.QuestionMark &&
        (this.peek(1).type === TokenType.BracketOpen ||
          this.peek(1).type === TokenType.Period))
    ) {
      return this.parseMemberExpressions(callExpression);
    }

    if (
      this.isOperator(this.peek().type) ||
      this.isReflectOperator(this.peek().value) ||
      this.peek().type === TokenType.QuestionMark
    ) {
      return this.parseExpression(callExpression);
    }

    this.expectSemicolonOrEnd();

    return callExpression;
  }

  parseMemberExpressions(identifier: StmtType): any {
    const tight = this.tightMember;

    this.tightMember = false;

    const isMemberExpression = (token: TokenType) =>
      token === TokenType.BracketOpen ||
      token === TokenType.Period ||
      (token === TokenType.QuestionMark &&
        (this.peek(1).type === TokenType.BracketOpen ||
          this.peek(1).type === TokenType.Period));

    let object = identifier;

    while (isMemberExpression(this.peek().type)) {
      let isOptional = false;
      if (this.peek().type === TokenType.QuestionMark) {
        this.next(); // Move past '?'
        isOptional = true;
      }
      const tokenType = this.peek().type;
      const isComputed = tokenType === TokenType.BracketOpen;
      this.next();

      let property;

      if (tokenType === TokenType.BracketOpen) {
        const token = this.peek();
        property = this.parseExpression();
        this.expect(TokenType.BracketClose);
        this.next(); // Move past ']'

        if (this.peek().type === TokenType.ParenthesisOpen) {
          const methodName = new StringLiteral(token.value, token.position);

          this.next(); // Move past '('
          const args = this.parseArguments();
          this.expect(TokenType.ParenthesisClose);
          this.next(); // Move past ')'

          this.expectSemicolonOrEnd();

          const callExpression = new CallExpression(
            "value" in identifier ? <string>identifier.value : methodName.value,
            property,
            object as MemberExpression,
            args,
            methodName.position,
          );

          if (isMemberExpression(this.peek().type)) {
            return this.parseMemberExpressions(callExpression);
          }

          return callExpression;
        }
      } else if (tokenType === TokenType.Period) {
        if (this.peek(1).type === TokenType.ParenthesisOpen) {
          const methodName = new StringLiteral(
            this.peek().value,
            this.peek().position,
          );
          this.next(); // Move past identifier

          this.next(); // Move past '('
          const args = this.parseArguments();
          this.expect(TokenType.ParenthesisClose);
          this.next(); // Move past ')'

          this.expectSemicolonOrEnd();

          const callExpression = new CallExpression(
            methodName.value,
            methodName.value,
            object as MemberExpression,
            args,
            methodName.position,
          );

          if (isMemberExpression(this.peek().type)) {
            return this.parseMemberExpressions(callExpression);
          }

          return callExpression;
        }

        property = new StringLiteral(this.peek().value, this.peek().position);
        this.next(); // Move past identifier
      } else {
        this.throwError(SyntaxCodeError.Unexpected, this.peek());
      }

      object = new MemberExpression(
        object,
        property,
        isComputed,
        isOptional,
        object.position,
      );
    }

    if (this.isOperatorAssign(this.peek().type)) {
      const tokenType = this.peek();
      this.next(); // Move past assign operator
      const expression = this.parseExpression();

      this.expectSemicolonOrEnd();

      return new AssignmentExpression(
        object,
        tokenType.type,
        expression,
        tokenType.position,
      );
    }

    if (
      object instanceof MemberExpression &&
      (this.peek().type === TokenType.OperatorPlusPlus ||
        this.peek().type === TokenType.OperatorMinusMinus)
    ) {
      const operator = this.peek();

      this.next(); // Move past '++' or '--'

      const update = new UpdateExpression(
        object,
        operator.value as OperatorType,
        operator.position,
      );

      if (this.peek().type === TokenType.Semicolon) {
        this.next();
        return update;
      }

      if (!tight && this.isOperator(this.peek().type)) {
        return this.parseExpression(update);
      }

      return update;
    }

    if (
      !tight &&
      (this.isOperator(this.peek().type) ||
        this.isReflectOperator(this.peek().value) ||
        this.peek().type === TokenType.QuestionMark)
    ) {
      return this.parseExpression(object);
    }

    return object;
  }

  parseAssignmentExpression(token: StmtType): AssignmentExpression {
    if (!this.isOperatorAssign(this.peek().type)) {
      this.throwError(SyntaxCodeError.Unexpected, this.peek());
    }

    const tokenType = this.peek();
    this.next(); // Move past assign operator

    const expression = this.parseExpression();

    this.expectSemicolonOrEnd();

    return new AssignmentExpression(
      token,
      tokenType.type,
      expression,
      tokenType.position,
    );
  }

  parsePrimary(): StmtType {
    const token = this.peek();

    switch (token.type) {
      case TokenType.String: {
        const strings = new StringLiteral(token.value, token.position);
        this.next();
        if (
          this.peek().type === TokenType.BracketOpen ||
          this.peek().type === TokenType.Period ||
          (this.peek().type === TokenType.QuestionMark &&
            (this.peek(1).type === TokenType.BracketOpen ||
              this.peek(1).type === TokenType.Period))
        ) {
          return this.parseMemberExpressions(strings);
        }
        return strings;
      }
      case TokenType.InterpolatedString: {
        const strings = this.parseInterpolatedString(token);
        this.next();
        if (
          this.peek().type === TokenType.BracketOpen ||
          this.peek().type === TokenType.Period ||
          (this.peek().type === TokenType.QuestionMark &&
            (this.peek(1).type === TokenType.BracketOpen ||
              this.peek(1).type === TokenType.Period))
        ) {
          return this.parseMemberExpressions(strings);
        }
        return strings;
      }
      case TokenType.Int: {
        const ints = new IntLiteral(token.value, token.position);
        this.next();
        return ints;
      }
      case TokenType.Float: {
        const floats = new FloatLiteral(token.value, token.position);
        this.next();
        return floats;
      }
      case TokenType.Bool: {
        const bools = new BoolLiteral(token.value, token.position);
        this.next();
        return bools;
      }
      case TokenType.Nil: {
        const nils = new NilLiteral(token.position);
        this.next();
        return nils;
      }
      case TokenType.Identifier: {
        const identifier = new IdentifierLiteral(token.value, token.position);
        if (this.peek(1).type === TokenType.ParenthesisOpen) {
          return this.parseFunctionCall(token);
        } else if (
          this.peek(1).type === TokenType.Period &&
          this.peek(2).type === TokenType.Identifier &&
          this.peek(3).type === TokenType.ParenthesisOpen
        ) {
          this.next();
          return this.parseMethodCall(token);
        } else if (
          this.peek(1).type === TokenType.BracketOpen ||
          this.peek(1).type === TokenType.Period ||
          (this.peek(1).type === TokenType.QuestionMark &&
            (this.peek(2).type === TokenType.BracketOpen ||
              this.peek(2).type === TokenType.Period))
        ) {
          this.next();
          return this.parseMemberExpressions(identifier);
        } else if (this.isOperatorAssign(this.peek(1).type)) {
          this.next();
          return this.parseAssignmentExpression(identifier);
        } else if (
          [OperatorType.PlusPlus, OperatorType.MinusMinus].includes(
            this.peek(1).value as OperatorType,
          )
        ) {
          this.next();
          return this.parseUpdateExpression(identifier);
        }
        this.next();
        return identifier;
      }
      case TokenType.Keyword: {
        if (token.value === KeywordType.Import) {
          if (
            this.peek(1).type === TokenType.BracketOpen ||
            this.peek(1).type === TokenType.Period ||
            (this.peek(1).type === TokenType.QuestionMark &&
              (this.peek(2).type === TokenType.BracketOpen ||
                this.peek(2).type === TokenType.Period))
          ) {
            this.next();
            return this.parseMemberExpressions(
              new IdentifierLiteral(token.value, token.position),
            );
          }
          this.next();

          const importDeclaration = this.parseImportDeclaration(
            this.peek(),
            true,
          );

          if (
            this.peek().type === TokenType.BracketOpen ||
            this.peek().type === TokenType.Period ||
            (this.peek().type === TokenType.QuestionMark &&
              (this.peek(1).type === TokenType.BracketOpen ||
                this.peek(1).type === TokenType.Period))
          ) {
            return this.parseMemberExpressions(importDeclaration);
          }

          return importDeclaration;
        } else if (token.value === KeywordType.Wait) {
          if (
            this.peek(1).type === TokenType.BracketOpen ||
            this.peek(1).type === TokenType.Period ||
            (this.peek(1).type === TokenType.QuestionMark &&
              (this.peek(2).type === TokenType.BracketOpen ||
                this.peek(2).type === TokenType.Period))
          ) {
            this.next();
            return this.parseMemberExpressions(
              new IdentifierLiteral(token.value, token.position),
            );
          }
          this.next();

          const waitDeclaration = this.parseWaitExpression(this.peek());

          if (
            this.peek().type === TokenType.BracketOpen ||
            this.peek().type === TokenType.Period ||
            (this.peek().type === TokenType.QuestionMark &&
              (this.peek(1).type === TokenType.BracketOpen ||
                this.peek(1).type === TokenType.Period))
          ) {
            return this.parseMemberExpressions(waitDeclaration);
          }

          return waitDeclaration;
        } else if (token.value === KeywordType.Func) {
          if (
            (this.peek(1).type === TokenType.Identifier &&
              this.peek(2).type === TokenType.ParenthesisOpen) ||
            this.peek(1).type === TokenType.ParenthesisOpen
          ) {
            this.next();
            return this.parseFunctionExpression(token);
          }
        } else if (token.value === KeywordType.Match) {
          this.next();
          return this.parseMatchStatement(this.peek());
        } else if (token.value === KeywordType.Wait) {
          this.next();
          return this.parseWaitExpression(this.peek(-1));
        } else if (token.value === KeywordType.Spawn) {
          if (!this.isSpawnExperimental) {
            emitWarning('"spawn" or "wait" is experimental.', {
              name: "WaitExperimental",
              code: "WARN003",
            });
            this.isSpawnExperimental = true;
          }
          this.next();
          return this.parseSpawnExpression(this.peek(-1));
        } else if (token.value === KeywordType.Struct) {
          this.next();
          return this.parseStructExpression(this.peek(-1));
        } else if (token.value === KeywordType.Try) {
          this.next();
          return this.parseTryCatchExpression(this.peek(-1));
        } else if (token.value === KeywordType.Defer) {
          this.next();
          return this.parseDeferExpression(this.peek(-1));
        }
        this.throwError(SyntaxCodeError.Unexpected, token);
      }
      case TokenType.BracketOpen: {
        return this.parseArrayExpression(token);
      }
      case TokenType.BraceOpen: {
        return this.parseObjectExpression(token);
      }
      case TokenType.OperatorAdd:
      case TokenType.OperatorSubtract:
      case TokenType.OperatorNot:
      case TokenType.OperatorBitNot: {
        return this.parseUnaryExpression(token);
      }
      case TokenType.Reflect: {
        return this.parseReflectExpression(token);
      }
      case TokenType.ParenthesisOpen: {
        const identifier = this.peek(-1);
        if (identifier.type === TokenType.Identifier) {
          this.next(); // Skip '('
          const args = this.parseArguments();
          this.expect(TokenType.ParenthesisClose);
          this.next(); // Skip ')'
          return new FunctionCall(identifier.value, args, identifier.position);
        }

        this.next(); // Skip '('

        const expr = this.parseExpression();

        this.expect(TokenType.ParenthesisClose);
        this.next(); // Skip ')'

        return expr;
      }
      default: {
        this.throwError(SyntaxCodeError.Unexpected, token);
      }
    }
  }

  parseBlockStatement(identifier: Token): BlockStatement {
    const statement = [];
    while (this.peek().type !== TokenType.BraceClose) {
      statement.push(this.parseStatement());
    }
    return new BlockStatement(statement, identifier.position);
  }

  expectSemicolonOrEnd(): void {
    const token = this.peek();

    if (token.type === TokenType.Semicolon) {
      this.next();
    }
  }

  private static readonly OPERATOR_SET = new Set([
    TokenType.OperatorAdd,
    TokenType.OperatorSubtract,
    TokenType.OperatorMultiply,
    TokenType.OperatorExponentiation,
    TokenType.OperatorDivide,
    TokenType.OperatorNotEqual,
    TokenType.OperatorEqual,
    TokenType.OperatorModulo,
    TokenType.OperatorGreaterThanOrEqual,
    TokenType.OperatorLessThan,
    TokenType.OperatorGreaterThan,
    TokenType.OperatorLessThanOrEqual,
    TokenType.OperatorAnd,
    TokenType.OperatorLogicalAnd,
    TokenType.OperatorOr,
    TokenType.OperatorLogicalOr,
    TokenType.OperatorBitXor,
    TokenType.OperatorShiftLeft,
    TokenType.OperatorShiftRight,
    TokenType.OperatorShiftRightZeroFill,
  ]);

  private static readonly OPERATOR_ASSIGN_SET = new Set([
    TokenType.OperatorAssign,
    TokenType.OperatorAssignPlus,
    TokenType.OperatorAssignMinus,
    TokenType.OperatorAssignMultiply,
    TokenType.OperatorAssignDivide,
    TokenType.OperatorAssignModule,
    TokenType.OperatorAssignPow,
    TokenType.OperatorAndAssign,
    TokenType.OperatorOrAssign,
    TokenType.OperatorBitAndAssign,
    TokenType.OperatorBitOrAssign,
    TokenType.OperatorBitXorAssign,
    TokenType.OperatorShiftLeftAssign,
    TokenType.OperatorShiftRightAssign,
    TokenType.OperatorShiftRightZeroFillAssign,
  ]);

  private static readonly UNARY_OPERATOR_SET = new Set([
    TokenType.OperatorAdd,
    TokenType.OperatorSubtract,
    TokenType.OperatorNot,
    TokenType.OperatorBitNot,
  ]);

  isOperator(tokenType: TokenType): boolean {
    return Parser.OPERATOR_SET.has(tokenType);
  }

  isOperatorAssign(tokenType: TokenType): boolean {
    return Parser.OPERATOR_ASSIGN_SET.has(tokenType);
  }

  isUnaryOperator(tokenType: TokenType): boolean {
    return Parser.UNARY_OPERATOR_SET.has(tokenType);
  }

  isReflectOperator(tokenValue: string): boolean {
    return [ReflectType.Typeof, ReflectType.In].includes(
      tokenValue as ReflectType,
    );
  }

  getPrecedence(token: Token): number {
    switch (token.type) {
      case TokenType.OperatorExponentiation:
        return 15;
      case TokenType.OperatorMultiply:
        return 14;
      case TokenType.OperatorDivide:
        return 14;
      case TokenType.OperatorModulo:
        return 14;
      case TokenType.OperatorAdd:
        return 13;
      case TokenType.OperatorSubtract:
        return 13;
      case TokenType.OperatorShiftLeft:
        return 12;
      case TokenType.OperatorShiftRight:
        return 12;
      case TokenType.OperatorShiftRightZeroFill:
        return 12;
      case TokenType.OperatorLessThan:
        return 11;
      case TokenType.OperatorGreaterThan:
        return 11;
      case TokenType.OperatorLessThanOrEqual:
        return 11;
      case TokenType.OperatorGreaterThanOrEqual:
        return 11;
      case TokenType.OperatorEqual:
        return 10;
      case TokenType.OperatorNotEqual:
        return 10;
      case TokenType.OperatorAnd:
        return 9;
      case TokenType.OperatorBitXor:
        return 8;
      case TokenType.OperatorOr:
        return 7;
      case TokenType.OperatorLogicalAnd:
        return 6;
      case TokenType.OperatorLogicalOr:
        return 5;
      case TokenType.QuestionMark:
        return 4;
      default:
        return 0;
    }
  }

  peek(offset = 0): Token {
    const index = this.offset + offset;
    return (
      this.tokens[index] ??
      this.tokens[this.tokens.length - 1] ??
      new Token("", TokenType.EndOf, new Position(0, 0))
    );
  }

  next(): void {
    this.offset++;
  }

  expect(tokenType: TokenType): Token {
    const token = this.peek();

    if (token.type !== tokenType) {
      this.throwError(SyntaxCodeError.ExpectedToken, {
        ...token,
        expectedTokenType: tokenType,
        foundTokenType: token.type,
      });
    }

    return token;
  }

  eof(): boolean {
    return this.peek()?.type === TokenType.EndOf;
  }

  throwError(code: SyntaxCodeError, format: Record<string, any>): never {
    if (!format.position) {
      format = { position: format };
    }

    throw new SyntaxError(code, {
      line: format.position.line,
      column: format.position.column,
      ...format,
    });
  }
}

export { Parser };
