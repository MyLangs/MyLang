import fetch from "node-fetch";
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { defineMember } from "../../runtime/members";
import { join as joinPath, parse as parsePath } from "node:path";
import { StmtType } from "../StmtType";
import { type Position } from "../../lexer/token/Position";
import { Bytes } from "../../../library/bytes/Bytes";
import { Environment } from "../../Environment";
import { security, integrity } from "../../security";
import {
  FileReadFaildError,
  FileReadFaildCodeError,
} from "../../errors/runtime/FileReadFaildError";
import {
  ImportFaildError,
  ImportFaildCodeError,
} from "../../errors/runtime/ImportFaildError";
import { runInTask } from "../../utils/utils";
import { lift, hostAwait, type Gen } from "../../runtime/coroutine";
import { BaseError } from "../../errors/BaseError";

function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

/**
 * Every module that ships with the interpreter.
 *
 * They can be imported either bare (`import "fs"`) or through the `core:` namespace
 * (`import "core:fs"`). The namespaced form is unambiguous: it can never be shadowed by a
 * project dependency of the same name, which is why it is the recommended spelling.
 */
const buildInModule = [
  "coreio",
  "syncbox",
  "strings",
  "arrays",
  "objects",
  "random",
  "path",
  "os",
  "os/system",
  "uuid",
  "iter",
  "collections",
  "net/http",
  "net/url",
  "utils/colors",
  "bytes",
  "fs",
  "fs/stream",
  "events",
  "runtime",
  "time",
  "numbers",
  "numbers/bigint",
  "utils",
  "json",
  "crypto",
  "test",
  "binary",
  "validation",
  "compress",
  "archive",
  "dns",
  "tcp",
  "udp",
  "ws",
  "workers",
  "process",
  "tls",
];

const CORE_NAMESPACE = "core:";

/** `true` for `core:<name>` where `<name>` is a module that ships with the interpreter. */
function isCoreModule(packageName: string): boolean {
  if (!packageName.startsWith(CORE_NAMESPACE)) return false;

  return buildInModule.includes(packageName.slice(CORE_NAMESPACE.length));
}

/** `core:fs` -> `fs`; anything else is returned unchanged. */
function stripCoreNamespace(packageName: string): string {
  return packageName.startsWith(CORE_NAMESPACE)
    ? packageName.slice(CORE_NAMESPACE.length)
    : packageName;
}

/**
 * The variable a built-in binds to when no alias is given:
 * `fs` -> `fs`, `net/http` -> `http`, `core:numbers/bigint` -> `bigint`.
 */
function defaultBindingName(moduleName: string): string {
  const bare = stripCoreNamespace(moduleName);

  return bare.includes("/") ? bare.split("/").pop()! : bare;
}

function unwrapExports(module: any): any {
  if (module === null || typeof module !== "object") return module;

  const wrapped = Object.keys(module).some(
    (key) => module[key]?.[Environment.SymbolExports],
  );

  if (!wrapped) return module;

  const plain: Record<string, any> = {};

  for (const key in module) {
    defineMember(
      plain,
      key,
      module[key]?.[Environment.SymbolExports]
        ? module[key].value
        : module[key],
    );
  }

  return plain;
}

class ImportDeclaration extends StmtType {
  public readonly position: Position;
  public readonly expression: boolean;
  public readonly destructuring: string[] | null;
  public readonly aliases: string | null;
  public readonly package: string | Record<string, StmtType>;

  constructor(
    packageName: string | Record<string, StmtType>,
    destructuring: string[] | null,
    aliases: string | null,
    expression: boolean,
    position: Position,
  ) {
    super();

    this.package = packageName;

    this.destructuring = destructuring;

    this.aliases = aliases;

    this.expression = expression;

    this.position = position;
  }

