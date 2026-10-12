import { PI_SESSION_FILE_PROBLEM } from '@shared/domain/pi-session-file-messages'
import { SessionLifecyclePreparationError } from '../errors'

/** The code a client gets when a Session's Pi file cannot be used to copy it. */
export const PI_SESSION_FILE_UNUSABLE = 'pi_session_file_unusable'

const MAX_CAUSE_DEPTH = 4

/** The sentence a Session's Pi file problem says, from the failure or one of its causes. */
function piSessionFileProblem(failure: unknown, depth = 0): string | undefined {
  if (typeof failure !== 'object' || failure === null || depth > MAX_CAUSE_DEPTH) return undefined
  const message: unknown = Reflect.get(failure, 'message')
  const at = typeof message === 'string' ? message.indexOf(PI_SESSION_FILE_PROBLEM) : -1
  if (typeof message === 'string' && at >= 0) return message.slice(at)
  return piSessionFileProblem(Reflect.get(failure, 'cause'), depth + 1)
}

/**
 * A Session lifecycle preparation that failed. One refused because the Session's Pi file cannot
 * be used, as a fork of a Session whose file was deleted, carries a code a client acts on and the
 * sentence that says why, not an internal error.
 */
export function lifecyclePreparationError(operation: string, cause: unknown) {
  const problem = piSessionFileProblem(cause)
  return new SessionLifecyclePreparationError({
    operation,
    cause,
    ...(problem ? { code: PI_SESSION_FILE_UNUSABLE, message: problem } : {}),
  })
}
