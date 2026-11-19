import { FunctionBuilder, FunctionBuilderCodeError } from "../FunctionBuilder";
import { Environment } from "../../src/Environment";
import { type StmtType } from "../../src/ast/StmtType";
import { isTypeArgs } from "../utils/utils";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import { Bytes } from "../bytes/Bytes";
import { type Gen } from "../../src/runtime/coroutine";
import { fromCallback, hostAwait } from "../kernel/async";
import { unwrapBuffer } from "../kernel/buffers";

type Encoding = "hex" | "base64" | "base64url" | "utf8" | "utf-8" | "binary";

interface EncryptionResult {
  encrypted: string;
  iv?: string;
  authTag?: string;
  algorithm: string;
}

interface EncryptOptions {
  algorithm?: string;
  iv?: string | Buffer | null;
  encoding?: Encoding;
  outputFormat?: "string" | "object";
}

interface DecryptOptions {
  algorithm?: string;
  iv?: string | Buffer;
  authTag?: string | Buffer;
  encoding?: Encoding;
}

interface PasswordOptions {
  numbers?: boolean;
  lowercase?: boolean;
  uppercase?: boolean;
  symbols?: boolean;
  excludeSimilar?: boolean;
  exclude?: string;
}

interface HashPasswordOptions {
  saltRounds?: number;
  algorithm?: string;
}

interface DeriveKeyOptions {
  iterations?: number;
  keyLength?: number;
  algorithm?: string;
  encoding?: Encoding;
}

interface SigningOptions {
  encoding?: Encoding;
  passphrase?: string;
}

abstract class CryptoMethodBuilder extends FunctionBuilder {
  constructor(args: any[], astArgs: StmtType[], environment: Environment) {
    // `Bytes` / `ByteArray` values are accepted wherever a buffer is: unwrap them once
    super(
      args.map((arg) =>
        unwrapBuffer(arg) ?? arg,
      ),
      astArgs,
      environment,
    );
  }

  /** Binary results are handed to the program as `Bytes` objects, not host Buffers. */
  protected wrapBytes(buffer: Buffer): any {
    return new Bytes([buffer], [], this.environment).call();
  }

  get pkgInfo() {
    return {
      name: "crypto",
      path: __dirname,
      version: "2.0.0",
    };
  }

