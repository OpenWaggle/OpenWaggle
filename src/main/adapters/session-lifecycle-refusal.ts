import { PI_SESSION_FILE_PROBLEM } from '@shared/domain/pi-session-file-messages'
import { SessionLifecyclePreparationError } from '../errors'
import { SESSION_WORKTREE_MISSING_MESSAGE } from './pi/agent-kernel/session-worktree-missing'

/** The code a client gets when a Session's Pi file cannot be used to copy it. */
export const PI_SESSION_FILE_UNUSABLE = 'pi_session_file_unusable'

/** The code a client gets when a worktree Session's worktree is gone. */
export const SESSION_WORKTREE_MISSING = 'session_worktree_missing'

/** Refusals the user can fix, by what their sentence starts with. */
const REFUSALS = [
  { code: PI_SESSION_FILE_UNUSABLE, sentence: PI_SESSION_FILE_PROBLEM },
  { code: SESSION_WORKTREE_MISSING, sentence: SESSION_WORKTREE_MISSING_MESSAGE },
] as const

const MAX_CAUSE_DEPTH = 4

/** A refusal the user can fix, with its sentence, from the failure or one of its causes. */
function refusalOf(
  failure: unknown,
  depth = 0,
): { readonly code: string; readonly message: string } | undefined {
  if (typeof failure !== 'object' || failure === null || depth > MAX_CAUSE_DEPTH) return undefined
  const message: unknown = Reflect.get(failure, 'message')
  for (const refusal of REFUSALS) {
    const at = typeof message === 'string' ? message.indexOf(refusal.sentence) : -1
    if (typeof message === 'string' && at >= 0) {
      return { code: refusal.code, message: message.slice(at) }
    }
  }
  return refusalOf(Reflect.get(failure, 'cause'), depth + 1)
}

/**
 * A Session lifecycle preparation that failed. One refused for a reason the user can fix, as a
 * fork of a Session whose Pi file was deleted or whose worktree is gone, carries a code a client
 * acts on and the sentence that says why, not an internal error.
 */
export function lifecyclePreparationError(operation: string, cause: unknown) {
  return new SessionLifecyclePreparationError({ operation, cause, ...refusalOf(cause) })
}
