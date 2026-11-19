import { formatMessage } from "../utils";
import { BaseError } from "../BaseError";

enum PermissionCodeError {
  PermissionDenied = "PERMISSION_DENIED",
  MemoryLimitExceeded = "MEMORY_LIMIT_EXCEEDED",
  TimeLimitExceeded = "TIME_LIMIT_EXCEEDED",
  ResourceLimitExceeded = "RESOURCE_LIMIT_EXCEEDED",
  InvalidPermissionValue = "INVALID_PERMISSION_VALUE",
  IntegrityMismatch = "INTEGRITY_MISMATCH",
  IntegrityMissing = "INTEGRITY_MISSING",
}

const PermissionMessageError = {
  [PermissionCodeError.PermissionDenied]:
    'Permission denied: ${kind} access to "${target}". Run with --allow-${kind}${hint}',
  [PermissionCodeError.MemoryLimitExceeded]:
    "Memory limit exceeded: used ${used}, limit ${limit}",
  [PermissionCodeError.TimeLimitExceeded]: "Execution timed out after ${limit}",
  [PermissionCodeError.ResourceLimitExceeded]:
    "Too many ${noun}s: the limit is ${limit}. Raise it with ${flag}",
  [PermissionCodeError.InvalidPermissionValue]:
    'Invalid value for ${option}: "${value}" (${reason})',
  [PermissionCodeError.IntegrityMismatch]:
    "${url} does not match ${file}: expected ${expected}, received ${actual}. " +
    "The remote module changed; review it and update ${file} if the change is wanted",
  [PermissionCodeError.IntegrityMissing]:
    "${url} is not recorded in ${file} and this run is frozen. " +
    "Run once without --frozen to record ${actual}",
};

class PermissionError extends BaseError {
  constructor(code: PermissionCodeError, format?: Record<string, any>) {
    super(
      format
        ? formatMessage(PermissionMessageError[code], format)
        : PermissionMessageError[code],
      {
        code,
        name: "PermissionError",
        ...(format?.files && { files: format.files }),
      },
    );
  }
}

export { PermissionError, PermissionCodeError, PermissionMessageError };
