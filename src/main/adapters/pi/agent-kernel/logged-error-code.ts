import { errorCode } from '@shared/utils/node-error'

/** A filesystem error's `code` for a log line, or `unknown` when it has none. */
export function loggedErrorCode(error: unknown): string {
  const code = errorCode(error)
  return typeof code === 'string' ? code : 'unknown'
}