  protected validateString(str: any, argName: string = "string"): asserts str is string {
    if (isTypeArgs(str) !== "string") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "string",
        received: isTypeArgs(str),
      });
    }
  }

  protected validateBuffer(buf: any, argName: string = "buffer"): void {
    if (!Buffer.isBuffer(buf) && isTypeArgs(buf) !== "string") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "buffer or string",
        received: isTypeArgs(buf),
      });
    }
  }

  protected validateNumber(num: any, argName: string = "number"): asserts num is number {
    if (isTypeArgs(num) !== "int" && isTypeArgs(num) !== "float") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "number",
        received: isTypeArgs(num),
      });
    }
  }

  protected validateBoolean(bool: any, argName: string = "boolean"): asserts bool is boolean {
    if (isTypeArgs(bool) !== "boolean") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "boolean",
        received: isTypeArgs(bool),
      });
    }
  }

  protected validateObject(obj: any, argName: string = "object"): asserts obj is object {
    if (isTypeArgs(obj) !== "object") {
      throw this.throwErrorFormatters(FunctionBuilderCodeError.ArgumentsTypeError, {
        propsName: argName,
        expectType: "object",
        received: isTypeArgs(obj),
      });
    }
  }

  protected validateEncoding(encoding: any): asserts encoding is Encoding {
    const validEncodings: Encoding[] = ["hex", "base64", "base64url", "utf8", "utf-8", "binary"];
    if (!validEncodings.includes(encoding)) {
      throw this.throwErrorFormatters(new Error(`Invalid encoding: ${encoding}. Valid encodings are: ${validEncodings.join(", ")}`));
    }
  }

  protected validatePositive(num: number, argName: string = "number"): void {
    if (num <= 0) {
      throw this.throwErrorFormatters(new Error(`${argName} must be positive, got: ${num}`));
    }
  }

  /**
   * Key derivation on the host's thread pool instead of its main thread.
   *
   * PBKDF2, scrypt and HKDF are deliberately slow - that is what makes them useful for
   * passwords - so running them synchronously froze the whole interpreter for as long as
   * they took. These park the calling task instead, which keeps every other task running.
   */
  protected *pbkdf2(
    password: Buffer,
    salt: Buffer,
    iterations: number,
    keylen: number,
    digest: string,
  ): Gen<Buffer> {
    return yield fromCallback<Buffer>((done) => {
      crypto.pbkdf2(password, salt, iterations, keylen, digest, done as any);
    });
  }

  protected *scrypt(
    password: Buffer,
    salt: Buffer,
    keylen: number,
    options: crypto.ScryptOptions,
  ): Gen<Buffer> {
    return yield fromCallback<Buffer>((done) => {
      crypto.scrypt(password, salt, keylen, options, done as any);
    });
  }

  protected *hkdf(
    hash: string,
    ikm: Buffer,
    salt: Buffer,
    info: Buffer,
    keylen: number,
  ): Gen<ArrayBuffer> {
    return yield fromCallback<ArrayBuffer>((done) => {
      crypto.hkdf(hash, ikm, salt, info, keylen, done as any);
    });
  }

  protected validateRange(num: number, min: number, max: number, argName: string = "number"): void {
    if (num < min || num > max) {
      throw this.throwErrorFormatters(new Error(`${argName} must be between ${min} and ${max}, got: ${num}`));
    }
  }

  /**
   * Same conversion as every other library (see `library/kernel/buffers`), plus the
   * lenient fallback crypto has always had: a value that is not binary at all is hashed
   * as its text form, so `crypto.hash("sha256", 42)` keeps working.
   */
  protected override toBuffer(
    data: any,
    encoding: BufferEncoding = "utf-8",
  ): Buffer {
    try {
      return super.toBuffer(data, encoding);
    } catch {
      return Buffer.from(String(data), encoding);
    }
  }

  /**
   * IVs and auth tags travel as text in the encoding the cipher output uses
   * (`hex` by default), so a string is decoded with that encoding; buffers and
   * `Bytes` are taken as they are.
   */
  protected decodeBinary(value: any, encoding: string): Buffer {
    if (typeof value === "string") {
      return Buffer.from(value, encoding as BufferEncoding);
    }

    return this.toBuffer(value);
  }

  protected ensureBufferLength(buffer: Buffer, expectedLength: number, argName: string): void {
    if (buffer.length !== expectedLength) {
      throw this.throwErrorFormatters(
        new Error(`${argName} must be ${expectedLength} bytes, got: ${buffer.length} bytes`)
      );
    }
  }

  protected getAlgorithmKeyLength(algorithm: string): number {
    const match = algorithm.match(/aes-(\d+)/);
    if (match && match[1]) {
      return parseInt(match[1], 10) / 8;
    }
    return 32;
  }

  call() {
    throw new Error("Call method must be implemented in derived class");
  }
}

class Md5 extends CryptoMethodBuilder {
  override call() {
    const [data, encoding = "hex"] = this.args;
    this.validateBuffer(data, "data");
    if (encoding !== undefined) {
      this.validateEncoding(encoding);
    }

    return crypto.createHash("md5").update(this.toBuffer(data)).digest(encoding as crypto.BinaryToTextEncoding);
  }
}

class Sha1 extends CryptoMethodBuilder {
  override call() {
    const [data, encoding = "hex"] = this.args;
    this.validateBuffer(data, "data");
    if (encoding !== undefined) {
      this.validateEncoding(encoding);
    }

    return crypto.createHash("sha1").update(this.toBuffer(data)).digest(encoding as crypto.BinaryToTextEncoding);
  }
}

class Sha256 extends CryptoMethodBuilder {
  override call() {
    const [data, encoding = "hex"] = this.args;
    this.validateBuffer(data, "data");
    if (encoding !== undefined) {
      this.validateEncoding(encoding);
    }

    return crypto.createHash("sha256").update(this.toBuffer(data)).digest(encoding as crypto.BinaryToTextEncoding);
  }
}

class Sha384 extends CryptoMethodBuilder {
  override call() {
    const [data, encoding = "hex"] = this.args;
    this.validateBuffer(data, "data");
    if (encoding !== undefined) {
      this.validateEncoding(encoding);
    }

    return crypto.createHash("sha384").update(this.toBuffer(data)).digest(encoding as crypto.BinaryToTextEncoding);
  }
}

