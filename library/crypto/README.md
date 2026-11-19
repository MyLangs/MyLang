# `crypto`

Hashing, HMAC, encryption, key derivation, signatures and random values.

```ml
import "core:crypto";
```

## Suspension

Most functions are pure computation and return immediately. The expensive ones — key
derivation, key generation, hashing a file — **suspend**, because they are deliberately
slow and a synchronous version would freeze every task in the program.

| Method | Suspends | Description |
| --- | --- | --- |
| `crypto.md5` / `sha1` / `sha256` / `sha384` / `sha512` | — | hash a value |
| `crypto.hash(algorithm, data, encoding)` | — | hash with any supported algorithm |
| `crypto.hashFile(path, algorithm, encoding)` | yes | hash a file, reading it in pieces |
| `crypto.hmac(algorithm, data, key)` | — | keyed hash |
| `crypto.hmacMd5` / `hmacSha256` / `hmacSha512` | — | the common ones |
| `crypto.crc32(data)` | — | checksum |
| `crypto.base64Encode(data)` | — | base64 text from binary or text |
| `crypto.base64Decode(text)` | — | **`bytes`** back; call `.toString()` for text |
| `crypto.hexEncode(data)` | — | hex text from binary or text |
| `crypto.hexDecode(text)` | — | **`bytes`** back; call `.toString()` for text |
| `crypto.urlEncode` / `urlDecode` | — | URL percent-encoding, text both ways |
| `crypto.randomBytes(n)` | — | cryptographically secure random bytes |
| `crypto.randomInt(min, max)` | — | a random integer |
| `crypto.randomUUID()` | — | a version 4 UUID |
| `crypto.randomString(length, alphabet)` | — | a random string |
| `crypto.randomPassword(length, options)` | — | a random password |
| `crypto.aesEncrypt` / `aesDecrypt` | — | AES with a key you supply |
| `crypto.encrypt(data, password)` | **yes** | AES-256-GCM with a derived key |
| `crypto.decrypt(data, password)` | **yes** | the matching unpack; gives **`bytes`** |
| `crypto.pbkdf2(password, salt, iterations, keylen, digest)` | **yes** | key derivation |
| `crypto.scrypt(password, salt, keylen, options)` | **yes** | key derivation |
| `crypto.hkdf(hash, ikm, salt, info, keylen)` | **yes** | key derivation |
| `crypto.deriveKey(password, salt, options)` | **yes** | `{ key, salt, iterations, algorithm }` |
| `crypto.hashPassword(password, options)` | **yes** | a storable password hash |
| `crypto.verifyPassword(password, hash)` | **yes** | check one |
| `crypto.generateKeyPair(type, options)` | **yes** | a public/private key pair |
| `crypto.sign` / `crypto.verify` | — | signatures |
| `crypto.timingSafeEqual` / `constantTimeCompare` | — | comparison without a timing leak |
| `crypto.getHashes` / `getCiphers` / `getCurves` | — | what the host supports |

Because the slow ones suspend, hashing a batch of passwords overlaps instead of queueing:

```ml
var jobs = [];
for (var p in passwords) { jobs[length(jobs)] = spawn crypto.hashPassword(p); }
var hashes = wait.all(jobs);
```

## Permissions

`crypto.hashFile` reads a file, so it needs `--allow-read` exactly like `fs.readFile`. It
reads the file in pieces rather than all at once, so hashing a file far larger than the
memory limit works — which is the reason to hash by path rather than by value:

```ml
// a 20 GB image, hashed under --max-memory=64MB
coreio.print(crypto.hashFile("./disk.img", "sha256"));
```
Everything else works on values you already have and needs no permission.

## Examples

### Hashing

```ml
import "core:crypto";

coreio.print(crypto.sha256("hello"));
coreio.print(crypto.hash("sha512", fs.readFile("file.bin"), "hex"));
coreio.print(crypto.hashFile("large.iso", "sha256"));
```

### Storing a password

```ml
var stored = crypto.hashPassword(password);         // suspends; that is the point

// later
if (!crypto.verifyPassword(attempt, stored)) {
  throw "wrong password";
}
```

The hash carries its own salt and iteration count, so nothing else has to be stored.

### Encrypting with a password

```ml
var sealed = crypto.encrypt("the secret", "correct horse battery staple");
var back   = crypto.decrypt(sealed, "correct horse battery staple");

coreio.print(back.toString());        // `back` is bytes; this is the text
```

Salt, IV and authentication tag all travel inside the result.

### Signing

```ml
var keys = crypto.generateKeyPair("rsa", { modulusLength: 2048 });

var signature = crypto.sign("sha256", payload, keys.privateKey);

coreio.print(crypto.verify("sha256", payload, keys.publicKey, signature));
```

### Comparing secrets safely

```ml
if (crypto.timingSafeEqual(providedToken, expectedToken)) {
  grantAccess();
}
```

## Binary in, binary out

`base64Decode`, `hexDecode` and `decrypt` hand back `bytes`, not text. That matters because
they are usually given something that is not text at all — a key, a certificate, an image —
and a decoder that returned a UTF-8 string destroyed every byte that is not valid UTF-8,
replacing it with U+FFFD. Five bytes could come back as eleven, and encrypting binary then
decrypting it did not give the binary back.

Text still round trips; ask for it:

```ml
coreio.print(crypto.base64Decode(encoded).toString());
coreio.print(crypto.decrypt(sealed, password).toString());
```

`urlEncode` and `urlDecode` are percent-encoding for urls, which is text by nature, and
both stay text.

## Notes

- Input may be a string, a `bytes` value, a buffer or a byte array; hashes come back as
  text in the encoding you ask for (`"hex"` by default).
- `md5` and `sha1` are there for compatibility with existing formats; use `sha256` or
  better for anything new.
- Never compare secrets with `==` — a plain comparison leaks how much of the value matched
  through how long it took. `timingSafeEqual` does not.
