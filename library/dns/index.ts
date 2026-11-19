/**
 * `dns` - name resolution.
 *
 *     var address = dns.lookup("example.com");
 *     var records = dns.resolve("example.com", "MX");
 *
 * Every lookup parks the calling task on the host resolver, so a slow or unreachable DNS
 * server delays only the task that asked, never the whole program.
 *
 * Permissions: resolving a name is a network operation, so it needs `--allow-net`. A grant
 * naming hosts (`--allow-net=api.example.com`) allows resolving exactly those names; a
 * bare `--allow-net` allows any.
 */

import dns from "node:dns";
import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { type Gen } from "../../src/runtime/coroutine";
import { fromCallback } from "../kernel/async";

const PKG = { name: "dns", path: __dirname };

/** Record types the host resolver understands. */
const RECORD_TYPES = [
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "NS",
  "PTR",
  "SOA",
  "SRV",
  "TXT",
  "CAA",
  "NAPTR",
  "ANY",
] as const;

abstract class DNSMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return PKG;
  }

  /** A hostname argument, checked for type and for `--allow-net`. */
  protected hostname(value: any, argName = "hostname"): string {
    this.assertString(value, argName);

    if (value.length === 0) {
      throw this.throwErrorFormatters(new Error(`${argName} cannot be empty`));
    }

    this.checkPermission("net", value);

    return value;
  }

  /** Node's DNS errors carry a code that is far more useful than their message. */
  protected fail(error: any, hostname: string): never {
    const code = error?.code ? ` (${error.code})` : "";

    throw this.throwErrorFormatters(
      new Error(`dns lookup for "${hostname}" failed${code}: ${error?.message ?? error}`),
    );
  }

  call(): any {
    throw new Error("Call is not implemented");
  }
}

/**
 * `dns.lookup(hostname, family)` - the address the operating system would use.
 *
 * This is what a connection does, so it honours `/etc/hosts` and the system resolver,
 * unlike `dns.resolve`, which always queries a DNS server.
 */
class Lookup extends DNSMethodBuilder {
  override *call(): Gen<any> {
    const [host, family] = this.args;

    const hostname = this.hostname(host);
    const options: dns.LookupOptions = {};

    if (family !== undefined && family !== null) {
      this.assertInteger(family, "family");

      if (family !== 4 && family !== 6) {
        throw this.throwErrorFormatters(
          new Error(`family must be 4 or 6, received ${family}`),
        );
      }

      options.family = family;
    }

    try {
      const result = yield fromCallback<{ address: string; family: number }>(
        (done) => {
          dns.lookup(hostname, options, (error, address, resolvedFamily) => {
            if (error) done(error);
            else
              done(null, {
                address: String(address),
                family: Number(resolvedFamily),
              });
          });
        },
      );

      return {
        address: result.address,
        family: result.family,
        [Environment.SymbolFormatedText]: `Address { ${result.address} (IPv${result.family}) }`,
      };
    } catch (error: any) {
      this.fail(error, hostname);
    }
  }
}

/** `dns.lookupAll(hostname)` - every address the system resolver knows for a name. */
class LookupAll extends DNSMethodBuilder {
  override *call(): Gen<any> {
    const [host] = this.args;

    const hostname = this.hostname(host);

    try {
      const results = yield fromCallback<dns.LookupAddress[]>((done) => {
        dns.lookup(hostname, { all: true }, done as any);
      });

      return results.map((entry: dns.LookupAddress) => ({
        address: entry.address,
        family: entry.family,
      }));
    } catch (error: any) {
      this.fail(error, hostname);
    }
  }
}

/** `dns.resolve(hostname, type)` - query a DNS server directly. */
class Resolve extends DNSMethodBuilder {
  override *call(): Gen<any> {
    const [host, type = "A"] = this.args;

    const hostname = this.hostname(host);

    this.assertString(type, "type");

    const recordType = type.toUpperCase();

    if (!(RECORD_TYPES as readonly string[]).includes(recordType)) {
      throw this.throwErrorFormatters(
        new Error(
          `unknown record type "${type}". Supported: ${RECORD_TYPES.join(", ")}`,
        ),
      );
    }

    try {
      return yield fromCallback<any>((done) => {
        dns.resolve(hostname, recordType as any, done as any);
      });
    } catch (error: any) {
      this.fail(error, hostname);
    }
  }
}

/** `dns.reverse(address)` - the names that point at an address. */
class Reverse extends DNSMethodBuilder {
  override *call(): Gen<any> {
    const [address] = this.args;

    this.assertString(address, "address");
    this.checkPermission("net", address);

    try {
      return yield fromCallback<string[]>((done) => {
        dns.reverse(address, done as any);
      });
    } catch (error: any) {
      this.fail(error, address);
    }
  }
}

/** `dns.servers()` - the resolvers currently in use. Needs `--allow-sys`. */
class Servers extends DNSMethodBuilder {
  override call() {
    this.checkPermission("sys", "dns-servers");

    return dns.getServers();
  }
}

/** `dns.setServers([...])` - replace the resolver list. Needs `--allow-sys`. */
class SetServers extends DNSMethodBuilder {
  override call() {
    const [servers] = this.args;

    this.assertArray(servers, "servers");
    this.checkPermission("sys", "dns-servers");

    for (const server of servers) {
      this.assertString(server, "server");
    }

    try {
      dns.setServers(servers);
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }

    return null;
  }
}

/** `dns.isIP(text)` - 4, 6, or 0 when it is not an address at all. */
class IsIP extends DNSMethodBuilder {
  override call() {
    const [value] = this.args;

    this.assertString(value, "value");

    // net.isIP without importing `net`: the same two shapes, checked directly
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
      const parts = value.split(".").map(Number);

      return parts.every((part: number) => part >= 0 && part <= 255) ? 4 : 0;
    }

    if (value.includes(":")) {
      return /^[0-9a-fA-F:.]+$/.test(value) ? 6 : 0;
    }

    return 0;
  }
}

module.exports = {
  lookup: Lookup,
  lookupAll: LookupAll,
  resolve: Resolve,
  reverse: Reverse,
  servers: Servers,
  setServers: SetServers,
  isIP: IsIP,
  types: [...RECORD_TYPES],
};