  *resolveJSONModule(source: string, score: Environment): Gen<any> {
    const fullPath = joinPath(score.get("import").base, source);

    security.read(fullPath);

    if (
      score.get("import").cache[fullPath] &&
      !score.get("#options").disableCache
    )
      return yield lift(score.get("import").cache[fullPath]);

    try {
      const json = JSON.parse(readFileSync(fullPath, "utf8").toString());

      score.update("import", {
        ...score.get("import"),
        ...(!score.get("#options").disableCache && {
          cache: {
            ...score.get("import").cache,
            [fullPath]: json,
          },
        }),
        paths: Array.from(
          new Set([score.get("import").main, ...score.get("import").paths]),
        ),
      });

      return yield lift(json);
    } catch (err) {
      throw new FileReadFaildError(FileReadFaildCodeError.JSONReadFaild, {
        err: String(err).split(":").slice(1).join("").trim().toLowerCase(),
        fullPath,
        files: score.get("import").paths,
      });
    }
  }

  *resolveHTTPModule(url: string, score: Environment): Gen<any> {
    security.net(url);

    if (
      !this.destructuring &&
      score.get("import").cache[url] &&
      !score.get("#options").disableCache
    ) {
      return yield lift(score.get("import").cache[url]);
    }

    const response = yield hostAwait(fetch(url));

    if (!response.ok) {
      throw new ImportFaildError(ImportFaildCodeError.ImportHttpFaild, {
        statusCode: response.status,
        cause: {
          url,
          statusCode: response.status,
          statusText: response.statusText,
        },
        files: score.get("import").paths,
      });
    }

    const responseData: string = yield hostAwait(response.text());

    if (responseData.startsWith("Error:")) {
      throw responseData;
    }

    integrity.verify(url, responseData);

    if (parsePath(url).ext === ".json") {
      try {
        const json = JSON.parse(responseData);

        score.update("import", {
          ...score.get("import"),
          ...(!score.get("#options").disableCache && {
            cache: {
              ...score.get("import").cache,
              [url]: json,
            },
          }),
          paths: Array.from(
            new Set([score.get("import").main, ...score.get("import").paths]),
          ),
        });

        return yield lift(json);
      } catch (err) {
        throw new ImportFaildError(ImportFaildCodeError.ImportHttpJsonFaild, {
          err: String(err),
          cause: {
            url,
            statusCode: response.status,
            statusText: response.statusText,
          },
          files: score.get("import").paths,
        });
      }
    } else {
      try {
        const context = yield runInTask(responseData, {
          base: score.get("import").base,
          main: url,
          ...(!score.get("#options").disableCache && {
            cache: {
              ...score.get("import").cache,
              [url]: score.get("#exports"),
            },
          }),
          paths: Array.from(
            new Set([score.get("import").main, ...score.get("import").paths]),
          ),
          options: score.get("#options"),
        });

        const expModule: Record<string, any> = {};
        const contextExports = context.interpreter.globalScore.get("#exports");

        for (const key in contextExports) {
          if (contextExports[key]?.[Environment.SymbolExports]) {
            defineMember(expModule, key, contextExports[key].value);
          } else {
            defineMember(expModule, key, contextExports[key]);
          }
        }

        score.update("import", {
          ...score.get("import"),
          ...(!score.get("#options").disableCache && {
            cache: {
              ...score.get("import").cache,
              [url]: expModule,
            },
          }),
          paths: Array.from(new Set([url, ...score.get("import").paths])),
        });

        return yield lift(context.interpreter.globalScore.get("#exports"));
      } catch (err: any) {
        throw new ImportFaildError(ImportFaildCodeError.ImportHttpFileFaild, {
          err: "message" in err ? err.message : String(err),
          cause: {
            url,
            statusCode: response.status,
            statusText: response.statusText,
          },
          files: score.get("import").paths,
        });
      }
    }
  }

  *resolveBuildInModule(source: string, score: Environment): Gen<any> {
    if (
      score.get("import").cache[source] &&
      !score.get("#options").disableCache
    )
      return yield lift(score.get("import").cache[source]);

    const resolvePackage = require(`../../../library/${source}/index.js`);

    score.update("import", {
      ...score.get("import"),
      ...(!score.get("#options").disableCache && {
        cache: {
          ...score.get("import").cache,
          [source]: resolvePackage,
        },
      }),
      paths: Array.from(
        new Set([score.get("import").main, ...score.get("import").paths]),
      ),
    });

    return yield lift(resolvePackage);
  }

