/**
 * `archive` - reading and writing tar and zip archives.
 *
 *     var files = archive.read(fs.readFile("bundle.zip"));   // entries, as bytes
 *     var data  = archive.zip([{ name: "a.txt", data: "hello" }]);
 *     archive.extract(data, "./out");                        // writes to disk
 *
 * The archive itself is a `bytes` value, so it can come from `fs`, from an HTTP response,
 * or from a socket without being written to disk first. Compression is not reimplemented
 * here: deflate comes from `compress` and gzip wrapping from `compress.gzip`, exactly as a
 * program would call them. Writing to disk goes through the same permission checks as
 * `fs`, because it is the same operation.
 */

import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import zlib from "node:zlib";
import { FunctionBuilder } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { type Gen } from "../../src/runtime/coroutine";
import { fromCallback, fromEvent } from "../kernel/async";
import { hostAwait, park } from "../../src/runtime/coroutine";
import { toBuffer } from "../kernel/buffers";

const PKG = { name: "archive", path: __dirname };

/** One file inside an archive, as the host handles it. */
interface Entry {
  name: string;
  data: Buffer;
  mode: number;
  mtime: Date;
  directory: boolean;
}

abstract class ArchiveMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    super(args, astArgs, environment);
  }

  get pkgInfo() {
    return PKG;
  }

  /** The entry list a program passes to `tar` / `zip`. */
  protected toEntries(input: any, argName = "entries"): Entry[] {
    this.assertArray(input, argName);

    return input.map((raw: any, index: number) => {
      this.assertObject(raw, `${argName}[${index}]`);

      const name = raw["name"];

      this.assertString(name, `${argName}[${index}].name`);

      const normalized = normalizeName(name);

      if (normalized === null) {
        throw this.throwErrorFormatters(
          new Error(
            `${argName}[${index}].name escapes the archive root: "${name}"`,
          ),
        );
      }

      const directory = raw["directory"] === true;
      const data = directory ? Buffer.alloc(0) : toBuffer(raw["data"] ?? "");

      return {
        name: normalized,
        data,
        mode: typeof raw["mode"] === "number" ? raw["mode"] : directory ? 0o755 : 0o644,
        mtime: raw["mtime"] instanceof Date ? raw["mtime"] : new Date(),
        directory,
      };
    });
  }

  /** An entry as the language sees it. */
  protected toValue(entry: Entry) {
    return {
      name: entry.name,
      size: entry.data.length,
      directory: entry.directory,
      mode: entry.mode,
      mtime: entry.mtime,
      data: this.toBytes(entry.data),
      [Environment.SymbolFormatedText]: `Entry { name: "${entry.name}", size: ${entry.data.length}${entry.directory ? ", directory" : ""} }`,
    };
  }

  call(): any {
    throw new Error("Call is not implemented");
  }
}

/**
 * Reject names that would write outside the destination when extracted: absolute paths,
 * `..` segments and Windows drive letters. Returns the cleaned name, or `null`.
 */
