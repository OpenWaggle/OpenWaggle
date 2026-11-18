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

/**
 * An error's `code`, own or inherited. Bun puts the code of some child-process errors (a
 * `maxBuffer` overflow) on the error's prototype, so decoding only own properties loses it.
 */
export function errorCode(error: unknown) {
  const result: unknown =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  return result
}

export function isEnoent(err: unknown): err is NodeJS.ErrnoException {
  return isNodeError(err, 'ENOENT')
}

/** Extract a human-readable message from an unknown error value */
export function formatErrorMessage(error: unknown) {
  const result: string = error instanceof Error ? error.message : String(error)
  return result
}