  *resolveFileModule(source: string, score: Environment): Gen<any> {
    const fullPath = joinPath(score.get("import").base, source);

    security.read(fullPath);

    if (
      !this.destructuring &&
      score.get("import").cache[fullPath] &&
      !score.get("#options").disableCache
    )
      return yield lift(score.get("import").cache[fullPath]);

    if (!fileExists(fullPath)) {
      throw new ImportFaildError(ImportFaildCodeError.ImportNoSuchFile, {
        fullPath,
        cause: {
          fullPath,
        },
        files: score.get("import").paths,
      });
    }

    if (fullPath.endsWith(".js")) {
      const { default: context } = yield hostAwait(import(fullPath));

      score.update("import", {
        ...score.get("import"),
        ...(!score.get("#options").disableCache && {
          cache: {
            ...score.get("import").cache,
            [fullPath]: context,
          },
        }),
        paths: Array.from(
          new Set([score.get("import").main, ...score.get("import").paths]),
        ),
      });

      return yield lift(context);
    }

    try {
      const content = readFileSync(fullPath, "utf8").toString();

      const context = yield runInTask(content, {
        base: parsePath(fullPath).dir,
        main: fullPath,
        ...(!score.get("#options").disableCache && {
          cache: {
            ...score.get("import").cache,
            [fullPath]: score.get("#exports"),
          },
        }),
        paths: Array.from(
          new Set([score.get("import").main, ...score.get("import").paths]),
        ),
        options: score.get("#options"),
      });

      const expModule: Record<string, any> = {};
      const contextExports = context.interpreter.globalScore.get("#exports");

      for (const key in contextExports) {
        if (contextExports[key]?.[Environment.SymbolExports]) {
          defineMember(expModule, key, contextExports[key].value);
        } else {
          defineMember(expModule, key, contextExports[key]);
        }
      }

      score.update("import", {
        ...score.get("import"),
        ...(!score.get("#options").disableCache && {
          cache: {
            ...score.get("import").cache,
            [fullPath]: expModule,
          },
        }),
        paths: Array.from(
          new Set([score.get("import").main, ...score.get("import").paths]),
        ),
      });

      return yield lift(context.interpreter.globalScore.get("#exports"));
    } catch (err: any) {
      throw new ImportFaildError(ImportFaildCodeError.ImportFileRunFaild, {
        err: "message" in err ? err.message : String(err),
        cause: {
          fullPath,
        },
        files: score.get("import").paths,
      });
    }
  }

  *resolvePackageModule(source: string, score: Environment): Gen<any> {
    if (
      !this.destructuring &&
      score.get("import").cache[source] &&
      !score.get("#options").disableCache
    )
      return yield lift(score.get("import").cache[source]);

    const myLangJSON = JSON.parse(
      readFileSync(
        joinPath(score.get("import").base, "mylang.json"),
      ).toString(),
    );

    const dependenciesSource = myLangJSON.dependencies[source.split(":")[1]!];

    if (!dependenciesSource) {
      throw new ImportFaildError(ImportFaildCodeError.ImportSourceModuleFaild, {
        source,
        cause: {
          packageName: source,
        },
        files: score.get("import").paths,
      });
    }

    const moduleMyLangJSON = JSON.parse(
      (yield hostAwait(
        readFile(
          joinPath(
            score.get("import").base,
            ".module",
            source.replace(":", "/"),
            "mylang.json",
          ),
        ),
      )).toString(),
    );

    const runFileSource = joinPath(
      score.get("import").base,
      ".module",
      source.replace(":", "/"),
      moduleMyLangJSON.main,
    );

    if (!fileExists(runFileSource)) {
      throw new ImportFaildError(ImportFaildCodeError.ImportMainNotFound, {
        file: runFileSource,
        cause: {
          fullPath: runFileSource,
        },
        files: score.get("import").paths,
      });
    }

    const runLibSource = joinPath(score.get("import").base, ".module", source);
    const context = yield runInTask(readFileSync(runFileSource).toString(), {
      base: joinPath(
        score.get("import").base,
        ".module",
        source.replace(":", "/"),
      ),
      main: runLibSource,
      ...(!score.get("#options").disableCache && {
        cache: {
          ...score.get("import").cache,
          [source]: score.get("#exports"),
        },
      }),
      paths: Array.from(
        new Set([score.get("import").main, ...score.get("import").paths]),
      ),
      options: score.get("#options"),
    });

    const expModule: Record<string, any> = {};
    const contextExports = context.interpreter.globalScore.get("#exports");

    for (const key in contextExports) {
      if (contextExports[key]?.[Environment.SymbolExports]) {
        defineMember(expModule, key, contextExports[key].value);
      } else {
        defineMember(expModule, key, contextExports[key]);
      }
    }

    score.update("import", {
      ...score.get("import"),
      ...(!score.get("#options").disableCache && {
        cache: {
          ...score.get("import").cache,
          [source]: expModule,
        },
      }),
      paths: Array.from(new Set([source, ...score.get("import").paths])),
    });

    return yield lift(context.interpreter.globalScore.get("#exports"));
  }