class Sha512 extends CryptoMethodBuilder {
  override call() {
    const [data, encoding = "hex"] = this.args;
    this.validateBuffer(data, "data");
    if (encoding !== undefined) {
      this.validateEncoding(encoding);
    }

    return crypto.createHash("sha512").update(this.toBuffer(data)).digest(encoding as crypto.BinaryToTextEncoding);
  }
}

class Hash extends CryptoMethodBuilder {
  override call() {
    const [algorithm, data, encoding = "hex"] = this.args;
    this.validateString(algorithm, "algorithm");
    this.validateBuffer(data, "data");
    if (encoding !== undefined) {
      this.validateEncoding(encoding);
    }

    try {
      return crypto.createHash(algorithm).update(this.toBuffer(data)).digest(encoding as crypto.BinaryToTextEncoding);
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`Unsupported hash algorithm: ${algorithm}. Error: ${error.message}`));
    }
  }
}

/**
 * Hashing a file reads it, so it needs `--allow-read` exactly like `fs.readFile`, and it
 * reads without blocking: a large file no longer stops every other task.
 */
class HashFile extends CryptoMethodBuilder {
  override *call(): Gen<any> {
    const [filePath, algorithm = "sha256", encoding = "hex"] = this.args;
    this.validateString(filePath, "filePath");
    this.validateString(algorithm, "algorithm");
    if (encoding !== undefined) {
      this.validateEncoding(encoding);
    }

    this.checkPermission("read", filePath);

    // Read in pieces and feed each one to the hash. Reading the whole file would make
    // hashing a large one impossible under a memory limit - which is the main reason to
    // hash a file by path rather than by value in the first place.
    let handle: fsp.FileHandle;

    try {
      handle = yield hostAwait(fsp.open(filePath, "r"));
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`File not found: ${filePath}`));
    }

    const digest = crypto.createHash(algorithm);
    const buffer = Buffer.alloc(64 * 1024);

    try {
      for (;;) {
        const { bytesRead } = yield hostAwait(
          handle.read(buffer, 0, buffer.length, null),
        );

        if (bytesRead === 0) break;

        digest.update(buffer.subarray(0, bytesRead));
      }
    } catch (error: any) {
      throw this.throwErrorFormatters(
        new Error(`cannot read "${filePath}": ${error?.message ?? error}`),
      );
    } finally {
      yield hostAwait(handle.close());
    }

    return digest.digest(encoding as crypto.BinaryToTextEncoding);
  }
}

class HmacMd5 extends CryptoMethodBuilder {
  override call() {
    const [data, key, encoding = "hex"] = this.args;
    this.validateBuffer(data, "data");
    this.validateBuffer(key, "key");
    if (encoding !== undefined) {
      this.validateEncoding(encoding);
    }

    return crypto.createHmac("md5", this.toBuffer(key)).update(this.toBuffer(data)).digest(encoding as crypto.BinaryToTextEncoding);
  }
}

class HmacSha256 extends CryptoMethodBuilder {
  override call() {
    const [data, key, encoding = "hex"] = this.args;
    this.validateBuffer(data, "data");
    this.validateBuffer(key, "key");
    if (encoding !== undefined) {
      this.validateEncoding(encoding);
    }

    return crypto.createHmac("sha256", this.toBuffer(key)).update(this.toBuffer(data)).digest(encoding as crypto.BinaryToTextEncoding);
  }
}

class HmacSha512 extends CryptoMethodBuilder {
  override call() {
    const [data, key, encoding = "hex"] = this.args;
    this.validateBuffer(data, "data");
    this.validateBuffer(key, "key");
    if (encoding !== undefined) {
      this.validateEncoding(encoding);
    }

    return crypto.createHmac("sha512", this.toBuffer(key)).update(this.toBuffer(data)).digest(encoding as crypto.BinaryToTextEncoding);
  }
}

class Hmac extends CryptoMethodBuilder {
  override call() {
    const [algorithm, data, key, encoding = "hex"] = this.args;
    this.validateString(algorithm, "algorithm");
    this.validateBuffer(data, "data");
    this.validateBuffer(key, "key");
    if (encoding !== undefined) {
      this.validateEncoding(encoding);
    }

    try {
      return crypto.createHmac(algorithm, this.toBuffer(key)).update(this.toBuffer(data)).digest(encoding as crypto.BinaryToTextEncoding);
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`HMAC error: ${error.message}`));
    }
  }
}