function normalizeName(name: string): string | null {
  const text = String(name).replace(/\\/g, "/").replace(/^\.\//, "");

  if (text.startsWith("/") || /^[a-zA-Z]:/.test(text)) return null;

  const parts: string[] = [];

  for (const part of text.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;

    parts.push(part);
  }

  if (parts.length === 0) return null;

  return parts.join("/") + (text.endsWith("/") ? "/" : "");
}

// ------------------------------------------------------------------- tar

const TAR_BLOCK = 512;

function tarChecksum(header: Buffer): number {
  let sum = 0;

  for (let i = 0; i < TAR_BLOCK; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  }

  return sum;
}

/** One ustar header block. `typeFlag` overrides the entry's own kind (for PAX records). */
function tarHeader(entry: Entry, typeFlag?: string, nameOverride?: string): Buffer {
  const header = Buffer.alloc(TAR_BLOCK);
  const name =
    nameOverride ??
    (entry.directory ? entry.name.replace(/\/?$/, "/") : entry.name);

  const octal = (value: number, size: number) =>
    value.toString(8).padStart(size - 1, "0") + "\0";

  header.write(name, 0, 100, "utf8");
  header.write(octal(entry.mode & 0o7777, 8), 100, 8, "utf8");
  header.write(octal(0, 8), 108, 8, "utf8");
  header.write(octal(0, 8), 116, 8, "utf8");
  header.write(octal(entry.data.length, 12), 124, 12, "utf8");
  header.write(octal(Math.floor(entry.mtime.getTime() / 1000), 12), 136, 12, "utf8");
  header.write("        ", 148, 8, "utf8");
  header.write(typeFlag ?? (entry.directory ? "5" : "0"), 156, 1, "utf8");
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");

  header.write(
    tarChecksum(header).toString(8).padStart(6, "0") + "\0 ",
    148,
    8,
    "utf8",
  );

  return header;
}

/**
 * A PAX extended header: how tar carries a name that does not fit in the 100 bytes a
 * ustar header has for it. The real name travels as a `path=` record in the body of an
 * `x` entry, and the entry that follows carries a truncated name for readers that do not
 * understand PAX.
 */
function paxRecord(entry: Entry, name: string): Buffer[] {
  // "<length> path=<name>\n", where <length> counts itself
  const suffix = ` path=${name}\n`;
  let length = Buffer.byteLength(suffix) + 1;

  // adding a digit to the length can change the length
  while (Buffer.byteLength(String(length)) + Buffer.byteLength(suffix) !== length) {
    length = Buffer.byteLength(String(length)) + Buffer.byteLength(suffix);
  }

  const body = Buffer.from(String(length) + suffix, "utf8");
  const padded = Buffer.alloc(Math.ceil(body.length / TAR_BLOCK) * TAR_BLOCK);

  body.copy(padded);

  const header = tarHeader(
    { ...entry, data: body, directory: false },
    "x",
    "PaxHeaders/" + basenameOf(name).slice(0, 80),
  );

  return [header, padded];
}

/**
 * A name short enough for a ustar header, for readers that ignore the PAX record.
 * Cut from the front, because the end of a path identifies it better than its start.
 */
function truncateName(name: string): string {
  const bytes = Buffer.from(name, "utf8");

  if (bytes.length <= 100) return name;

  // cut on a character boundary
  return bytes.subarray(bytes.length - 99).toString("utf8").replace(/^[^/]*\//, "") || "long-name";
}

/** The last segment of a path, without importing `path` into the format code. */
function basenameOf(name: string): string {
  const parts = name.replace(/\/$/, "").split("/");

  return parts[parts.length - 1] ?? name;
}

function buildTar(entries: Entry[]): Buffer {
  const chunks: Buffer[] = [];

  for (const entry of entries) {
    const fullName = entry.directory
      ? entry.name.replace(/\/?$/, "/")
      : entry.name;

    // A name longer than the header's field goes in a PAX record first, so tar can
    // carry it instead of refusing the entry.
    if (Buffer.byteLength(fullName) > 100) {
      chunks.push(...paxRecord(entry, fullName));

      chunks.push(
        tarHeader(entry, undefined, truncateName(fullName)),
      );
    } else {
      chunks.push(tarHeader(entry));
    }

    if (entry.data.length > 0) {
      chunks.push(entry.data);

      const padding = (TAR_BLOCK - (entry.data.length % TAR_BLOCK)) % TAR_BLOCK;

      if (padding > 0) chunks.push(Buffer.alloc(padding));
    }
  }

  // two empty blocks mark the end of the archive
  chunks.push(Buffer.alloc(TAR_BLOCK * 2));

  return Buffer.concat(chunks);
}

function readOctal(buffer: Buffer, offset: number, size: number): number {
  const text = buffer.toString("utf8", offset, offset + size).replace(/\0.*$/, "").trim();

  if (text === "") return 0;

  const value = parseInt(text, 8);

  return Number.isFinite(value) ? value : 0;
}

/** The `path=` value of a PAX record body, or `null`. */
function paxPath(body: Buffer): string | null {
  const text = body.toString("utf8");
  const match = /\d+ path=([^\n]*)\n/.exec(text);

  return match ? match[1]! : null;
}

function parseTar(buffer: Buffer): Entry[] {
  const entries: Entry[] = [];
  let offset = 0;
  /** A name carried by a PAX or GNU record, waiting for the entry it belongs to. */
  let pendingName: string | null = null;

  while (offset + TAR_BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + TAR_BLOCK);

    // an all-zero block ends the archive
    if (header.every((byte) => byte === 0)) break;

    const name = header.toString("utf8", 0, 100).replace(/\0.*$/, "");

    if (name === "") break;

    const size = readOctal(header, 124, 12);
    const typeFlag = header.toString("utf8", 156, 157);

    offset += TAR_BLOCK;

    const data = buffer.subarray(offset, offset + size);

    offset += Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;

    // A long name travels in a record of its own, ahead of the entry it names: PAX
    // writes `x` with a `path=` value, GNU writes `L` with the raw name. Both are read
    // here rather than skipped, so a long name survives the round trip.
    if (typeFlag === "x") {
      pendingName = paxPath(Buffer.from(data));
      continue;
    }

    if (typeFlag === "L") {
      pendingName = Buffer.from(data).toString("utf8").replace(/\0+$/, "");
      continue;
    }

    // other metadata records carry nothing this library uses
    if (typeFlag === "K" || typeFlag === "g") {
      continue;
    }

    const entryName = pendingName ?? name;
    pendingName = null;

    entries.push({
      name: entryName,
      data: Buffer.from(data),
      mode: readOctal(header, 100, 8),
      mtime: new Date(readOctal(header, 136, 12) * 1000),
      directory: typeFlag === "5" || entryName.endsWith("/"),
    });
  }

  return entries;
}

// ------------------------------------------------------------------- zip

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;
const ZIP64_END = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;

/** The value a 32-bit field carries when the real one is in a zip64 extra field. */
const ZIP32_MAX = 0xffffffff;
const ZIP16_MAX = 0xffff;

/** CRC-32, the checksum every zip entry carries. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);

  for (let i = 0; i < 256; i++) {
    let value = i;

    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[i] = value;
  }

  return table;
})();

function crc32(buffer: Buffer): number {
  return (crc32Update(-1, buffer) ^ -1) >>> 0;
}

/**
 * The running state of a crc32, so a file can be checksummed as it streams past rather
 * than held in memory to be checksummed at the end. Start from `-1`; finish by
 * `(state ^ -1) >>> 0`.
 */
function crc32Update(state: number, chunk: Buffer): number {
  let crc = state;

  for (let i = 0; i < chunk.length; i++) {
    crc = CRC_TABLE[(crc ^ chunk[i]!) & 0xff]! ^ (crc >>> 8);
  }

  return crc;
}

/** MS-DOS date/time, which is what the zip format stores. */
function dosTime(date: Date): { time: number; date: number } {
  return {
    time:
      (Math.floor(date.getSeconds() / 2) & 0x1f) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((date.getHours() & 0x1f) << 11),
    date:
      (date.getDate() & 0x1f) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      ((Math.max(0, date.getFullYear() - 1980) & 0x7f) << 9),
  };
}

function fromDosTime(time: number, date: number): Date {
  return new Date(
    1980 + ((date >> 9) & 0x7f),
    ((date >> 5) & 0x0f) - 1,
    date & 0x1f,
    (time >> 11) & 0x1f,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  );
}

interface PreparedZipEntry {
  entry: Entry;
  stored: Buffer;
  method: number;
  crc: number;
}

/**
 * A zip64 extra field: `0x0001` followed by the sizes (and, in the central directory,
 * the offset) as 64-bit values. The 32-bit fields it replaces carry `0xffffffff`, which
 * is how a reader knows to look here.
 */
function zip64Extra(
  originalSize: number,
  packedSize: number,
  offset: number | null,
): Buffer {
  const count = offset === null ? 2 : 3;
  const extra = Buffer.alloc(4 + count * 8);

  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(count * 8, 2);
  extra.writeBigUInt64LE(BigInt(originalSize), 4);
  extra.writeBigUInt64LE(BigInt(packedSize), 12);

  if (offset !== null) extra.writeBigUInt64LE(BigInt(offset), 20);

  return extra;
}

function buildZip(prepared: PreparedZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  /** Set when any entry or the archive itself outgrew the 32-bit fields. */
  let needsZip64 = prepared.length > ZIP16_MAX;

  for (const item of prepared) {
    const name = item.entry.directory
      ? item.entry.name.replace(/\/?$/, "/")
      : item.entry.name;
    const nameBytes = Buffer.from(name, "utf8");
    const { time, date } = dosTime(item.entry.mtime);

    const originalSize = item.entry.data.length;
    const packedSize = item.stored.length;

    // Anything that does not fit a 32-bit field moves into a zip64 extra field.
    const bigSizes = originalSize > ZIP32_MAX || packedSize > ZIP32_MAX;
    const bigOffset = offset > ZIP32_MAX;

    if (bigSizes || bigOffset) needsZip64 = true;

    const localExtra = bigSizes
      ? zip64Extra(originalSize, packedSize, null)
      : Buffer.alloc(0);
    const centralExtra =
      bigSizes || bigOffset
        ? zip64Extra(originalSize, packedSize, bigOffset ? offset : null)
        : Buffer.alloc(0);

    const version = bigSizes || bigOffset ? 45 : 20;

    const local = Buffer.alloc(30 + nameBytes.length + localExtra.length);

    local.writeUInt32LE(ZIP_LOCAL, 0);
    local.writeUInt16LE(version, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(item.method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(item.crc, 14);
    local.writeUInt32LE(bigSizes ? ZIP32_MAX : packedSize, 18);
    local.writeUInt32LE(bigSizes ? ZIP32_MAX : originalSize, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    nameBytes.copy(local, 30);
    localExtra.copy(local, 30 + nameBytes.length);

    const central = Buffer.alloc(46 + nameBytes.length + centralExtra.length);

    central.writeUInt32LE(ZIP_CENTRAL, 0);
    central.writeUInt16LE(version, 4);
    central.writeUInt16LE(version, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(item.method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(item.crc, 16);
    central.writeUInt32LE(bigSizes ? ZIP32_MAX : packedSize, 20);
    central.writeUInt32LE(bigSizes ? ZIP32_MAX : originalSize, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(centralExtra.length, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(
      ((item.entry.mode & 0o7777) << 16) | (item.entry.directory ? 0x10 : 0),
      38,
    );
    central.writeUInt32LE(bigOffset ? ZIP32_MAX : offset, 42);
    nameBytes.copy(central, 46);
    centralExtra.copy(central, 46 + nameBytes.length);

    locals.push(local, item.stored);
    centrals.push(central);

    offset += local.length + item.stored.length;
  }

  const centralBlock = Buffer.concat(centrals);

  if (centralBlock.length > ZIP32_MAX || offset > ZIP32_MAX) needsZip64 = true;

  const tail: Buffer[] = [];

  // zip64 adds its own end record and a locator pointing at it, ahead of the ordinary
  // end record, whose fields then carry the 0xffffffff / 0xffff markers.
  if (needsZip64) {
    const zip64End = Buffer.alloc(56);

    zip64End.writeUInt32LE(ZIP64_END, 0);
    zip64End.writeBigUInt64LE(44n, 4);
    zip64End.writeUInt16LE(45, 12);
    zip64End.writeUInt16LE(45, 14);
    zip64End.writeUInt32LE(0, 16);
    zip64End.writeUInt32LE(0, 20);
    zip64End.writeBigUInt64LE(BigInt(prepared.length), 24);
    zip64End.writeBigUInt64LE(BigInt(prepared.length), 32);
    zip64End.writeBigUInt64LE(BigInt(centralBlock.length), 40);
    zip64End.writeBigUInt64LE(BigInt(offset), 48);

    const locator = Buffer.alloc(20);

    locator.writeUInt32LE(ZIP64_LOCATOR, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(offset + centralBlock.length), 8);
    locator.writeUInt32LE(1, 16);

    tail.push(zip64End, locator);
  }

  const end = Buffer.alloc(22);

  end.writeUInt32LE(ZIP_END, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(needsZip64 ? ZIP16_MAX : prepared.length, 8);
  end.writeUInt16LE(needsZip64 ? ZIP16_MAX : prepared.length, 10);
  end.writeUInt32LE(
    centralBlock.length > ZIP32_MAX ? ZIP32_MAX : centralBlock.length,
    12,
  );
  end.writeUInt32LE(offset > ZIP32_MAX ? ZIP32_MAX : offset, 16);
  end.writeUInt16LE(0, 20);

  tail.push(end);

  return Buffer.concat([...locals, centralBlock, ...tail]);
}

/** Where the central directory starts, found by scanning back for the end record. */
function findEndRecord(buffer: Buffer): number {
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);

  for (let i = buffer.length - 22; i >= lowest; i--) {
    if (buffer.readUInt32LE(i) === ZIP_END) return i;
  }

  return -1;
}

/**
 * Where the directory is and how many entries it has.
 *
 * An archive over 4 GB, or with more than 65535 entries, cannot say so in the ordinary
 * end record: its fields carry markers and the real values live in a zip64 end record,
 * which a locator just before the ordinary one points at.
 */
function readDirectoryInfo(
  buffer: Buffer,
  end: number,
): { count: number; offset: number } {
  let count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);

  const locator = end - 20;

  if (
    locator >= 0 &&
    buffer.readUInt32LE(locator) === ZIP64_LOCATOR &&
    (count === ZIP16_MAX || offset === ZIP32_MAX)
  ) {
    const zip64End = Number(buffer.readBigUInt64LE(locator + 8));

    if (
      zip64End >= 0 &&
      zip64End + 56 <= buffer.length &&
      buffer.readUInt32LE(zip64End) === ZIP64_END
    ) {
      count = Number(buffer.readBigUInt64LE(zip64End + 32));
      offset = Number(buffer.readBigUInt64LE(zip64End + 48));
    }
  }

  return { count, offset };
}

/** The sizes and offset a zip64 extra field carries, when it has them. */
function readZip64Extra(
  extra: Buffer,
  wants: { size: boolean; offset: boolean },
): { originalSize?: number; packedSize?: number; offset?: number } {
  let at = 0;

  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const size = extra.readUInt16LE(at + 2);
    const body = extra.subarray(at + 4, at + 4 + size);

    if (id === 0x0001) {
      const found: {
        originalSize?: number;
        packedSize?: number;
        offset?: number;
      } = {};

      let cursor = 0;

      // the fields appear only for the ones the 32-bit header could not hold,
      // in a fixed order: original size, packed size, offset
      if (wants.size && cursor + 16 <= body.length) {
        found.originalSize = Number(body.readBigUInt64LE(cursor));
        found.packedSize = Number(body.readBigUInt64LE(cursor + 8));
        cursor += 16;
      }

      if (wants.offset && cursor + 8 <= body.length) {
        found.offset = Number(body.readBigUInt64LE(cursor));
      }

      return found;
    }

    at += 4 + size;
  }

  return {};
}

export {};

// -------------------------------------------------------------- the library

class Tar extends ArchiveMethodBuilder {
  override call() {
    const entries = this.toEntries(this.args[0]);

    try {
      return this.toBytes(buildTar(entries));
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class Untar extends ArchiveMethodBuilder {
  override call() {
    const [data] = this.args;

    this.assertBinary(data, "data");

    try {
      return parseTar(this.toBuffer(data)).map((entry) => this.toValue(entry));
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class Zip extends ArchiveMethodBuilder {
  override *call(): Gen<any> {
    const [input, options] = this.args;

    const entries = this.toEntries(input);
    const level =
      options && typeof options["level"] === "number" ? options["level"] : 6;

    const prepared: PreparedZipEntry[] = [];

    for (const entry of entries) {
      if (entry.directory || entry.data.length === 0 || level === 0) {
        prepared.push({
          entry,
          stored: entry.data,
          method: 0,
          crc: crc32(entry.data),
        });

        continue;
      }

      // deflate on the host thread pool: the task parks, it does not block
      const stored: Buffer = yield fromCallback<Buffer>((done) => {
        zlib.deflateRaw(entry.data, { level }, done as any);
      });

      // a compressed form that grew is stored as-is, like every zip writer does
      const grew = stored.length >= entry.data.length;

      prepared.push({
        entry,
        stored: grew ? entry.data : stored,
        method: grew ? 0 : 8,
        crc: crc32(entry.data),
      });
    }

    try {
      return this.toBytes(buildZip(prepared));
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }
  }
}

class Unzip extends ArchiveMethodBuilder {
  override *call(): Gen<any> {
    const [data] = this.args;

    this.assertBinary(data, "data");

    const buffer = this.toBuffer(data);
    const end = findEndRecord(buffer);

    if (end === -1) {
      throw this.throwErrorFormatters(
        new Error("not a zip archive: the end-of-directory record is missing"),
      );
    }

    const { count, offset: directoryStart } = readDirectoryInfo(buffer, end);

    let offset = directoryStart;
    const entries: any[] = [];

    for (let i = 0; i < count; i++) {
      if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL) {
        throw this.throwErrorFormatters(
          new Error(`zip directory is damaged at entry ${i}`),
        );
      }

      const method = buffer.readUInt16LE(offset + 10);
      const time = buffer.readUInt16LE(offset + 12);
      const date = buffer.readUInt16LE(offset + 14);
      let packedSize = buffer.readUInt32LE(offset + 20);
      let originalSize = buffer.readUInt32LE(offset + 24);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const external = buffer.readUInt32LE(offset + 38);
      let localOffset = buffer.readUInt32LE(offset + 42);

      const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

      // a marker in any of these means the real value is in the zip64 extra field
      if (
        packedSize === ZIP32_MAX ||
        originalSize === ZIP32_MAX ||
        localOffset === ZIP32_MAX
      ) {
        const extraStart = offset + 46 + nameLength;
        const big = readZip64Extra(
          buffer.subarray(extraStart, extraStart + extraLength),
          {
            size: packedSize === ZIP32_MAX || originalSize === ZIP32_MAX,
            offset: localOffset === ZIP32_MAX,
          },
        );

        if (big.originalSize !== undefined) originalSize = big.originalSize;
        if (big.packedSize !== undefined) packedSize = big.packedSize;
        if (big.offset !== undefined) localOffset = big.offset;
      }

      offset += 46 + nameLength + extraLength + commentLength;

      if (buffer.readUInt32LE(localOffset) !== ZIP_LOCAL) {
        throw this.throwErrorFormatters(
          new Error(`zip entry "${name}" points at a damaged local header`),
        );
      }

      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const stored = buffer.subarray(start, start + packedSize);

      const directory = name.endsWith("/");
      let content: Buffer;

      if (directory) {
        content = Buffer.alloc(0);
      } else if (method === 0) {
        content = Buffer.from(stored);
      } else if (method === 8) {
        content = yield fromCallback<Buffer>((done) => {
          zlib.inflateRaw(stored, done as any);
        });
      } else {
        throw this.throwErrorFormatters(
          new Error(`zip entry "${name}" uses unsupported method ${method}`),
        );
      }

      if (!directory && content.length !== originalSize) {
        throw this.throwErrorFormatters(
          new Error(
            `zip entry "${name}" has the wrong size: expected ${originalSize}, got ${content.length}`,
          ),
        );
      }

      entries.push(
        this.toValue({
          name,
          data: content,
          mode: (external >>> 16) & 0o7777 || (directory ? 0o755 : 0o644),
          mtime: fromDosTime(time, date),
          directory,
        }),
      );
    }

    return entries;
  }
}

/** `archive.format(data)` - "zip", "tar", "gzip" or "unknown". */
function detectFormat(buffer: Buffer): string {
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === ZIP_LOCAL) return "zip";
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return "gzip";

  if (
    buffer.length >= 263 &&
    buffer.toString("utf8", 257, 262) === "ustar"
  ) {
    return "tar";
  }

  return "unknown";
}

class Format extends ArchiveMethodBuilder {
  override call() {
    const [data] = this.args;

    this.assertBinary(data, "data");

    return detectFormat(this.toBuffer(data));
  }
}

/**
 * `archive.read(data)` - entries of a zip, tar or gzipped tar, without being told which.
 * This is the function most programs want: it recognises the format and unpacks it.
 */
class ReadArchive extends ArchiveMethodBuilder {
  override *call(): Gen<any> {
    const [data] = this.args;

    this.assertBinary(data, "data");

    let buffer = this.toBuffer(data);
    let format = detectFormat(buffer);

    if (format === "gzip") {
      buffer = yield fromCallback<Buffer>((done) => {
        zlib.gunzip(buffer, done as any);
      });

      format = detectFormat(buffer);

      // a .tar.gz whose inner tar has no ustar magic is still a tar
      if (format === "unknown" && buffer.length % TAR_BLOCK === 0) format = "tar";
    }

    if (format === "zip") {
      return yield new Unzip([this.toBytes(buffer)], [], this.environment).call();
    }

    if (format === "tar") {
      return parseTar(buffer).map((entry) => this.toValue(entry));
    }

    throw this.throwErrorFormatters(
      new Error("unrecognised archive format (expected zip, tar or tar.gz)"),
    );
  }
}

/**
 * `archive.extract(data, destination)` - unpack an archive onto disk.
 *
 * Needs `--allow-write` for the destination. Entry names that would escape it are
 * rejected rather than written, so an untrusted archive cannot reach outside.
 */
class Extract extends ArchiveMethodBuilder {
  override *call(): Gen<any> {
    const [data, destination] = this.args;

    this.assertBinary(data, "data");
    this.assertString(destination, "destination");
    this.checkPermission("write", destination);

    const entries = yield new ReadArchive(
      [data],
      [],
      this.environment,
    ).call();

    const root = path.resolve(destination);
    const written: string[] = [];

    try {
      yield hostAwait(fsp.mkdir(root, { recursive: true }));

      for (const entry of entries) {
        const safe = normalizeName(entry.name);

        if (safe === null) {
          throw new Error(
            `refusing to extract "${entry.name}": it escapes the destination`,
          );
        }

        const target = path.join(root, safe);

        if (entry.directory) {
          yield hostAwait(fsp.mkdir(target, { recursive: true }));
          continue;
        }

        yield hostAwait(fsp.mkdir(path.dirname(target), { recursive: true }));
        yield hostAwait(fsp.writeFile(target, this.toBuffer(entry.data)));

        written.push(safe);
      }
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    }

    return written;
  }
}

/**
 * `archive.create(sourceDir, format)` - pack a directory into a zip or tar.
 * Needs `--allow-read` for the directory.
 */
class Create extends ArchiveMethodBuilder {
  override *call(): Gen<any> {
    const [source, format = "zip", options] = this.args;

    this.assertString(source, "source");
    this.checkPermission("read", source);

    if (format !== "zip" && format !== "tar") {
      throw this.throwErrorFormatters(
        new Error(`format must be "zip" or "tar", received "${format}"`),
      );
    }

    const root = path.resolve(source);
    const collected: any[] = [];

    yield this.collect(root, root, collected);

    if (format === "tar") {
      return new Tar([collected], [], this.environment).call();
    }

    return yield new Zip(
      [collected, options],
      [],
      this.environment,
    ).call();
  }

  private *collect(root: string, dir: string, out: any[]): Gen<void> {
    const items = yield hostAwait(fsp.readdir(dir, { withFileTypes: true }));

    for (const item of items) {
      const full = path.join(dir, item.name);
      const relative = path.relative(root, full).replace(/\\/g, "/");

      if (item.isDirectory()) {
        out.push({ name: `${relative}/`, directory: true });

        yield this.collect(root, full, out);
        continue;
      }

      if (!item.isFile()) continue;

      out.push({
        name: relative,
        data: this.toBytes(yield hostAwait(fsp.readFile(full))),
      });
    }
  }
}


// ------------------------------------------------- reading and writing on disk

/**
 * `archive.extractFile(archivePath, destination)` - unpack an archive from disk.
 *
 * `archive.extract` needs the whole archive in memory as a `bytes` value first, which a
 * multi-gigabyte archive cannot satisfy. This reads it from disk instead: a tar is walked
 * block by block, and a zip through its directory, one entry at a time. The memory it
 * uses depends on the largest entry, not on the size of the archive.
 *
 * Needs `--allow-read` for the archive and `--allow-write` for the destination. Entry
 * names are checked the same way as in `archive.extract`, so an untrusted archive cannot
 * write outside the destination.
 */
class ExtractFile extends ArchiveMethodBuilder {
  override *call(): Gen<any> {
    const [archivePath, destination] = this.args;

    this.assertString(archivePath, "archivePath");
    this.assertString(destination, "destination");
    this.checkPermission("read", archivePath);
    this.checkPermission("write", destination);

    const root = path.resolve(destination);
    const written: string[] = [];

    let handle: fsp.FileHandle;

    try {
      handle = yield hostAwait(fsp.open(archivePath, "r"));
    } catch (error: any) {
      throw this.throwErrorFormatters(
        new Error(`cannot open "${archivePath}": ${error?.message ?? error}`),
      );
    }

    try {
      yield hostAwait(fsp.mkdir(root, { recursive: true }));

      const head = Buffer.alloc(TAR_BLOCK);
      const { bytesRead } = yield hostAwait(handle.read(head, 0, TAR_BLOCK, 0));
      const format = detectFormat(head.subarray(0, bytesRead));

      if (format === "zip") {
        yield this.extractZip(handle, root, written);
      } else if (format === "tar") {
        yield this.extractTar(handle, root, written);
      } else if (format === "gzip") {
        throw new Error(
          "a gzipped archive has to be read as one piece; use archive.extract(compress.gunzip(...)) " +
            "or unpack it with compress.file first",
        );
      } else {
        throw new Error("unrecognised archive format (expected zip or tar)");
      }
    } catch (error: any) {
      throw this.throwErrorFormatters(error);
    } finally {
      yield hostAwait(handle.close());
    }

    return written;
  }

  /** Write one entry, refusing a name that would leave the destination. */
  private *writeEntry(
    root: string,
    name: string,
    data: Buffer,
    directory: boolean,
    written: string[],
  ): Gen<void> {
    const safe = normalizeName(name);

    if (safe === null) {
      throw new Error(
        `refusing to extract "${name}": it escapes the destination`,
      );
    }

    const target = path.join(root, safe);

    if (directory) {
      yield hostAwait(fsp.mkdir(target, { recursive: true }));
      return;
    }

    yield hostAwait(fsp.mkdir(path.dirname(target), { recursive: true }));
    yield hostAwait(fsp.writeFile(target, data));

    written.push(safe);
  }

  /** Walk a tar one header block at a time. */
  private *extractTar(
    handle: fsp.FileHandle,
    root: string,
    written: string[],
  ): Gen<void> {
    const header = Buffer.alloc(TAR_BLOCK);
    let position = 0;
    let pendingName: string | null = null;

    for (;;) {
      const { bytesRead } = yield hostAwait(
        handle.read(header, 0, TAR_BLOCK, position),
      );

      if (bytesRead < TAR_BLOCK) break;

      position += TAR_BLOCK;

      if (header.every((byte) => byte === 0)) break;

      const rawName = header.toString("utf8", 0, 100).replace(/\0.*$/, "");

      if (rawName === "") break;

      const size = readOctal(header, 124, 12);
      const typeFlag = header.toString("utf8", 156, 157);
      const padded = Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;

      // only an entry's own body is ever held in memory, never the whole archive
      const body = size > 0 ? Buffer.alloc(size) : Buffer.alloc(0);

      if (size > 0) {
        this.checkAllocation(size);
        yield hostAwait(handle.read(body, 0, size, position));
      }

      position += padded;

      if (typeFlag === "x") {
        pendingName = paxPath(body);
        continue;
      }

      if (typeFlag === "L") {
        pendingName = body.toString("utf8").replace(/\0+$/, "");
        continue;
      }

      if (typeFlag === "K" || typeFlag === "g") continue;

      const name = pendingName ?? rawName;
      pendingName = null;

      yield this.writeEntry(
        root,
        name,
        body,
        typeFlag === "5" || name.endsWith("/"),
        written,
      );
    }
  }

  /** Walk a zip through its central directory, reading one entry at a time. */
  private *extractZip(
    handle: fsp.FileHandle,
    root: string,
    written: string[],
  ): Gen<void> {
    const stats = yield hostAwait(handle.stat());
    const size = stats.size;

    // the end record is at the very back, after at most 64 KiB of comment
    const tailLength = Math.min(size, 22 + 0xffff);
    const tail = Buffer.alloc(tailLength);

    yield hostAwait(handle.read(tail, 0, tailLength, size - tailLength));

    const endInTail = findEndRecord(tail);

    if (endInTail === -1) {
      throw new Error("not a zip archive: the end-of-directory record is missing");
    }

    const { count, offset: directoryStart } = readDirectoryInfo(tail, endInTail);
    const directoryLength = Math.max(0, size - directoryStart);

    this.checkAllocation(directoryLength);

    const directory = Buffer.alloc(directoryLength);

    yield hostAwait(
      handle.read(directory, 0, directoryLength, directoryStart),
    );

    let at = 0;

    for (let i = 0; i < count; i++) {
      if (at + 46 > directory.length || directory.readUInt32LE(at) !== ZIP_CENTRAL) {
        throw new Error(`zip directory is damaged at entry ${i}`);
      }

      const method = directory.readUInt16LE(at + 10);
      let packedSize = directory.readUInt32LE(at + 20);
      let originalSize = directory.readUInt32LE(at + 24);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      let localOffset = directory.readUInt32LE(at + 42);

      const name = directory.toString("utf8", at + 46, at + 46 + nameLength);

      if (
        packedSize === ZIP32_MAX ||
        originalSize === ZIP32_MAX ||
        localOffset === ZIP32_MAX
      ) {
        const extraStart = at + 46 + nameLength;
        const big = readZip64Extra(
          directory.subarray(extraStart, extraStart + extraLength),
          {
            size: packedSize === ZIP32_MAX || originalSize === ZIP32_MAX,
            offset: localOffset === ZIP32_MAX,
          },
        );

        if (big.originalSize !== undefined) originalSize = big.originalSize;
        if (big.packedSize !== undefined) packedSize = big.packedSize;
        if (big.offset !== undefined) localOffset = big.offset;
      }

      at += 46 + nameLength + extraLength + commentLength;

      if (name.endsWith("/")) {
        yield this.writeEntry(root, name, Buffer.alloc(0), true, written);
        continue;
      }

      // the local header says where this entry's bytes actually start
      const localHeader = Buffer.alloc(30);

      yield hostAwait(handle.read(localHeader, 0, 30, localOffset));

      if (localHeader.readUInt32LE(0) !== ZIP_LOCAL) {
        throw new Error(`zip entry "${name}" points at a damaged local header`);
      }

      const bodyStart =
        localOffset +
        30 +
        localHeader.readUInt16LE(26) +
        localHeader.readUInt16LE(28);

      this.checkAllocation(packedSize);

      const stored = Buffer.alloc(packedSize);

      if (packedSize > 0) {
        yield hostAwait(handle.read(stored, 0, packedSize, bodyStart));
      }

      let content: Buffer;

      if (method === 0) {
        content = stored;
      } else if (method === 8) {
        content = yield fromCallback<Buffer>((done) => {
          zlib.inflateRaw(stored, done as any);
        });
      } else {
        throw new Error(`zip entry "${name}" uses unsupported method ${method}`);
      }

      yield this.writeEntry(root, name, content, false, written);
    }
  }
}

/**
 * `archive.createFile(sourceDir, archivePath, format)` - pack a directory onto disk.
 *
 * `archive.create` builds the whole archive as one value, so packing a large tree needs
 * room for the tree and the archive at once. This writes the archive as it goes: each
 * file is streamed from disk into the output, so what the program holds does not depend
 * on the size of the tree or of any file in it.
 *
 * Needs `--allow-read` for the directory and `--allow-write` for the archive.
 */
class CreateFile extends ArchiveMethodBuilder {
  override *call(): Gen<any> {
    const [source, archivePath, format = "zip"] = this.args;

    this.assertString(source, "source");
    this.assertString(archivePath, "archivePath");
    this.checkPermission("read", source);
    this.checkPermission("write", archivePath);

    if (format !== "zip" && format !== "tar") {
      throw this.throwErrorFormatters(
        new Error(`format must be "zip" or "tar", received "${format}"`),
      );
    }

    const root = path.resolve(source);
    const listed: Array<{ name: string; full: string; directory: boolean }> = [];

    yield this.list(root, root, listed);

    let out: fs.WriteStream;

    try {
      out = fs.createWriteStream(archivePath);

      yield fromEvent(out as any, "open", null);
    } catch (error: any) {
      throw this.throwErrorFormatters(
        new Error(`cannot write "${archivePath}": ${error?.message ?? error}`),
      );
    }

    try {
      if (format === "tar") {
        yield this.writeTar(out, listed);
      } else {
        yield this.writeZip(out, listed);
      }
    } catch (error: any) {
      out.destroy();

      throw this.throwErrorFormatters(error);
    }

    yield this.finishStream(out);

    return archivePath;
  }

  /** Names and kinds only - no file is read here. */
  private *list(
    root: string,
    dir: string,
    out: Array<{ name: string; full: string; directory: boolean }>,
  ): Gen<void> {
    const items = yield hostAwait(fsp.readdir(dir, { withFileTypes: true }));

    for (const item of items) {
      const full = path.join(dir, item.name);
      const relative = path.relative(root, full).replace(/\\/g, "/");

      if (item.isDirectory()) {
        out.push({ name: `${relative}/`, full, directory: true });

        yield this.list(root, full, out);
        continue;
      }

      if (!item.isFile()) continue;

      out.push({ name: relative, full, directory: false });
    }
  }

  /** Write one buffer, parking if the stream asks us to wait. */
  private *put(out: fs.WriteStream, chunk: Buffer): Gen<void> {
    if (out.write(chunk)) return;

    // the stream's buffer is full: wait for it to drain instead of filling memory
    yield fromEvent(out as any, "drain", null);
  }

  /** Close the stream and park until the bytes are on disk. */
  private *finishStream(out: fs.WriteStream): Gen<void> {
    yield park<void>((wake, fail) => {
      out.once("error", fail);
      out.once("close", () => wake());
      out.end();
    });
  }

  /** Copy a file into the archive in pieces, checksumming as it passes. */
  private *copyInto(
    out: fs.WriteStream,
    full: string,
    onChunk?: (chunk: Buffer) => void,
  ): Gen<number> {
    const handle: fsp.FileHandle = yield hostAwait(fsp.open(full, "r"));
    const buffer = Buffer.alloc(64 * 1024);
    let written = 0;

    try {
      for (;;) {
        const { bytesRead } = yield hostAwait(
          handle.read(buffer, 0, buffer.length, null),
        );

        if (bytesRead === 0) break;

        const chunk = buffer.subarray(0, bytesRead);

        if (onChunk) onChunk(chunk);

        yield this.put(out, Buffer.from(chunk));

        written += bytesRead;
      }
    } finally {
      yield hostAwait(handle.close());
    }

    return written;
  }

  private *writeTar(
    out: fs.WriteStream,
    listed: Array<{ name: string; full: string; directory: boolean }>,
  ): Gen<void> {
    for (const item of listed) {
      const stats = item.directory
        ? null
        : yield hostAwait(fsp.stat(item.full));

      const size = stats ? stats.size : 0;
      const mtime = stats ? stats.mtime : new Date();

      // the header needs the size, which stat gives without reading the file
      const entry: Entry = {
        name: item.name,
        data: { length: size } as any,
        directory: item.directory,
        mode: item.directory ? 0o755 : 0o644,
        mtime,
      };

      const longName = Buffer.byteLength(item.name) > 100;

      if (longName) {
        for (const block of paxRecord(entry, item.name)) {
          yield this.put(out, block);
        }

        yield this.put(out, tarHeader(entry, undefined, truncateName(item.name)));
      } else {
        yield this.put(out, tarHeader(entry));
      }

      if (item.directory || size === 0) continue;

      const copied = yield this.copyInto(out, item.full);

      if (copied !== size) {
        throw new Error(
          `"${item.name}" changed size while it was being packed ` +
            `(${size} bytes expected, ${copied} written)`,
        );
      }

      const padding = (TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK;

      if (padding > 0) yield this.put(out, Buffer.alloc(padding));
    }

    // two empty blocks end a tar
    yield this.put(out, Buffer.alloc(TAR_BLOCK * 2));
  }

  private *writeZip(
    out: fs.WriteStream,
    listed: Array<{ name: string; full: string; directory: boolean }>,
  ): Gen<void> {
    interface Written {
      name: string;
      directory: boolean;
      crc: number;
      packed: number;
      original: number;
      offset: number;
      time: number;
      date: number;
    }

    const written: Written[] = [];
    let at = 0;

    for (const item of listed) {
      const stats = item.directory
        ? null
        : yield hostAwait(fsp.stat(item.full));

      const name = Buffer.from(item.name, "utf8");
      const stamp = dosTime(stats ? stats.mtime : new Date());
      const offset = at;

      // The sizes are not known until the file has been read, and this writes the header
      // before reading it - so the header says "a descriptor follows" (bit 3) and the
      // true sizes are written after the data, which is what the format is for.
      const local = Buffer.alloc(30);

      local.writeUInt32LE(ZIP_LOCAL, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(item.directory ? 0x0800 : 0x0808, 6);
      local.writeUInt16LE(item.directory ? 0 : 8, 8);
      local.writeUInt16LE(stamp.time, 10);
      local.writeUInt16LE(stamp.date, 12);
      local.writeUInt32LE(0, 14);
      local.writeUInt32LE(0, 18);
      local.writeUInt32LE(0, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);

      yield this.put(out, local);
      yield this.put(out, name);

      at += 30 + name.length;

      if (item.directory) {
        written.push({
          name: item.name,
          directory: true,
          crc: 0,
          packed: 0,
          original: 0,
          offset,
          time: stamp.time,
          date: stamp.date,
        });

        continue;
      }

      let crcState = -1;
      let original = 0;
      let packed = 0;

      const deflate = zlib.createDeflateRaw();
      const sink = (chunk: Buffer) => {
        packed += chunk.length;
      };

      // the deflated bytes go to the file as they are produced; nothing collects them
      deflate.on("data", (chunk: Buffer) => {
        sink(chunk);
        out.write(chunk);
      });

      const handle: fsp.FileHandle = yield hostAwait(fsp.open(item.full, "r"));
      const buffer = Buffer.alloc(64 * 1024);

      try {
        for (;;) {
          const { bytesRead } = yield hostAwait(
            handle.read(buffer, 0, buffer.length, null),
          );

          if (bytesRead === 0) break;

          const chunk = Buffer.from(buffer.subarray(0, bytesRead));

          crcState = crc32Update(crcState, chunk);
          original += bytesRead;

          if (!deflate.write(chunk)) {
            yield fromEvent(deflate as any, "drain", null);
          }
        }
      } finally {
        yield hostAwait(handle.close());
      }

      yield park<void>((wake, fail) => {
        deflate.once("error", fail);
        deflate.once("end", () => wake());
        deflate.end();
      });

      const crc = (crcState ^ -1) >>> 0;
      const descriptor = Buffer.alloc(16);

      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(Math.min(packed, ZIP32_MAX), 8);
      descriptor.writeUInt32LE(Math.min(original, ZIP32_MAX), 12);

      yield this.put(out, descriptor);

      at += packed + 16;

      written.push({
        name: item.name,
        directory: false,
        crc,
        packed,
        original,
        offset,
        time: stamp.time,
        date: stamp.date,
      });
    }

    // the central directory: where every entry is, and how big it really is
    const directoryStart = at;

    for (const entry of written) {
      const name = Buffer.from(entry.name, "utf8");
      const needsZip64 =
        entry.packed > ZIP32_MAX ||
        entry.original > ZIP32_MAX ||
        entry.offset > ZIP32_MAX;

      const extra = needsZip64
        ? zip64Extra(entry.original, entry.packed, entry.offset)
        : Buffer.alloc(0);

      const central = Buffer.alloc(46);

      central.writeUInt32LE(ZIP_CENTRAL, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(needsZip64 ? 45 : 20, 6);
      central.writeUInt16LE(entry.directory ? 0x0800 : 0x0808, 8);
      central.writeUInt16LE(entry.directory ? 0 : 8, 10);
      central.writeUInt16LE(entry.time, 12);
      central.writeUInt16LE(entry.date, 14);
      central.writeUInt32LE(entry.crc, 16);
      central.writeUInt32LE(Math.min(entry.packed, ZIP32_MAX), 20);
      central.writeUInt32LE(Math.min(entry.original, ZIP32_MAX), 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt16LE(extra.length, 30);
      central.writeUInt16LE(0, 32);
      central.writeUInt16LE(0, 34);
      central.writeUInt16LE(0, 36);
      central.writeUInt32LE(entry.directory ? 0x10 : 0, 38);
      central.writeUInt32LE(Math.min(entry.offset, ZIP32_MAX), 42);

      yield this.put(out, central);
      yield this.put(out, name);

      if (extra.length > 0) yield this.put(out, extra);

      at += 46 + name.length + extra.length;
    }

    const directoryLength = at - directoryStart;
    const needsZip64 =
      written.length > ZIP16_MAX ||
      directoryStart > ZIP32_MAX ||
      directoryLength > ZIP32_MAX;

    if (needsZip64) {
      const record = Buffer.alloc(56);

      record.writeUInt32LE(ZIP64_END, 0);
      record.writeBigUInt64LE(44n, 4);
      record.writeUInt16LE(45, 12);
      record.writeUInt16LE(45, 14);
      record.writeUInt32LE(0, 16);
      record.writeUInt32LE(0, 20);
      record.writeBigUInt64LE(BigInt(written.length), 24);
      record.writeBigUInt64LE(BigInt(written.length), 32);
      record.writeBigUInt64LE(BigInt(directoryLength), 40);
      record.writeBigUInt64LE(BigInt(directoryStart), 48);

      const locator = Buffer.alloc(20);

      locator.writeUInt32LE(ZIP64_LOCATOR, 0);
      locator.writeUInt32LE(0, 4);
      locator.writeBigUInt64LE(BigInt(at), 8);
      locator.writeUInt32LE(1, 16);

      yield this.put(out, record);
      yield this.put(out, locator);
    }

    const end = Buffer.alloc(22);

    end.writeUInt32LE(ZIP_END, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(Math.min(written.length, ZIP16_MAX), 8);
    end.writeUInt16LE(Math.min(written.length, ZIP16_MAX), 10);
    end.writeUInt32LE(Math.min(directoryLength, ZIP32_MAX), 12);
    end.writeUInt32LE(Math.min(directoryStart, ZIP32_MAX), 16);
    end.writeUInt16LE(0, 20);

    yield this.put(out, end);
  }
}

module.exports = {
  tar: Tar,
  untar: Untar,
  zip: Zip,
  unzip: Unzip,
  read: ReadArchive,
  extract: Extract,
  extractFile: ExtractFile,
  create: Create,
  createFile: CreateFile,
  format: Format,
};
