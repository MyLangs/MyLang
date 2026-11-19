import fsp from "node:fs/promises";
import tls from "node:tls";
import { HttpMethodBuilder } from "./HttpBuilder";
import { type Gen, hostAwait } from "../../../src/runtime/coroutine";

class HttpsCertificateManager extends HttpMethodBuilder {
  override call() {
    const certificates = new Map();

    return {
      // Loading a certificate reads two files, so it needs `--allow-read` like any
      // other read, and it does not block the program while it happens.
      loadCertificate: class extends HttpMethodBuilder {
        override *call(): Gen<any> {
          const [domain, certPath, keyPath] = this.args;

          this.assertString(certPath, "certPath");
          this.assertString(keyPath, "keyPath");
          this.checkPermission("read", certPath);
          this.checkPermission("read", keyPath);

          try {
            const cert = yield hostAwait(fsp.readFile(certPath));
            const key = yield hostAwait(fsp.readFile(keyPath));

            certificates.set(domain, { cert, key });
            return true;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            throw this.throwErrorFormatters(
              new Error(`Failed to load certificate: ${errorMessage}`),
            );
          }
        }
      },

      getCertificate: class extends HttpMethodBuilder {
        override call() {
          const [domain] = this.args;
          return certificates.get(domain) || null;
        }
      },

      createSecureContext: class extends HttpMethodBuilder {
        override call() {
          const [domain] = this.args;
          const certData = certificates.get(domain);

          if (!certData) {
            throw this.throwErrorFormatters(
              new Error(`No certificate found for domain: ${domain}`),
            );
          }

          return tls.createSecureContext({
            cert: certData.cert,
            key: certData.key,
          });
        }
      },
    };
  }
}

export { HttpsCertificateManager };