class Base64Encode extends CryptoMethodBuilder {
  override call() {
    const [data, urlSafe = false] = this.args;
    this.validateBuffer(data, "data");

    const encoded = this.toBuffer(data).toString("base64");
    
    if (urlSafe) {
      return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    }
    
    return encoded;
  }
}

class Base64Decode extends CryptoMethodBuilder {
  override call() {
    const [data, urlSafe = false] = this.args;
    this.validateString(data, "data");

    let normalized = data;
    if (urlSafe) {
      normalized = data.replace(/-/g, "+").replace(/_/g, "/");
      while (normalized.length % 4) {
        normalized += "=";
      }
    }

    try {
      // `bytes`, not text. Decoding to a UTF-8 string destroyed any byte that is not
      // valid UTF-8: a key, a certificate or an image came back with every such byte
      // replaced by U+FFFD, which is three bytes, so five bytes could return as eleven.
      // Anyone who wanted text calls `.toString()` on the result.
      return this.toBytes(Buffer.from(normalized, "base64"));
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`Base64 decode error: ${error.message}`));
    }
  }
}

class HexEncode extends CryptoMethodBuilder {
  override call() {
    const [data] = this.args;
    this.validateBuffer(data, "data");

    return this.toBuffer(data).toString("hex");
  }
}

class HexDecode extends CryptoMethodBuilder {
  override call() {
    const [data] = this.args;
    this.validateString(data, "data");

    try {
      // `bytes`, for the same reason as base64Decode above; `binary.fromHex` already
      // worked this way, so the two libraries now agree.
      return this.toBytes(Buffer.from(data, "hex"));
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`Hex decode error: ${error.message}`));
    }
  }
}

class UrlEncode extends CryptoMethodBuilder {
  override call() {
    const [data] = this.args;
    this.validateString(data, "data");

    return encodeURIComponent(data);
  }
}

class UrlDecode extends CryptoMethodBuilder {
  override call() {
    const [data] = this.args;
    this.validateString(data, "data");

    try {
      return decodeURIComponent(data);
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`URL decode error: ${error.message}`));
    }
  }
}

class RandomBytes extends CryptoMethodBuilder {
  override call() {
    const [size, encoding] = this.args;
    this.validateNumber(size, "size");
    this.validatePositive(size, "size");

    if (encoding !== undefined && encoding !== null) {
      this.validateEncoding(encoding);
    }

    const buffer = crypto.randomBytes(size);
    return encoding ? buffer.toString(encoding as BufferEncoding) : this.wrapBytes(buffer);
  }
}

class RandomInt extends CryptoMethodBuilder {
  override call() {
    const [min, max] = this.args;

    if (max === undefined) {
      this.validateNumber(min, "max");
      this.validatePositive(min, "max");
      return crypto.randomInt(min);
    }

    this.validateNumber(min, "min");
    this.validateNumber(max, "max");

    if (min >= max) {
      throw this.throwErrorFormatters(new Error(`min must be less than max. Got min: ${min}, max: ${max}`));
    }

    return crypto.randomInt(min, max);
  }
}

class RandomUUID extends CryptoMethodBuilder {
  override call() {
    return crypto.randomUUID();
  }
}

class RandomString extends CryptoMethodBuilder {
  override call() {
    const [length = 32, charset = "alphanumeric"] = this.args;
    this.validateNumber(length, "length");
    this.validatePositive(length, "length");
    this.validateString(charset, "charset");

    const charsets: Record<string, string> = {
      numeric: "0123456789",
      alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
      alphanumeric: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
      hex: "0123456789abcdef",
      base64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    };

    const chars = charsets[charset] || charset;
    const bytes = crypto.randomBytes(length);
    
    let result = "";
    for (let i = 0; i < length; i++) {
      const byte = bytes[i];
      if (byte !== undefined) {
        result += chars[byte % chars.length];
      }
    }

    return result;
  }
}

