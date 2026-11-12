import { isRecord } from '@shared/utils/validation'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'

/** How `assertSessionDeletable` words a refusal. */
const REFUSAL_PREFIX = 'Session deletion was refused because '
/** How deep a cause chain is searched for the SQLite error under it. */
const MAX_CAUSE_DEPTH = 4

/** Whether a trial delete failed on a constraint, not on the database being busy or broken. */
function brokeConstraint(cause: unknown) {
  let current: unknown = cause
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
    const code = isRecord(current) ? current.code : undefined
    if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) return true
    current = isRecord(current) ? current.cause : undefined
  }
  return false
}

/** The refusal `error` words, when it is one: a trial delete's only when a constraint held. */
function refusalOf(error: unknown) {
  if (!(error instanceof Error) || !error.message.startsWith(REFUSAL_PREFIX)) return undefined
  if (error.cause !== undefined && !brokeConstraint(error.cause)) return undefined
  return error.message
}

/**
 * The refusal a deletion check ended with: what it threw because something depends on the
 * Session, or undefined when the Session can be deleted. Anything else, an interruption or a
 * query that failed, is no refusal: it goes on as a failure, which the next pass retries.
 */
export function deletionRefusalOf(exit: Exit.Exit<unknown, unknown>) {
  if (Exit.isSuccess(exit)) return Effect.succeed(undefined)
  const refusal = Cause.isInterrupted(exit.cause) ? undefined : refusalOf(Cause.squash(exit.cause))
  return refusal === undefined ? Effect.failCause(exit.cause) : Effect.succeed(refusal)
}