  *handleModuleImport(module: any, name: string, score: Environment): Gen<any> {
    if (this.expression) return yield lift(unwrapExports(module));

    if (!score.get("#options").disableCache) {
      if (this.destructuring) {
        for (const key of this.destructuring) {
          if (!(key in module)) {
            throw new ImportFaildError(
              ImportFaildCodeError.ImportDestructuringFaild,
              {
                key,
                cause: {
                  key,
                },
                files: score.get("import").paths,
              },
            );
          }

          if (module[key]?.[Environment.SymbolExports]) {
            score.create(key, module[key].value, module[key].optionsVar);
          } else score.create(key, module[key]);
        }
      } else {
        const expModule: Record<string, any> = {};

        for (const key in module) {
          if (module[key]?.[Environment.SymbolExports]) {
            defineMember(expModule, key, module[key].value);
          } else defineMember(expModule, key, module[key]);
        }

        if (module?.[Environment.SymbolFormatedText]) {
          expModule[typeof Environment.SymbolFormatedText] =
            module[Environment.SymbolFormatedText];
        }

        if (
          !score.shadowInterpreterGlobal(name, expModule, { constant: true })
        ) {
          try {
            score.create(name, expModule, { constant: true });
          } catch (error: any) {
            if (String(error?.message ?? "").includes("has been initialized")) {
              const suggestion =
                name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1") +
                "Module";

              throw new BaseError(
                `"${name}" is already imported in this file. Two modules with the same ` +
                  `file name bind the same name; import one of them with an alias: ` +
                  `import "..." as ${suggestion}`,
                { files: error?.files ?? [] },
              );
            }

            throw error;
          }
        }

        return expModule;
      }
    }
  }

  *evaluateSinglePackage(packageName: string, score: Environment): Gen<any> {
    const { ext, dir, base, name } = parsePath(packageName);
    const fullPath = joinPath(dir, base);

    if (isCoreModule(packageName)) {
      return yield this.handleModuleImport(
        yield this.resolveBuildInModule(stripCoreNamespace(packageName), score),
        this.aliases || defaultBindingName(packageName),
        score,
      );
    }

    if (packageName.startsWith(CORE_NAMESPACE)) {
      throw new ImportFaildError(
        ImportFaildCodeError.ImportFindBildInModuleFaild,
        {
          name: stripCoreNamespace(packageName),
          cause: { packageName },
          files: score.get("import").paths,
        },
      );
    }

    if (
      packageName.startsWith("http://") ||
      packageName.startsWith("https://")
    ) {
      return yield this.handleModuleImport(
        yield this.resolveHTTPModule(packageName, score),
        this.aliases || name,
        score,
      );
    }

    if (ext === ".json") {
      return yield this.handleModuleImport(
        yield this.resolveJSONModule(fullPath, score),
        this.aliases || name,
        score,
      );
    }

    if (ext === "" && buildInModule.includes(packageName)) {
      return yield this.handleModuleImport(
        yield this.resolveBuildInModule(fullPath, score),
        this.aliases || defaultBindingName(packageName),
        score,
      );
    }

    if (ext === ".ml" || ext === ".js") {
      return yield this.handleModuleImport(
        yield this.resolveFileModule(fullPath, score),
        this.aliases || name,
        score,
      );
    }

    if (packageName.split(":")[1]) {
      return yield this.handleModuleImport(
        yield this.resolvePackageModule(packageName, score),
        this.aliases || packageName.split(":")[1]!,
        score,
      );
    }

    if (fileExists(fullPath)) {
      return yield this.handleModuleImport(
        new Bytes([readFileSync(fullPath).toString()], [], score).call(),
        this.aliases || name,
        score,
      );
    }

    throw new ImportFaildError(ImportFaildCodeError.ImportFindModuleFaild, {
      name: packageName,
      cause: {
        packageName: name,
      },
      files: score.get("import").paths,
    });
  }