class RandomPassword extends CryptoMethodBuilder {
  override call() {
    const [length = 16, options = {}] = this.args;
    this.validateNumber(length, "length");
    this.validatePositive(length, "length");

    const opts = options as PasswordOptions;
    const {
      numbers = true,
      lowercase = true,
      uppercase = true,
      symbols = true,
      excludeSimilar = true,
      exclude = "",
    } = opts;

    let chars = "";
    if (lowercase) chars += "abcdefghijklmnopqrstuvwxyz";
    if (uppercase) chars += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (numbers) chars += "0123456789";
    if (symbols) chars += "!@#$%^&*()_+-=[]{}|;:,.<>?";

    if (excludeSimilar) {
      chars = chars.replace(/[ilLI|`oO0]/g, "");
    }

    if (exclude) {
      for (const char of exclude) {
        chars = chars.replace(new RegExp(char, "g"), "");
      }
    }

    if (chars.length === 0) {
      throw this.throwErrorFormatters(new Error("No characters available for password generation"));
    }

    const bytes = crypto.randomBytes(length * 2);
    let result = "";
    
    for (let i = 0; i < length; i++) {
      const byte = bytes[i];
      if (byte !== undefined) {
        result += chars[byte % chars.length];
      }
    }

    return result;
  }
}

class AesEncrypt extends CryptoMethodBuilder {
  override call() {
    const [data, key, options = {}] = this.args;
    this.validateBuffer(data, "data");
    this.validateBuffer(key, "key");
    this.validateObject(options, "options");

    const opts = options as EncryptOptions;
    const {
      algorithm = "aes-256-gcm",
      iv = null,
      encoding = "hex",
      outputFormat = "string",
    } = opts;

    this.validateString(algorithm, "algorithm");

    const keyBuffer = this.toBuffer(key);
    const keyLength = this.getAlgorithmKeyLength(algorithm);

    let actualKey: Buffer;
    if (keyBuffer.length === keyLength) {
      actualKey = keyBuffer;
    } else if (keyBuffer.length < keyLength) {
      actualKey = crypto.createHash("sha256").update(keyBuffer).digest().slice(0, keyLength);
    } else {
      actualKey = keyBuffer.slice(0, keyLength);
    }

    let ivBuffer: Buffer;
    if (iv) {
      ivBuffer = this.decodeBinary(iv, encoding);
    } else {
      ivBuffer = crypto.randomBytes(16);
    }

    try {
      const cipher = crypto.createCipheriv(algorithm, actualKey, ivBuffer);
      
      let encrypted = cipher.update(this.toBuffer(data), undefined, encoding as crypto.BinaryToTextEncoding);
      encrypted += cipher.final(encoding as crypto.BinaryToTextEncoding);

      if (outputFormat === "object") {
        const result: EncryptionResult = {
          encrypted,
          iv: ivBuffer.toString(encoding as BufferEncoding),
          algorithm,
        };

        if (algorithm.includes("gcm")) {
          result.authTag = (cipher as any).getAuthTag().toString(encoding as BufferEncoding);
        }

        return result;
      }

      return encrypted;
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`Encryption error: ${error.message}`));
    }
  }
}

class AesDecrypt extends CryptoMethodBuilder {
  override call() {
    const [encryptedData, key, options = {}] = this.args;
    this.validateBuffer(key, "key");
    this.validateObject(options, "options");

    const opts = options as DecryptOptions;
    const {
      algorithm = "aes-256-gcm",
      iv,
      authTag,
      encoding = "hex",
    } = opts;

    if (!iv) {
      throw this.throwErrorFormatters(new Error("IV is required for decryption"));
    }

    this.validateString(algorithm, "algorithm");

    const keyBuffer = this.toBuffer(key);
    const keyLength = this.getAlgorithmKeyLength(algorithm);

    let actualKey: Buffer;
    if (keyBuffer.length === keyLength) {
      actualKey = keyBuffer;
    } else if (keyBuffer.length < keyLength) {
      actualKey = crypto.createHash("sha256").update(keyBuffer).digest().slice(0, keyLength);
    } else {
      actualKey = keyBuffer.slice(0, keyLength);
    }

    const ivBuffer = this.decodeBinary(iv, encoding);

    try {
      const decipher = crypto.createDecipheriv(algorithm, actualKey, ivBuffer);

      if (algorithm.includes("gcm")) {
        if (!authTag) {
          throw this.throwErrorFormatters(new Error("Auth tag is required for GCM mode decryption"));
        }
        (decipher as any).setAuthTag(this.decodeBinary(authTag, encoding));
      }

      let decrypted = decipher.update(encryptedData, encoding as crypto.BinaryToTextEncoding, "utf-8");
      decrypted += decipher.final("utf-8");

      return decrypted;
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`Decryption error: ${error.message}`));
    }
  }
}

class Encrypt extends CryptoMethodBuilder {
  override *call(): Gen<any> {
    const [data, password, options = {}] = this.args;
    this.validateBuffer(data, "data");
    this.validateBuffer(password, "password");

    const salt = crypto.randomBytes(32);
    const key = yield this.pbkdf2(this.toBuffer(password), salt, 100000, 32, "sha256");
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(this.toBuffer(data)), cipher.final()]);
    const authTag = (cipher as any).getAuthTag();

    const result = Buffer.concat([salt, iv, authTag, encrypted]);

    return (options as any).encoding ? result.toString((options as any).encoding as BufferEncoding) : this.wrapBytes(result);
  }
}

class Decrypt extends CryptoMethodBuilder {
  override *call(): Gen<any> {
    const [encryptedData, password, options = {}] = this.args;
    this.validateBuffer(encryptedData, "encryptedData");
    this.validateBuffer(password, "password");

    const buffer = this.toBuffer(encryptedData, (options as any).encoding);

    const salt = buffer.slice(0, 32);
    const iv = buffer.slice(32, 48);
    const authTag = buffer.slice(48, 64);
    const encrypted = buffer.slice(64);

    const key = yield this.pbkdf2(this.toBuffer(password), salt, 100000, 32, "sha256");

    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      (decipher as any).setAuthTag(authTag);

      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

      // `bytes`. Returning text meant encrypting binary and decrypting it did not give
      // the binary back - the invalid UTF-8 was replaced on the way out, silently. Text
      // round trips the same as before through `.toString()`.
      return this.toBytes(decrypted);
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`Decryption failed: ${error.message}`));
    }
  }
}

class TimingSafeEqual extends CryptoMethodBuilder {
  override call() {
    const [a, b] = this.args;
    this.validateBuffer(a, "a");
    this.validateBuffer(b, "b");

    const bufferA = this.toBuffer(a);
    const bufferB = this.toBuffer(b);

    if (bufferA.length !== bufferB.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(bufferA, bufferB);
    } catch (error) {
      return false;
    }
  }
}

class ConstantTimeCompare extends CryptoMethodBuilder {
  override call() {
    const [a, b] = this.args;
    this.validateString(a, "a");
    this.validateString(b, "b");

    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);

    if (bufferA.length !== bufferB.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(bufferA, bufferB);
    } catch (error) {
      return false;
    }
  }
}

class Pbkdf2 extends CryptoMethodBuilder {
  override *call(): Gen<any> {
    const [password, salt, iterations, keylen, digest = "sha256", encoding = "hex"] = this.args;
    this.validateBuffer(password, "password");
    this.validateBuffer(salt, "salt");
    this.validateNumber(iterations, "iterations");
    this.validateNumber(keylen, "keylen");
    this.validateString(digest, "digest");
    this.validatePositive(iterations, "iterations");
    this.validatePositive(keylen, "keylen");

    try {
      const derived = yield this.pbkdf2(
        this.toBuffer(password),
        this.toBuffer(salt),
        iterations,
        keylen,
        digest,
      );

      return encoding ? derived.toString(encoding as BufferEncoding) : this.wrapBytes(derived);
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`PBKDF2 error: ${error.message}`));
    }
  }
}

class Scrypt extends CryptoMethodBuilder {
  override *call(): Gen<any> {
    const [password, salt, keylen, options = {}, encoding = "hex"] = this.args;
    this.validateBuffer(password, "password");
    this.validateBuffer(salt, "salt");
    this.validateNumber(keylen, "keylen");
    this.validatePositive(keylen, "keylen");

    try {
      const derived = yield this.scrypt(
        this.toBuffer(password),
        this.toBuffer(salt),
        keylen,
        options,
      );

      return encoding ? derived.toString(encoding as BufferEncoding) : this.wrapBytes(derived);
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`Scrypt error: ${error.message}`));
    }
  }
}

class Hkdf extends CryptoMethodBuilder {
  override *call(): Gen<any> {
    const [hash, ikm, salt, info, keylen, encoding = "hex"] = this.args;
    this.validateString(hash, "hash");
    this.validateBuffer(ikm, "ikm");
    this.validateNumber(keylen, "keylen");
    this.validatePositive(keylen, "keylen");

    try {
      const derived = yield this.hkdf(
        hash,
        this.toBuffer(ikm),
        salt ? this.toBuffer(salt) : Buffer.alloc(0),
        info ? this.toBuffer(info) : Buffer.alloc(0),
        keylen,
      );

      // `hkdfSync` yields an ArrayBuffer: convert it, then encode it
      const okm = Buffer.from(derived);
      return encoding ? okm.toString(encoding as BufferEncoding) : this.wrapBytes(okm);
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`HKDF error: ${error.message}`));
    }
  }
}

class DeriveKey extends CryptoMethodBuilder {
  override *call(): Gen<any> {
    const [password, salt = null, options = {}] = this.args;
    this.validateBuffer(password, "password");

    const opts = options as DeriveKeyOptions;
    const {
      iterations = 100000,
      keyLength = 32,
      algorithm = "sha256",
      encoding = "hex",
    } = opts;

    const saltBuffer = salt ? this.toBuffer(salt) : crypto.randomBytes(32);
    
    const key = yield this.pbkdf2(
      this.toBuffer(password),
      saltBuffer,
      iterations,
      keyLength,
      algorithm,
    );

    return {
      key: key.toString(encoding as BufferEncoding),
      salt: saltBuffer.toString(encoding as BufferEncoding),
      iterations,
      algorithm,
    };
  }
}

class Sign extends CryptoMethodBuilder {
  override call() {
    const [algorithm, data, privateKey, options = {}] = this.args;
    this.validateString(algorithm, "algorithm");
    this.validateBuffer(data, "data");
    this.validateBuffer(privateKey, "privateKey");

    const opts = options as SigningOptions;
    const { encoding = "hex", passphrase } = opts;

    try {
      const sign = crypto.createSign(algorithm);
      sign.update(this.toBuffer(data));

      const signOptions: any = {};
      if (passphrase) {
        signOptions.key = privateKey;
        signOptions.passphrase = passphrase;
      }

      const signature = sign.sign(passphrase ? signOptions : privateKey);
      return encoding ? signature.toString(encoding as BufferEncoding) : this.wrapBytes(signature);
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`Signing error: ${error.message}`));
    }
  }
}

class Verify extends CryptoMethodBuilder {
  override call() {
    const [algorithm, data, publicKey, signature, options = {}] = this.args;
    this.validateString(algorithm, "algorithm");
    this.validateBuffer(data, "data");
    this.validateBuffer(publicKey, "publicKey");

    const opts = options as SigningOptions;
    const { encoding = "hex" } = opts;

    try {
      const verify = crypto.createVerify(algorithm);
      verify.update(this.toBuffer(data));

      const sigBuffer = typeof signature === "string" 
        ? Buffer.from(signature, encoding as BufferEncoding)
        : this.toBuffer(signature);

      return verify.verify(publicKey, sigBuffer);
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`Verification error: ${error.message}`));
    }
  }
}

class GenerateKeyPair extends CryptoMethodBuilder {
  override *call(): Gen<any> {
    const [type = "rsa", options = {}] = this.args;
    this.validateString(type, "type");

    const {
      modulusLength,
      publicKeyEncoding = { type: "spki", format: "pem" },
      privateKeyEncoding = { type: "pkcs8", format: "pem" },
      ...rest
    } = options as any;

    const keyOptions: any = {
      ...rest,
      publicKeyEncoding,
      privateKeyEncoding,
    };

    // type specific defaults: a modulus size for RSA-like keys, a curve for EC
    if (type === "rsa" || type === "rsa-pss" || type === "dsa") {
      keyOptions.modulusLength = modulusLength ?? 2048;
    } else if (type === "ec" && keyOptions.namedCurve === undefined) {
      keyOptions.namedCurve = "P-256";
    }

    try {
      const { publicKey, privateKey } = yield fromCallback<{
        publicKey: any;
        privateKey: any;
      }>((done) => {
        crypto.generateKeyPair(
          type as any,
          keyOptions,
          (error, publicKey, privateKey) => {
            if (error) done(error);
            else done(null, { publicKey, privateKey });
          },
        );
      });

      return { publicKey, privateKey };
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`Key pair generation error: ${error.message}`));
    }
  }
}

class GetHashes extends CryptoMethodBuilder {
  override call() {
    return crypto.getHashes();
  }
}

class GetCiphers extends CryptoMethodBuilder {
  override call() {
    return crypto.getCiphers();
  }
}

class GetCurves extends CryptoMethodBuilder {
  override call() {
    return crypto.getCurves();
  }
}

class HashPassword extends CryptoMethodBuilder {
  override *call(): Gen<any> {
    const [password, options = {}] = this.args;
    this.validateBuffer(password, "password");

    const opts = options as HashPasswordOptions;
    const {
      saltRounds = 10,
      algorithm = "sha256",
    } = opts;

    const iterations = Math.pow(2, saltRounds);
    const salt = crypto.randomBytes(16);
    const hash = yield this.pbkdf2(
      this.toBuffer(password),
      salt,
      iterations,
      64,
      algorithm,
    );

    // the default algorithm keeps the short tag; any other one is named in the tag,
    // so that verifyPassword can recompute the hash with the same digest
    const tag = algorithm === "sha256" ? "pbkdf2" : `pbkdf2-${algorithm}`;

    return `$${tag}$${iterations}$${salt.toString("base64")}$${hash.toString("base64")}`;
  }
}

class VerifyPassword extends CryptoMethodBuilder {
  override *call(): Gen<any> {
    const [password, hash] = this.args;
    this.validateBuffer(password, "password");
    this.validateString(hash, "hash");

    try {
      const parts = hash.split("$");
      if (parts.length !== 5 || parts[0] !== "" || !parts[1]?.startsWith("pbkdf2")) {
        throw new Error("Invalid hash format");
      }

      const digest = parts[1] === "pbkdf2" ? "sha256" : parts[1].slice("pbkdf2-".length);

      const iterationsStr = parts[2];
      const saltStr = parts[3];
      const storedHash = parts[4];

      if (!iterationsStr || !saltStr || !storedHash) {
        throw new Error("Invalid hash format");
      }

      const iterations = parseInt(iterationsStr, 10);
      const salt = Buffer.from(saltStr, "base64");

      const computed = yield this.pbkdf2(
        this.toBuffer(password),
        salt,
        iterations,
        64,
        digest,
      );

      return crypto.timingSafeEqual(
        Buffer.from(storedHash, "base64"),
        computed
      );
    } catch (error: any) {
      throw this.throwErrorFormatters(new Error(`Password verification error: ${error.message}`));
    }
  }
}

class Crc32 extends CryptoMethodBuilder {
  override call() {
    const [data] = this.args;
    this.validateBuffer(data, "data");

    const buffer = this.toBuffer(data);
    let crc = 0xFFFFFFFF;

    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      if (byte !== undefined) {
        crc = crc ^ byte;
        for (let j = 0; j < 8; j++) {
          crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
        }
      }
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
}

module.exports = {
  md5: Md5,
  sha1: Sha1,
  sha256: Sha256,
  sha384: Sha384,
  sha512: Sha512,
  hash: Hash,
  hashFile: HashFile,

  hmacMd5: HmacMd5,
  hmacSha256: HmacSha256,
  hmacSha512: HmacSha512,
  hmac: Hmac,

  base64Encode: Base64Encode,
  base64Decode: Base64Decode,
  hexEncode: HexEncode,
  hexDecode: HexDecode,
  urlEncode: UrlEncode,
  urlDecode: UrlDecode,

  randomBytes: RandomBytes,
  randomInt: RandomInt,
  randomUUID: RandomUUID,
  randomString: RandomString,
  randomPassword: RandomPassword,

  aesEncrypt: AesEncrypt,
  aesDecrypt: AesDecrypt,
  encrypt: Encrypt,
  decrypt: Decrypt,

  timingSafeEqual: TimingSafeEqual,
  constantTimeCompare: ConstantTimeCompare,

  pbkdf2: Pbkdf2,
  scrypt: Scrypt,
  hkdf: Hkdf,
  deriveKey: DeriveKey,

  sign: Sign,
  verify: Verify,
  generateKeyPair: GenerateKeyPair,

  hashPassword: HashPassword,
  verifyPassword: VerifyPassword,

  crc32: Crc32,

  getHashes: GetHashes,
  getCiphers: GetCiphers,
  getCurves: GetCurves,
};