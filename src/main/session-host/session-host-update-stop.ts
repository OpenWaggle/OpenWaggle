import { LocalSessionClientProtocolError } from './local-session-client-protocol-error'

/** Time the Host takes from the end of its drain to exiting: flushes, runtime dispose, logs. */
export const SESSION_HOST_EXIT_BUDGET_MS = 7_000

/** A Host older than update stops rejects the `purpose` with `command_failed`. */
export function isRejectedUpdatePurpose(error: unknown): error is LocalSessionClientProtocolError {
  return error instanceof LocalSessionClientProtocolError && error.code === 'command_failed'
}