  *evaluateMultiplePackages(score: Environment): Gen<any> {
    const packages: Record<string, any> = {};

    for (const [packageName, packageStmt] of Object.entries(this.package)) {
      const resolvePath =
        packageStmt instanceof StmtType
          ? yield packageStmt.evaluate(score)
          : packageStmt;
      const { ext, name } = parsePath(resolvePath);

      if (isCoreModule(packageName) || isCoreModule(resolvePath)) {
        const moduleName = stripCoreNamespace(
          isCoreModule(packageName) ? packageName : resolvePath,
        );
        const binding = isCoreModule(packageName)
          ? defaultBindingName(packageName)
          : packageName;

        score.create(
          binding,
          yield this.resolveBuildInModule(moduleName, score),
        );

        packages[binding] = score.get(binding);

        continue;
      }

      if (
        resolvePath.startsWith("http://") ||
        resolvePath.startsWith("https://")
      ) {
        packages[packageName] = yield this.resolveHTTPModule(
          resolvePath,
          score,
        );
      } else if (ext === ".json") {
        packages[packageName] = yield this.resolveJSONModule(
          resolvePath,
          score,
        );
      } else if (buildInModule.includes(packageName)) {
        if (packageName.includes("/")) {
          packages[packageName] = yield this.resolveBuildInModule(
            packageName,
            score,
          );
        } else {
          packages[packageName] = yield this.resolveBuildInModule(name, score);
        }
      } else if (buildInModule.includes(resolvePath)) {
        if (resolvePath.includes("/")) {
          packages[name] = yield this.resolveBuildInModule(resolvePath, score);
        } else {
          packages[packageName] = yield this.resolveBuildInModule(name, score);
        }
      } else if (packageName.includes(":")) {
        const [_, name] = packageName.split(":");
        packages[name!] = yield this.resolvePackageModule(packageName, score);
      } else if (ext === ".ml" || ext === ".js") {
        if (packageName !== name) {
          packages[packageName] = unwrapExports(
            yield this.resolveFileModule(resolvePath, score),
          );
        } else {
          packages[name] = unwrapExports(
            yield this.resolveFileModule(resolvePath, score),
          );
        }
      } else if (fileExists(resolvePath)) {
        packages[name] = new Bytes(
          [readFileSync(resolvePath).toString()],
          [],
          score,
        ).call();
      } else {
        throw new ImportFaildError(
          ImportFaildCodeError.ImportFindBildInModuleFaild,
          {
            name: packageName,
            cause: {
              packageName,
            },
            files: score.get("import").paths,
          },
        );
      }

      if (ext === ".ml" || ext === ".js") {
        if (parsePath(packageName).ext) {
          score.create(name, packages[packageName]);
        } else if (packageName !== name) {
          score.create(packageName, packages[packageName]);
        } else {
          score.create(name, packages[name]);
        }
      } else if (packageName.includes(":")) {
        const variableName = packageName.split(":").at(-1)!;
        score.create(variableName, packages[variableName]);
      } else if (packageName.includes("/")) {
        const variableName = packageName.split("/").at(-1)!;
        score.create(variableName, packages[packageName]);
      } else {
        if (packages[packageName]) {
          score.create(packageName, packages[packageName]);
        } else {
          score.create(packageName, packages[name]);
        }
      }
    }

    return this.expression ? packages : null;
  }

  *evaluate(score: Environment): Gen<any> {
    if (typeof this.package === "string") {
      return yield this.evaluateSinglePackage(this.package, score);
    } else {
      return yield this.evaluateMultiplePackages(score);
    }
  }
}

export { ImportDeclaration };
