import { FunctionBuilder } from "../../../library/FunctionBuilder";
import { Environment } from "../../Environment";
import fs from "node:fs";
import { extname, join as joinPath, resolve as resolvePath } from "node:path";
import { type StmtType } from "../../ast/StmtType";
import { ImportDeclaration } from "../../ast/declaration/ImportDeclaration";
import {
  ImportFaildError,
  ImportFaildCodeError,
} from "../../errors/runtime/ImportFaildError";
import { Bytes } from "../../../library/bytes/Bytes";
import { type Gen } from "../../runtime/coroutine";

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

class resolve extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return {
      name: "module",
      path: __dirname,
    };
  }

  *call() {
    const [moduleName] = this.args;

    const moduleNameExt = extname(moduleName || "");

    if (
      moduleNameExt === ".ml" ||
      moduleNameExt === ".json" ||
      moduleNameExt === ".js"
    ) {
      const resolvedPath = resolvePath(
        this.environment.get("import").base,
        moduleName,
      );

      if (fileExists(resolvedPath)) {
        return resolvedPath;
      }
    }

    throw new ImportFaildError(ImportFaildCodeError.ImportFindModuleFaild, {
      name: moduleName,
      cause: {
        packageName: moduleName,
      },
      files: this.environment.get("import").paths,
    });
  }
}

class asImport extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return {
      name: "module",
      path: __dirname,
    };
  }

  *call(): Gen<any> {
    const [path, targetType = "buffer"] = this.args;

    if (["mylang", "json", "buffer"].indexOf(targetType) === -1) {
      throw new ImportFaildError(ImportFaildCodeError.ImportTargetType, {
        targetType,
        cause: {
          packageName: path,
        },
        files: this.environment.get("import").paths,
      });
    }

    if (targetType === "json") {
      return yield ImportDeclaration.prototype.resolveJSONModule.bind(
        ImportDeclaration,
      )(path, this.environment);
    } else if (targetType === "mylang") {
      return yield ImportDeclaration.prototype.resolveFileModule.bind(
        ImportDeclaration,
      )(path, this.environment);
    } else {
      const fullPath = joinPath(this.environment.get("import").base, path);

      if (
        this.environment.get("import").cache[fullPath] &&
        !this.environment.get("#options").disableCache
      )
        return new Bytes(
          [Buffer.from(this.environment.get("import").cache[fullPath])],
          [],
          this.environment,
        ).call();

      if (!fileExists(fullPath)) {
        throw new ImportFaildError(ImportFaildCodeError.ImportFindModuleFaild, {
          name: fullPath,
          cause: {
            fullPath,
          },
          files: this.environment.get("import").paths,
        });
      }

      const content = fs.readFileSync(fullPath, "utf8").toString();

      return new Bytes([content], [], this.environment).call();
    }
  }
}

export { resolve, asImport };
