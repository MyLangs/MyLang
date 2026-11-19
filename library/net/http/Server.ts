import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import crypto from "node:crypto";
import express, { Request, Response, NextFunction, Application } from "express";
import { isTypeArgs } from "../../utils/utils";
import { Environment } from "../../../src/Environment";
import { Bytes } from "../../bytes/Bytes";
import { HttpMethodBuilder } from "./HttpBuilder";
import { unwrapBuffer, toBytes } from "../../kernel/buffers";
import { type Gen, lift, hostAwait, park } from "../../../src/runtime/coroutine";
import { runtime } from "../../../src/runtime/Runtime";
import { paintText } from "../../../src/output/colors";

// Every server (and every rateLimit middleware) needs a clean-up when the process exits.
// A listener per server exceeds Node's limit of 10 "exit" listeners as soon as a program
// starts a few servers, so all of them share one single listener.
const exitCleanups = new Set<() => void>();
let exitHookInstalled = false;

function onProcessExit(cleanup: () => void): void {
  exitCleanups.add(cleanup);

  if (exitHookInstalled) {
    return;
  }

  exitHookInstalled = true;
  process.on("exit", () => {
    for (const fn of exitCleanups) {
      try {
        fn();
      } catch {
        // one failing clean-up must not stop the others
      }
    }
  });
}

type Handler = (ctx: RequestContext) => Promise<any> | any;
type Middleware =(ctx: RequestContext, next: () => Promise<void>) => Promise<void> | void;

interface RouteEntry {
  method: string;
  pattern: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
}

interface CacheOptions {
  enabled?: boolean;
  maxSize?: number;
  ttl?: number;
  clearOnRestart?: boolean;
  memoryLimit?: number;
}

interface ServerOptions {
  key?: Buffer | string;
  cert?: Buffer | string;
  port?: number;
  host?: string;
  cache?: CacheOptions;
  static?: {
    root?: string;
    index?: string;
    maxAge?: number;
    spa?: boolean;
    dotfiles?: "allow" | "deny" | "ignore";
    etag?: boolean;
    lastModified?: boolean;
    noCache?: boolean;
    cacheControl?: string;
  };
  cors?: {
    origin?: string | HttpMethodBuilder | ((origin?: string) => boolean);
    methods?: string[];
    credentials?: boolean;
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    maxAge?: number;
  };
  bodyLimit?: number;
  trustProxy?: boolean;
  compression?: {
    threshold?: number;
    level?: number;
    filter?: (req: http.IncomingMessage, res: http.ServerResponse) => boolean;
  };
  security?: {
    helmet?: boolean;
    xss?: boolean;
    noSniff?: boolean;
    frameOptions?: string;
    hsts?: boolean;
  };
  timeout?: number;
  keepAliveTimeout?: number;
  maxConnections?: number;
  /** Called with every error the server meets; nothing is printed when it is given. */
  onError?: any;
  /** `true` prints every error, `false` none; by default only the server's own failures. */
  logErrors?: boolean;
}

/** Where an error came from, as `onError` reports it. */
type ServerErrorKind = "client" | "request" | "server";

/**
 * One place for every error a running server meets.
 *
 * It used to print each of them with `console.error`, stack and all: a port scanner, a
 * client that hung up, a browser that did not trust the certificate, a body over the
 * limit - each wrote a block of host internals to the program's output, and the program
 * could neither silence it nor see it. Now:
 *
 *   - `onError: func(event) { ... }` receives every error as a value, on its own task, and
 *     nothing is printed: the program decides.
 *   - without it, only what is the *server's* problem is printed, as one line: a failure
 *     of the server itself, or a request that ended in a 5xx. A client that misbehaved, or
 *     a request answered with a 4xx, was handled correctly and is not worth a word.
 *   - `logErrors: true` prints every error, `logErrors: false` prints none.
 */
function serverErrorReporter(options: ServerOptions, builder: any) {
  const handler = options.onError;
  const logErrors = options.logErrors;

  return (kind: ServerErrorKind, err: any, extra: { status?: number; method?: string; path?: string } = {}) => {
    const event = {
      kind,
      message: String(err?.message ?? err),
      code: err?.code ?? err?.type ?? null,
      status: extra.status ?? null,
      method: extra.method ?? null,
      path: extra.path ?? null,
    };

    if (handler !== undefined && handler !== null) {
      runtime.scheduler.spawn(() => builder.executeCallback(handler, [event]), {
        name: "http-on-error",
        onError: (failure: any) =>
          process.stderr.write(
            paintText("33", `http: onError failed: ${failure?.message ?? failure}`) + "\n",
          ),
      });
      return;
    }

    if (logErrors === false) return;

    const routine = kind === "client" || (kind === "request" && (event.status ?? 500) < 500);

    if (routine && logErrors !== true) return;

    const where = event.method && event.path ? ` (${event.method} ${event.path})` : "";
    const code = event.code ? ` [${event.code}]` : "";

    process.stderr.write(paintText("33", `http ${kind} error: ${event.message}${code}${where}`) + "\n");
  };
}

interface RequestContext {
  res: Res;
  req: Req;
  method: string;
  url: string;
  path: string;
  query: Record<string, string | string[]>;
  params: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  body: any;
  rawBody?: ReturnType<Bytes["call"]>;
  ip?: string;
  state?: Record<string, any>;
  cookies?: Record<string, string>;
  protocol: string;
  secure: boolean;
  hostname?: string;
  fresh: boolean;
  stale: boolean;
  send: typeof HttpMethodBuilder;
  sendFile: typeof HttpMethodBuilder;
  json: typeof HttpMethodBuilder;
  status: typeof HttpMethodBuilder;
  cookie: typeof HttpMethodBuilder;
  clearCookie: typeof HttpMethodBuilder;
  redirect: typeof HttpMethodBuilder;
  __req: Request;
  __res: Response;
  [key: string]: any;
}

interface Req {
  url: string;
  method: string;
  httpVersion: string;
  httpVersionMajor: number;
  httpVersionMinor: number;
  headers: http.IncomingHttpHeaders;
  rawHeaders: string[];
  aborted: boolean;
}

