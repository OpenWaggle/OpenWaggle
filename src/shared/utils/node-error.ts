/**
 * Type guards for Node.js filesystem errors.
 * Replaces local `isMissingError()` functions scattered across the codebase.
 */

export function isNodeError(err: unknown, code?: string): err is NodeJS.ErrnoException {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return false
  }
  if (code !== undefined) {
    return err.code === code
  }
  return true
}

export function isEnoent(err: unknown): err is NodeJS.ErrnoException {
  return isNodeError(err, 'ENOENT')
}

/** Extract a human-readable message from an unknown error value */
export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