interface Res {
  statusCode: number;
  statusMessage: string | null;
  setHeader: typeof HttpMethodBuilder;
  getHeader: typeof HttpMethodBuilder;
  removeHeader: typeof HttpMethodBuilder;
  hasHeader: typeof HttpMethodBuilder;
}

interface RateLimitEntry {
  count: number;
  expires: number;
  resetTime: number;
}

/**
 * Express wants a plain callback. Run the (generator) handler as its own task, so a slow
 * language handler never blocks the server or any other task.
 */
const asTask =
  (handler: (req: Request, res: Response, next: NextFunction) => Gen<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    runtime.scheduler.spawn(() => handler(req, res, next), {
      name: "http-request",
      onError: (error) => next(error),
    });
  };

class HttpServer extends HttpMethodBuilder {
  private static readonly DEFAULT_MIME_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".pdf": "application/pdf",
    ".wasm": "application/wasm",
    ".map": "application/json; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
  };

  private static readonly SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  };

  private static cache = new Map<string, { data: Buffer; timestamp: number; etag?: string }>();
  private static cacheStats = { hits: 0, misses: 0, size: 0 };

  override call() {
    const [options = {} as ServerOptions] = this.args;

    this.validateOptions(options);

    const reportError = serverErrorReporter(options, this);

    const validatePath = (pathStr: string): string => {
      if (!pathStr || typeof pathStr !== "string") {
        throw this.throwErrorFormatters(new Error("Path must be a non-empty string"));
      }
      const resolved = path.resolve(pathStr);
      return resolved;
    };

    /**
     * Check the directory static files are served from.
     *
     * Deliberately synchronous: this runs once, while the server is being built and before
     * it accepts anything, so there is no task to keep running and nothing to overlap it
     * with. Everything that happens per request is non-blocking.
     *
     * `asked` says whether the program named this directory itself. A directory it named
     * and does not have is a mistake worth stopping for; the default `public/` is a
     * convenience, so its absence means only that this server has no static files - which
     * is the ordinary case for an API and not worth a word.
     */
    const ensureStaticDirectory = (dir: string, asked: boolean): void => {
      let stat;

      try {
        stat = fs.statSync(dir);
      } catch (err: any) {
        if (err.code !== "ENOENT") throw err;

        if (asked) {
          throw this.throwErrorFormatters(
            new Error(`Static directory does not exist: ${dir}`),
          );
        }

        return;
      }

      if (!stat.isDirectory()) {
        throw this.throwErrorFormatters(
          new Error(`Static path is not a directory: ${dir}`),
        );
      }
    };

    const app: Application = express();
    let server: http.Server | https.Server | null = null;
    /** True once the port is bound, which is when an error stops meaning "cannot bind". */
    let bound = false;
    let shuttingDown = false;
    let connectionCount = 0;
    const activeConnections = new Set<any>();

    const staticOptions = {
      root: validatePath(
        options.static?.root || path.join(this.environment.get("import").base, "public"),
      ),
      index: options.static?.index || "index.html",
      maxAge: Math.max(0, options.static?.maxAge ?? 3600),
      spa: options.static?.spa ?? false,
      dotfiles: options.static?.dotfiles || ("ignore" as const),
      etag: options.static?.etag ?? true,
      lastModified: options.static?.lastModified ?? true,
    };

    ensureStaticDirectory(staticOptions.root, Boolean(options.static?.root));

    if (options.trustProxy) {
      app.set("trust proxy", true);
    }

    app.use((req: Request, res: Response, next: NextFunction) => {
      connectionCount++;
      activeConnections.add(req);

      const cleanup = () => {
        activeConnections.delete(req);
        connectionCount = Math.max(0, connectionCount - 1);
      };

      res.on("finish", cleanup);
      res.on("close", cleanup);
      req.on("error", cleanup);

      if (options.maxConnections && connectionCount > options.maxConnections) {
        return res.status(503).json({ error: "Service Unavailable - Too many connections" });
      }

      if (shuttingDown) {
        return res.status(503).json({ error: "Server shutting down" });
      }

      return next();
    });

    if (options.security) {
      app.use((_req: Request, res: Response, next: NextFunction) => {
        if (options.security?.helmet !== false) {
          Object.entries(HttpServer.SECURITY_HEADERS).forEach(([key, value]) => {
            res.setHeader(key, value);
          });
        }
        next();
      });
    }

    if (options.cors) {
      app.use((req: Request, res: Response, next: NextFunction) => {
        const origin = req.headers.origin;
        const corsOptions = options.cors!;

        let allowOrigin: string = "*";
        if (typeof corsOptions.origin === "function") {
          allowOrigin = corsOptions.origin(origin) ? origin || "*" : "null";
        } else if (typeof corsOptions.origin === "string") {
          allowOrigin = corsOptions.origin;
        }

        res.setHeader("Access-Control-Allow-Origin", allowOrigin);
        res.setHeader(
          "Access-Control-Allow-Methods",
          (corsOptions.methods || ["GET", "POST", "PUT", "DELETE", "OPTIONS"]).join(", "),
        );
        res.setHeader(
          "Access-Control-Allow-Headers",
          (corsOptions.allowedHeaders || ["Content-Type", "Authorization"]).join(", "),
        );

        if (corsOptions.credentials) {
          res.setHeader("Access-Control-Allow-Credentials", "true");
        }

        if (corsOptions.exposedHeaders?.length) {
          res.setHeader("Access-Control-Expose-Headers", corsOptions.exposedHeaders.join(", "));
        }

        if (corsOptions.maxAge) {
          res.setHeader("Access-Control-Max-Age", String(corsOptions.maxAge));
        }

        if (req.method === "OPTIONS") {
          return res.sendStatus(204);
        }

        return next();
      });
    }

    if (options.compression) {
      const zlib = require("zlib");
      app.use((req: Request, res: Response, next: NextFunction) => {
        const threshold = options.compression?.threshold || 1024;
        const level = options.compression?.level || 6;

        const originalSend = res.send;
        res.send = function (body: any): Response {
          if (!body || (typeof body !== "string" && !Buffer.isBuffer(body))) {
            return originalSend.call(this, body);
          }

          const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
          if (buffer.length < threshold) {
            return originalSend.call(this, body);
          }

          const acceptEncoding = req.headers["accept-encoding"] || "";

          // Compression runs on the host's thread pool: a large response no longer
          // stops every other task while it is packed. `send` has to return the
          // response object straight away, so the body is sent from the callback.
          const pack =
            acceptEncoding.includes("gzip")
              ? { encoding: "gzip", run: zlib.gzip }
              : acceptEncoding.includes("deflate")
                ? { encoding: "deflate", run: zlib.deflate }
                : null;

          if (!pack) return originalSend.call(this, body);

          res.setHeader("Content-Encoding", pack.encoding);

          pack.run(buffer, { level }, (error: any, packed: Buffer) => {
            if (error) {
              res.removeHeader("Content-Encoding");
              originalSend.call(res, body);
              return;
            }

            originalSend.call(res, packed);
          });

          return res;
        };
        next();
      });
    }

    const bodyLimit = options.bodyLimit || 2000000;
    app.use(express.json({ limit: bodyLimit }));
    app.use(express.urlencoded({ extended: true, limit: bodyLimit }));
    app.use(express.raw({ limit: bodyLimit }));
    app.use(express.text({ limit: bodyLimit }));

    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.cookies = {};
      const cookieHeader = req.headers.cookie;
      if (cookieHeader) {
        cookieHeader.split(";").forEach((cookie: string) => {
          const [name, ...rest] = cookie.trim().split("=");
          if (name && rest.length > 0) {
            try {
              req.cookies[decodeURIComponent(name)] = decodeURIComponent(rest.join("="));
            } catch (err) {
              req.cookies[name] = rest.join("=");
            }
          }
        });
      }
      next();
    });

    const routes: RouteEntry[] = [];
    const middlewares: Middleware[] = [];

    const compilePath = (pattern: string): { regex: RegExp; keys: string[] } => {
      validateRoute(pattern);

      const keys: string[] = [];

      const regexStr =
        "^" +
        pattern
          .replace(/([.+?^=!:${}()|[\]\/\\])/g, "\\$1")
          .replace(/\\:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
            if (keys.includes(key)) {
              throw this.throwErrorFormatters(new Error(`Duplicate route parameter: ${key}`));
            }
            keys.push(key);
            return "([^\\/]+)";
          })
          .replace(/\\\*/g, "(.*)") +
        "\\/?$";

      try {
        return { regex: pattern === "/" ? new RegExp("^\\/?$") : new RegExp(regexStr, "i"), keys };
      } catch (err) {
        throw this.throwErrorFormatters(new Error(`Invalid route pattern: ${pattern}`));
      }
    };

    const addRoute = (method: string, pattern: string, handler: Handler): void => {
      validateHandler(handler);

      const normalizedMethod = method.toUpperCase();
      const validMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ALL"];

      if (!validMethods.includes(normalizedMethod)) {
        throw this.throwErrorFormatters(new Error(`Invalid HTTP method: ${method}`));
      }

      const { regex, keys } = compilePath(pattern);

      const existingRoute = routes.find(
        (r) => r.method === normalizedMethod && r.pattern === pattern,
      );

      if (existingRoute) {
        console.warn(`Warning: Overriding existing route ${normalizedMethod} ${pattern}`);
        const index = routes.indexOf(existingRoute);
        routes.splice(index, 1);
      }

      routes.push({ method: normalizedMethod, pattern, regex, keys, handler });
    };

    const matchRoute = (
      method: string,
      pathname: string,
    ): { handler: Handler; params: Record<string, string> } | null => {
      for (let i = routes.length - 1; i >= 0; i--) {
        const route = routes[i]!;
        if (route.method !== method && route.method !== "ALL") continue;

        const match = route.regex.exec(pathname);
        if (match) {
          const params: Record<string, string> = {};
          route.keys.forEach((key, index) => {
            const value = match[index + 1];
            if (value !== undefined) {
              try {
                params[key] = decodeURIComponent(value);
              } catch (err) {
                params[key] = value;
              }
            }
          });
          return { handler: route.handler, params };
        }
      }
      return null;
    };

    const generateETag = (content: Buffer | string): string => {
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const hash = crypto.createHash("sha1").update(buffer).digest("hex");
      return `W/"${hash.substring(0, 16)}"`;
    };

    const createContext = (req: Request, res: Response): RequestContext => {
      const forwarded = req.headers["x-forwarded-for"] as string | undefined;
      const ip =
        options.trustProxy && forwarded
          ? forwarded.split(",")[0]?.trim()
          : req.socket.remoteAddress || "unknown";

      const protocol =
        options.trustProxy && req.headers["x-forwarded-proto"]
          ? (req.headers["x-forwarded-proto"] as string)
          : req.secure
            ? "https"
            : "http";

      const hostname = req.hostname;
      const cookies = req.cookies || {};

      const reqCtx: Req = {
        url: req.url || "/",
        method: req.method.toUpperCase(),
        httpVersion: req.httpVersion,
        httpVersionMajor: req.httpVersionMajor,
        httpVersionMinor: req.httpVersionMinor,
        headers: req.headers,
        rawHeaders: req.rawHeaders,
        aborted: (req as any).aborted || false,
      };

      const resCtx: Res = {
        statusCode: res.statusCode,
        statusMessage: res.statusMessage || null,

        setHeader: class extends HttpMethodBuilder {
          override call() {
            const [name, value] = this.args;
            res.setHeader(name, value);
            return resCtx;
          }
        },
        getHeader: class extends HttpMethodBuilder {
          override call() {
            const [name] = this.args;
            return res.getHeader(name);
          }
        },
        removeHeader: class extends HttpMethodBuilder {
          override call() {
            const [name] = this.args;
            res.removeHeader(name);
            return resCtx;
          }
        },
        hasHeader: class extends HttpMethodBuilder {
          override call() {
            const [name] = this.args;
            return res.hasHeader(name);
          }
        },
      };

      let currentStatus = 200;

      const normalizedParams: Record<string, string> = {};

      Object.entries(req.params).forEach(([key, value]) => {
        if (typeof value === "string") {
          normalizedParams[key] = value;
        } else if (Array.isArray(value)) {
          normalizedParams[key] = value[0] || "";
        }
      });

      const ctx: RequestContext = {
        req: reqCtx,
        res: resCtx,
        method: req.method.toUpperCase(),
        url: req.url || "/",
        path: req.path,
        query: req.query as Record<string, string | string[]>,
        params: normalizedParams,
        headers: req.headers,
        // `express.raw` gives a Buffer for a binary body. Handed over as it was, the
        // program saw a byte-indexed object - `{"0": 114, "1": 97, ...}` - which no
        // library accepts. As `bytes` it is the same value every other library produces.
        body: Buffer.isBuffer(req.body) ? toBytes(req.body, this.environment) : req.body,
        ...(ip && { ip }),
        state: {},
        cookies,
        protocol,
        secure: protocol === "https",
        ...(hostname && { hostname }),
        fresh: req.fresh,
        stale: req.stale,

        send: class extends HttpMethodBuilder {
          override call() {
            const [body, status = currentStatus, headers] = this.args;
            if (headers && typeof headers === "object") {
              Object.entries(headers).forEach(([key, value]) => {
                res.setHeader(key, value as string);
              });
            }
            res.status(status).send(body);
            return null;
          }
        },

        sendFile: class extends HttpMethodBuilder {
          override call() {
            let [filePathOrBuffer, options = {}, callback] = this.args;

            // the shared conversion, so a `bytes` value from any library works here
            const asBuffer = unwrapBuffer(filePathOrBuffer);

            if (asBuffer) filePathOrBuffer = asBuffer;

            if (Buffer.isBuffer(filePathOrBuffer)) {
              if (options && typeof options === "object" && options.headers) {
                Object.entries(options.headers).forEach(([key, value]) => {
                  res.setHeader(key, value as string);
                });
              }

              let contentType = options["Content-Type"];

              if (!contentType && options.filename) {
                const ext = path.extname(options.filename).toLowerCase();
                contentType = HttpServer.DEFAULT_MIME_TYPES[ext] || "application/octet-stream";
              }

              if (!contentType) {
                contentType = "application/octet-stream";
              }

              res.setHeader("Content-Type", contentType);

              if (options.download === true && options.filename) {
                res.setHeader("Content-Disposition", `attachment; filename="${options.filename}"`);
              } else if (options.download === false && options.filename) {
                res.setHeader("Content-Disposition", `inline; filename="${options.filename}"`);
              }

              res.setHeader("Content-Length", filePathOrBuffer.length);

              try {
                res.send(filePathOrBuffer);

                if (callback && isTypeArgs(callback) === "function") {
                  this.fireCallback(callback, [null]);
                }
              } catch (err: any) {
                if (!res.headersSent) {
                  res.status(500).json({
                    error: "Error sending file",
                    message: err.message,
                  });
                }

                if (callback && isTypeArgs(callback) === "function") {
                  this.fireCallback(callback, [err]);
                }
              }
            } else if (typeof filePathOrBuffer === "string") {
              res.sendFile(filePathOrBuffer, options, (err) => {
                if (err && !res.headersSent) {
                  res.status((err as unknown as { status: number }).status ?? 500).json({
                    error: "Error sending file",
                    message: err.message,
                  });
                }

                if (callback && isTypeArgs(callback) === "function") {
                  this.fireCallback(callback, [err]);
                }
              });
            } else {
              const error = new Error("sendFile requires a file path (string) or Buffer");
              if (callback && isTypeArgs(callback) === "function") {
                this.fireCallback(callback, [error]);
              } else {
                throw this.throwErrorFormatters(error);
              }
            }

            return null;
          }
        },

        json: class extends HttpMethodBuilder {
          override call() {
            const [body, status = currentStatus, headers = {}] = this.args;
            if (headers && typeof headers === "object") {
              Object.entries(headers).forEach(([key, value]) => {
                res.setHeader(key, value as string);
              });
            }
            res.status(status).json(body);
            return null;
          }
        },

        status: class extends HttpMethodBuilder {
          override call() {
            const [code] = this.args;
            if (typeof code === "number" && code >= 100 && code <= 599) {
              currentStatus = code;
            }
            return ctx;
          }
        },

        cookie: class extends HttpMethodBuilder {
          override call() {
            const [name, value, opts = {}] = this.args;
            if (typeof name !== "string" || value === undefined) return ctx;
            res.cookie(name, value, opts);
            return ctx;
          }
        },

        clearCookie: class extends HttpMethodBuilder {
          override call() {
            const [name, opts] = this.args;
            res.clearCookie(name, opts);
            return ctx;
          }
        },

        redirect: class extends HttpMethodBuilder {
          override call() {
            const [url, status = 302] = this.args;
            if (typeof url === "string") {
              res.redirect(status, url);
            }
            return ctx;
          }
        },

        __req: req,
        __res: res,
      };

      return ctx;
    };

    // `server.cors()` / `server.rateLimit()` add native middleware at run time.
    // It has to sit in front of the catch-all route handler below, which always
    // finishes the request, so it lives in its own router mounted first.
    const nativeMiddleware = express.Router();
    app.use(nativeMiddleware);

    app.use(
      asTask(
        function* (this: any, req: Request, res: Response, next: NextFunction): Gen<any> {
          try {
            const ctx = createContext(req, res);

            let middlewareIndex = 0;
            const executeNextMiddleware = function* (this: any): Gen<void> {
              if (middlewareIndex >= middlewares.length) {
                return;
              }

              const middleware = middlewares[middlewareIndex]!;
              middlewareIndex++;

              yield lift(
                this.executeCallback(middleware, [
                  ctx,
                  class extends HttpMethodBuilder {
                    override *call() {
                      yield executeNextMiddleware();
                      return null;
                    }
                  },
                ]),
              );
            }.bind(this);

            yield executeNextMiddleware();

            const match = matchRoute(ctx.method, ctx.path);

            if (!match) {
              return next();
            }

            ctx.params = match.params;

            const result = yield lift(this.executeCallback(match.handler, [ctx]));

            if (!res.headersSent && result !== undefined && result !== null) {
              let finalResult = result;

              const resultBuffer = unwrapBuffer(finalResult);

              if (resultBuffer) finalResult = resultBuffer;

              if (typeof finalResult === "object" && !Buffer.isBuffer(finalResult)) {
                if (finalResult && typeof finalResult.pipe === "function") {
                  finalResult.pipe(res);
                } else {
                  res.json(finalResult);
                }
              } else {
                res.send(finalResult);
              }
            }
          } catch (err) {
            next(err);
          }
        }.bind(this),
      ),
    );

    const cacheOptions = {
      enabled: options.cache?.enabled ?? true,
      maxSize: options.cache?.maxSize ?? 1000,
      ttl: options.cache?.ttl ?? 300000,
      clearOnRestart: options.cache?.clearOnRestart ?? true,
      memoryLimit: options.cache?.memoryLimit ?? 100 * 1024 * 1024,
      ...options.cache,
    };

    if (options.static) {
      app.use(
        asTask(function* (req: Request, res: Response, next: NextFunction): Gen<any> {
          if (req.method !== "GET" && req.method !== "HEAD") {
            return next();
          }

          const urlPath = decodeURIComponent(req.path);
          const sensitivePatterns = [
            /\.env/,
            /\.git/,
            /node_modules/,
            /package\.json/,
            /yarn\.lock/,
            /\.DS_Store/,
            /Thumbs\.db/,
          ];

          if (sensitivePatterns.some((pattern) => pattern.test(urlPath))) {
            return next();
          }

          // `dotfiles`: "ignore" (default) answers 404, "deny" answers 403,
          // "allow" serves them. `.` / `..` segments are handled below.
          const hasDotSegment = urlPath
            .split("/")
            .some((segment) => segment.startsWith(".") && segment !== "." && segment !== "..");

          if (hasDotSegment && staticOptions.dotfiles !== "allow") {
            if (staticOptions.dotfiles === "deny") {
              return res.status(403).send("Forbidden");
            }

            return next();
          }

          let targetPath = path.join(staticOptions.root, urlPath || staticOptions.index);

          // never leave the static root: `..` (also from %2e%2e) must not escape it
          const rootDir = path.resolve(staticOptions.root);
          const resolvedTarget = path.resolve(targetPath);

          if (resolvedTarget !== rootDir && !resolvedTarget.startsWith(rootDir + path.sep)) {
            return next();
          }

          try {
            const stat = yield hostAwait(fs.promises.stat(targetPath));

            if (stat.isDirectory()) {
              targetPath = path.join(targetPath, staticOptions.index);
              yield hostAwait(fs.promises.access(targetPath));
            }

            const cacheKey = `file:${targetPath}`;
            const cached = HttpServer.cache.get(cacheKey);

            if (cached && cacheOptions.enabled) {
              if (Date.now() - cached.timestamp < cacheOptions.ttl) {
                HttpServer.cacheStats.hits++;

                const ext = path.extname(targetPath).toLowerCase();
                const contentType =
                  HttpServer.DEFAULT_MIME_TYPES[ext] || "application/octet-stream";

                res.setHeader("Content-Type", contentType);
                res.setHeader("Content-Length", String(cached.data.length));

                if (cached.etag) {
                  res.setHeader("ETag", cached.etag);
                }

                if (options.static?.noCache) {
                  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
                } else if (options.static?.cacheControl) {
                  res.setHeader("Cache-Control", options.static.cacheControl);
                } else {
                  res.setHeader("Cache-Control", `public, max-age=${staticOptions.maxAge}`);
                }

                return res.send(cached.data);
              } else {
                HttpServer.cache.delete(cacheKey);
              }
            }

            HttpServer.cacheStats.misses++;

            const content = yield hostAwait(fs.promises.readFile(targetPath));
            const ext = path.extname(targetPath).toLowerCase();
            const contentType = HttpServer.DEFAULT_MIME_TYPES[ext] || "application/octet-stream";
            const fileStat = yield hostAwait(fs.promises.stat(targetPath));

            const lastModified = fileStat.mtime.toUTCString();
            const etag = staticOptions.etag ? generateETag(content) : undefined;

            if (cacheOptions.enabled && content.length < 1024 * 1024) {
              HttpServer.cache.set(cacheKey, {
                data: content,
                timestamp: Date.now(),
                ...(etag && { etag }),
              });
              HttpServer.cacheStats.size = HttpServer.cache.size;
            }

            res.setHeader("Content-Type", contentType);
            res.setHeader("Content-Length", String(content.length));

            if (etag) {
              res.setHeader("ETag", etag);
            }

            if (staticOptions.lastModified) {
              res.setHeader("Last-Modified", lastModified);
            }

            if (options.static?.noCache) {
              res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            } else if (options.static?.cacheControl) {
              res.setHeader("Cache-Control", options.static.cacheControl);
            } else {
              res.setHeader("Cache-Control", `public, max-age=${staticOptions.maxAge}`);
            }

            res.send(content);
          } catch (err) {
            if (staticOptions.spa && req.method === "GET") {
              const indexPath = path.join(staticOptions.root, staticOptions.index);
              try {
                yield hostAwait(fs.promises.access(indexPath));
                return res.sendFile(indexPath);
              } catch (spaErr) {
                next();
              }
            } else {
              next();
            }
          }
        }),
      );
    }

    if (cacheOptions.enabled) {
      const cacheCleanupInterval = setInterval(() => {
        this.pruneExpiredCache(cacheOptions.ttl);
        this.pruneCacheBySize(cacheOptions.maxSize);
        this.pruneCacheByMemory(cacheOptions.memoryLimit);
      }, 60000);

      // a background timer must never keep the program alive on its own
      cacheCleanupInterval.unref();

      onProcessExit(() => {
        clearInterval(cacheCleanupInterval);
        if (cacheOptions.clearOnRestart) {
          this.clearCache();
        }
      });
    }

    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      reportError("request", err, {
        status: err?.status || err?.statusCode || 500,
        method: req.method,
        path: req.path,
      });

      if (res.headersSent) {
        return next(err);
      }

      res.status(err.status || 500).json({
        error: err.message || "Internal Server Error",
        ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
      });
    });

    /** The signal handlers this server installed, so they can be taken off again. */
    let shutdownHandlers: Array<[string, (...args: any[]) => void]> = [];

    /** Stop intercepting signals: a server that is closed must not decide how we exit. */
    const teardownGracefulShutdown = () => {
      for (const [signal, handler] of shutdownHandlers) {
        process.removeListener(signal as any, handler);
      }

      shutdownHandlers = [];
    };

    const setupGracefulShutdown = () => {
      // listening again must not stack a second set of handlers on the first
      teardownGracefulShutdown();

      // `exitCode` is what the process ends with: 0 for a requested shutdown (signals),
      // 1 when the shutdown was caused by an error - a crash must never look like success
      const gracefulShutdown = (exitCode = 0) => {
        if (shuttingDown) return;

        shuttingDown = true;

        // No server left to close - it was released already. Without this the optional
        // call below did nothing, its callback never ran, and the signal was swallowed:
        // the process then ignored SIGTERM and SIGINT entirely and could only be killed.
        if (!server) {
          teardownGracefulShutdown();
          process.exit(exitCode);
        }

        server.close((err) => {
          if (err) {
            console.error("Error during server shutdown:", err);
            process.exit(1);
          }

          const shutdownTimeout = setTimeout(() => {
            for (const connection of activeConnections) {
              if (connection.destroy) {
                connection.destroy();
              }
            }
            process.exit(exitCode);
          }, 10000);

          const checkConnections = () => {
            if (activeConnections.size === 0) {
              clearTimeout(shutdownTimeout);
              process.exit(exitCode);
            } else {
              setTimeout(checkConnections, 100);
            }
          };

          checkConnections();
        });
      };

      const onTerm = () => gracefulShutdown(0);
      const onInt = () => gracefulShutdown(0);
      const onUncaught = (err: any) => {
        console.error("Uncaught exception:", err);
        gracefulShutdown(1);
      };
      const onRejection = (reason: any, promise: any) => {
        console.error("Unhandled rejection at:", promise, "reason:", reason);
        gracefulShutdown(1);
      };

      shutdownHandlers = [
        ["SIGTERM", onTerm],
        ["SIGINT", onInt],
        ["uncaughtException", onUncaught],
        ["unhandledRejection", onRejection],
      ];

      for (const [signal, handler] of shutdownHandlers) {
        process.on(signal as any, handler);
      }
    };

    const validateRoute = (pattern: string): void => {
      if (!pattern || typeof pattern !== "string") {
        throw this.throwErrorFormatters(new Error("Route pattern must be a non-empty string"));
      }
      if (!pattern.startsWith("/")) {
        throw this.throwErrorFormatters(new Error('Route pattern must start with "/"'));
      }
    };

    const validateHandler = (handler: any): void => {
      if (!handler || (typeof handler !== "function" && isTypeArgs(handler) !== "function")) {
        throw this.throwErrorFormatters(
          new Error("Route handler must be a function or HttpMethodBuilder"),
        );
      }
    };

    const clearCache = (pattern?: string | RegExp): number => {
      let cleared = 0;

      if (!pattern) {
        cleared = HttpServer.cache.size;
        HttpServer.cache.clear();
        HttpServer.cacheStats.size = 0;
      } else if (typeof pattern === "string") {
        const keys = Array.from(HttpServer.cache.keys());
        for (const key of keys) {
          if (key.includes(pattern)) {
            HttpServer.cache.delete(key);
            cleared++;
          }
        }
        HttpServer.cacheStats.size = HttpServer.cache.size;
      } else if (pattern instanceof RegExp) {
        const keys = Array.from(HttpServer.cache.keys());
        for (const key of keys) {
          if (pattern.test(key)) {
            HttpServer.cache.delete(key);
            cleared++;
          }
        }
        HttpServer.cacheStats.size = HttpServer.cache.size;
      }

      return cleared;
    };

    return {
      get: class extends HttpMethodBuilder {
        override call() {
          const [pattern, handler] = this.args;
          validateRoute(pattern);
          validateHandler(handler);
          addRoute("GET", pattern, handler);
          return null;
        }
      },

      post: class extends HttpMethodBuilder {
        override call() {
          const [pattern, handler] = this.args;
          validateRoute(pattern);
          validateHandler(handler);
          addRoute("POST", pattern, handler);
          return null;
        }
      },

      put: class extends HttpMethodBuilder {
        override call() {
          const [pattern, handler] = this.args;
          validateRoute(pattern);
          validateHandler(handler);
          addRoute("PUT", pattern, handler);
          return null;
        }
      },

      patch: class extends HttpMethodBuilder {
        override call() {
          const [pattern, handler] = this.args;
          validateRoute(pattern);
          validateHandler(handler);
          addRoute("PATCH", pattern, handler);
          return null;
        }
      },

      delete: class extends HttpMethodBuilder {
        override call() {
          const [pattern, handler] = this.args;
          validateRoute(pattern);
          validateHandler(handler);
          addRoute("DELETE", pattern, handler);
          return null;
        }
      },

      head: class extends HttpMethodBuilder {
        override call() {
          const [pattern, handler] = this.args;
          validateRoute(pattern);
          validateHandler(handler);
          addRoute("HEAD", pattern, handler);
          return null;
        }
      },

      options: class extends HttpMethodBuilder {
        override call() {
          const [pattern, handler] = this.args;
          validateRoute(pattern);
          validateHandler(handler);
          addRoute("OPTIONS", pattern, handler);
          return null;
        }
      },

      all: class extends HttpMethodBuilder {
        override call() {
          const [pattern, handler] = this.args;
          validateRoute(pattern);
          validateHandler(handler);
          addRoute("ALL", pattern, handler);
          return null;
        }
      },

      use: class extends HttpMethodBuilder {
        override call() {
          const [middleware] = this.args;
          if (typeof middleware !== "function" && isTypeArgs(middleware) !== "function") {
            throw this.throwErrorFormatters(new Error("Middleware must be a function"));
          }

          middlewares.push(middleware);
          return null;
        }
      },

      cors: class extends HttpMethodBuilder {
        override call() {
          const [corsOptions = {}] = this.args;
          nativeMiddleware.use((req: Request, res: Response, next: NextFunction) => {
            const origin = req.headers.origin;

            let allowOrigin: string = "*";
            if (typeof corsOptions.origin === "function") {
              allowOrigin = corsOptions.origin(origin) ? origin || "*" : "null";
            } else if (typeof corsOptions.origin === "string") {
              allowOrigin = corsOptions.origin;
            }

            res.setHeader("Access-Control-Allow-Origin", allowOrigin);
            res.setHeader(
              "Access-Control-Allow-Methods",
              (corsOptions.methods || ["GET", "POST", "PUT", "DELETE", "OPTIONS"]).join(", "),
            );
            res.setHeader(
              "Access-Control-Allow-Headers",
              (corsOptions.allowedHeaders || ["Content-Type", "Authorization"]).join(", "),
            );

            if (corsOptions.credentials) {
              res.setHeader("Access-Control-Allow-Credentials", "true");
            }

            if (corsOptions.exposedHeaders?.length) {
              res.setHeader("Access-Control-Expose-Headers", corsOptions.exposedHeaders.join(", "));
            }

            if (corsOptions.maxAge) {
              res.setHeader("Access-Control-Max-Age", String(corsOptions.maxAge));
            }

            if (req.method === "OPTIONS") {
              return res.sendStatus(204);
            }

            return next();
          });
        }
      },

      rateLimit: class extends HttpMethodBuilder {
        override call() {
          const [rateLimitOptions = {}] = this.args;
          const windowMs = rateLimitOptions.windowMs ?? 60000;
          const max = rateLimitOptions.max ?? 60;
          const store = new Map<string, RateLimitEntry>();

          const cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of store.entries()) {
              if (entry.expires < now) {
                store.delete(key);
              }
            }
          }, windowMs);

          // the cleanup timer must not keep the program alive once everything else is done
          cleanupInterval.unref();
          onProcessExit(() => clearInterval(cleanupInterval));

          nativeMiddleware.use((req: Request, res: Response, next: NextFunction) => {
            const key = rateLimitOptions.keyGenerator
              ? rateLimitOptions.keyGenerator(createContext(req, res))
              : req.ip || "unknown";

            const now = Date.now();
            const record = store.get(key);

            if (!record || record.expires < now) {
              store.set(key, {
                count: 1,
                expires: now + windowMs,
                resetTime: now + windowMs,
              });
            } else {
              record.count++;
              if (record.count > max) {
                res.setHeader("X-RateLimit-Limit", String(max));
                res.setHeader("X-RateLimit-Remaining", "0");
                res.setHeader("X-RateLimit-Reset", String(Math.ceil(record.resetTime / 1000)));

                return res.status(429).json({
                  error: "Too Many Requests",
                  retryAfter: Math.ceil((record.resetTime - now) / 1000),
                });
              }
            }

            const currentRecord = store.get(key)!;
            res.setHeader("X-RateLimit-Limit", String(max));
            res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - currentRecord.count)));
            res.setHeader("X-RateLimit-Reset", String(Math.ceil(currentRecord.resetTime / 1000)));

            return next();
          });

          return null;
        }
      },

      clearCache: class extends HttpMethodBuilder {
        override call() {
          const [pattern] = this.args;
          return clearCache(pattern);
        }
      },

      cacheStats: class extends HttpMethodBuilder {
        override call() {
          return HttpServer.cacheStats;
        }
      },

      static: class extends HttpMethodBuilder {
        override call() {
          const [root, config] = this.args;

          if (root) {
            staticOptions.root = validatePath(root);

            // the program named this one, so a missing directory is its mistake
            ensureStaticDirectory(staticOptions.root ?? root, true);
          }

          if (config && typeof config === "object") {
            if (config.index) staticOptions.index = config.index;
            if (typeof config.maxAge === "number")
              staticOptions.maxAge = Math.max(0, config.maxAge);
            if (typeof config.spa === "boolean") staticOptions.spa = config.spa;
            if (config.dotfiles && ["allow", "deny", "ignore"].includes(config.dotfiles)) {
              staticOptions.dotfiles = config.dotfiles;
            }
            if (typeof config.etag === "boolean") staticOptions.etag = config.etag;
            if (typeof config.lastModified === "boolean")
              staticOptions.lastModified = config.lastModified;
          }

          return null;
        }
      },

      /**
       * `server.listen(port, host, callback)` - bind the port and start accepting.
       *
       * This parks until the port is actually bound, and reports a failure as an error the
       * program can catch. It used to return at once and print a failed bind to the
       * console: the program then carried on believing it had a server, and the only sign
       * was an exit code at the very end. It also returns where it ended up listening,
       * which is the only way to learn the port when binding to port 0.
       */
      listen: class extends HttpMethodBuilder {
        override *call(): Gen<any> {
          let [port = options.port || 3000, host = options.host || "0.0.0.0", callback] = this.args;

          if (isTypeArgs(callback) !== "function" && isTypeArgs(host) === "function") {
            callback = host;
            host = "0.0.0.0";
          }

          if (server) {
            throw this.throwErrorFormatters(new Error("Server is already listening"));
          }

          // binding a port is a network operation like any other
          this.checkPermission("net", `${host}:${port}`);

          try {
            if (options.key && options.cert) {
              server = https.createServer(
                {
                  key: options.key,
                  cert: options.cert,
                },
                app,
              );
            } else {
              server = http.createServer(app);
            }

            if (options.keepAliveTimeout) {
              server.keepAliveTimeout = options.keepAliveTimeout;
            }

            if (options.timeout) {
              server.timeout = options.timeout;
            }

            // An error once the server is running - a client that misbehaves, a socket
            // that dies - must not end the process; a failure to bind is reported to the
            // caller instead, by the park below.
            server.on("error", (err: any) => {
              if (!bound) return;

              reportError("server", err);
            });

            server.on("clientError", (err, socket) => {
              reportError("client", err);
              if (!socket.destroyed) {
                socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
              }
            });

            yield park<void>((wake, fail) => {
              const onError = (err: any) => {
                server?.removeListener("listening", onListening);

                const reason =
                  err?.code === "EADDRINUSE"
                    ? `port ${port} is already in use`
                    : err?.code === "EACCES"
                      ? `permission denied to bind to port ${port}`
                      : (err?.message ?? String(err));

                try {
                  server?.close();
                } catch {
                  // it never opened
                }

                server = null;

                fail(new Error(reason));
              };

              const onListening = () => {
                server?.removeListener("error", onError);
                bound = true;
                wake();
              };

              server?.once("error", onError);
              server?.once("listening", onListening);
              server?.listen(port, host);
            });
          } catch (err: any) {
            throw this.throwErrorFormatters(
              new Error(`cannot listen on ${host}:${port}: ${err?.message ?? err}`),
            );
          }

          const address = server?.address();
          const actualPort =
            typeof address === "object" && address ? address.port : port;
          const protocol = options.key && options.cert ? "https" : "http";
          const where = { port: actualPort, host, protocol };

          setupGracefulShutdown();

          if (isTypeArgs(callback) === "function") {
            this.fireCallback(callback, [where]);
          }

          return where;
        }
      },

      close: class extends HttpMethodBuilder {
        override call() {
          const [callback] = this.args;

          if (!server) {
            if (isTypeArgs(callback) === "function") {
              this.fireCallback(callback, [false]);
            }
            return false;
          }

          shuttingDown = true;

          server.close((err) => {
            const success = !err;
            server = null;
            shuttingDown = false;

            if (err) {
              console.error("Error closing server:", err);
            }

            if (isTypeArgs(callback) === "function") {
              this.fireCallback(callback, [success, err]);
            }
          });

          return true;
        }
      },

      info: class extends HttpMethodBuilder {
        override call() {
          const address = server?.address();
          return {
            listening: !!server && server.listening,
            address: address,
            connections: connectionCount,
            shuttingDown,
            static: staticOptions,
            cache: HttpServer.cacheStats,
          };
        }
      },

      // An open server owns a port: `defer` and `symbol.dispose` release it, and
      // closing twice is not an error (see library/kernel/resource).
      //
      // This parks until the port is actually free. Returning while the host was still
      // closing meant a program that closed a server and bound the same port again could
      // be refused for a port it had already given up.
      [Environment.SymbolDeferred]: class extends HttpMethodBuilder {
        override *call(): Gen<any> {
          if (!server) return null;

          shuttingDown = true;

          const closing = server;

          server = null;
          bound = false;

          // the port is going back; this server no longer gets to decide how we exit
          teardownGracefulShutdown();

          yield park<void>((wake) => {
            closing.close(() => {
              shuttingDown = false;
              wake();
            });
          });

          return null;
        }
      },

      [Environment.SymbolFormatedText]: `Server ${JSON.stringify(
        {
          listening: !!server && (server as any).listening,
          address: (server as any)?.address() || null,
          connections: connectionCount,
          shuttingDown,
          static: staticOptions,
        },
        null,
        2,
      )}`,
    };
  }

  private validateOptions(options: ServerOptions): void {
    if (
      options.port &&
      (typeof options.port !== "number" || options.port < 1 || options.port > 65535)
    ) {
      throw this.throwErrorFormatters(new Error("Port must be a number between 1 and 65535"));
    }

    if (
      options.onError !== undefined &&
      options.onError !== null &&
      isTypeArgs(options.onError) !== "function"
    ) {
      throw this.throwErrorFormatters(new Error("onError must be a function"));
    }

    if (options.logErrors !== undefined && typeof options.logErrors !== "boolean") {
      throw this.throwErrorFormatters(new Error("logErrors must be true or false"));
    }

    if (options.bodyLimit && (typeof options.bodyLimit !== "number" || options.bodyLimit < 0)) {
      throw this.throwErrorFormatters(new Error("bodyLimit must be a positive number"));
    }

    if (options.timeout && (typeof options.timeout !== "number" || options.timeout < 0)) {
      throw this.throwErrorFormatters(new Error("timeout must be a positive number"));
    }

    if (
      options.maxConnections &&
      (typeof options.maxConnections !== "number" || options.maxConnections < 1)
    ) {
      throw this.throwErrorFormatters(new Error("maxConnections must be a positive number"));
    }
  }

  private pruneExpiredCache(ttl: number): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of HttpServer.cache.entries()) {
      if (now - entry.timestamp > ttl) {
        HttpServer.cache.delete(key);
        removed++;
      }
    }

    HttpServer.cacheStats.size = HttpServer.cache.size;
    return removed;
  }

  private pruneCacheBySize(maxSize: number): number {
    if (HttpServer.cache.size <= maxSize) return 0;

    const entries = Array.from(HttpServer.cache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    );

    const toRemove = HttpServer.cache.size - maxSize;
    let removed = 0;

    for (let i = 0; i < toRemove && i < entries.length; i++) {
      HttpServer.cache.delete(entries[i]![0]);
      removed++;
    }

    HttpServer.cacheStats.size = HttpServer.cache.size;
    return removed;
  }

  private getCacheMemoryUsage(): number {
    let totalSize = 0;
    for (const [key, entry] of HttpServer.cache.entries()) {
      totalSize += Buffer.byteLength(key, "utf8") + entry.data.length;
    }
    return totalSize;
  }

  private pruneCacheByMemory(memoryLimit: number): number {
    const currentMemory = this.getCacheMemoryUsage();
    if (currentMemory <= memoryLimit) return 0;

    const entries = Array.from(HttpServer.cache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    );

    let removedMemory = 0;
    let removed = 0;

    for (const [key, entry] of entries) {
      if (currentMemory - removedMemory <= memoryLimit) break;

      removedMemory += Buffer.byteLength(key, "utf8") + entry.data.length;
      HttpServer.cache.delete(key);
      removed++;
    }

    HttpServer.cacheStats.size = HttpServer.cache.size;
    return removed;
  }

  private clearCache(): void {
    HttpServer.cache.clear();
    HttpServer.cacheStats = { hits: 0, misses: 0, size: 0 };
  }
}

export { HttpServer };
