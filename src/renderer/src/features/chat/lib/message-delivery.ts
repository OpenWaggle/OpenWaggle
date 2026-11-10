import { classifyErrorMessage } from '@shared/types/errors'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'

/**
 * Whether a failed send had already delivered the message.
 *
 * Sending a message and running the agent turn are one promise to callers, so a provider error, a rate
 * limit or any mid-stream failure rejects it long after the message reached the transcript. A caller that
 * reads that rejection as "not delivered" undoes work it should keep: the diff panel restored a review the
 * agent had already received, offering it for a second submission and reporting that it could not be sent.
 */
export class MessageDeliveredRunFailed extends Error {
  override readonly cause: Error

  constructor(cause: Error) {
    super(cause.message)
    this.name = 'MessageDeliveredRunFailed'
    this.cause = cause
  }
}

/**
 * Whether a Run was refused before the agent got its message because the Session's Pi file
 * cannot be used: deleted, or its folder missing. The Session's notice says why, so the refusal
 * is not shown again as a Run failure, and the message was never delivered.
 */
export function isPiSessionFileRefusal(error: { readonly message: string }) {
  return classifyErrorMessage(error.message).code === 'pi-session-file-deleted'
}

/** True when the message reached the agent and only the run that followed failed. */
export function wasMessageDelivered(error: unknown) {
  return error instanceof MessageDeliveredRunFailed
}

/**
 * A send whose message never reached the agent.
 *
 * Two consumers want different things from this, which is why it carries the outcome rather than being two
 * error types. Work the user submitted must be kept in both cases - a review is restored - but only a refusal
 * is worth reporting as a failure: a cancellation is the user's own Stop, and telling them their turn "could
 * not start" is noise about something they asked for.
 */
export class MessageNotDelivered extends Error {
  readonly outcome: 'refused' | 'cancelled'
  /** The Host's refusal code, when it gave one (`queue_capacity_reached`, ...). */
  readonly code: string | undefined

  constructor(outcome: 'refused' | 'cancelled', message?: string, code?: string) {
    super(message ?? DEFAULT_NOT_DELIVERED_MESSAGE)
    this.name = 'MessageNotDelivered'
    this.outcome = outcome
    this.code = code
  }
}

export const DEFAULT_NOT_DELIVERED_MESSAGE = 'The agent did not receive this message.'

/**
 * A send whose call to the main process failed before any Run while another send's Run owned the
 * Session's status (a later send, or an earlier one still settling), so no error of the Session's
 * shows it. Not a refusal: the caller says why in a toast and logs it as the failure it is. The
 * message drops Electron's transport prefix.
 */
export class SendFailedOutOfView extends Error {
  override readonly cause: Error

  constructor(cause: Error) {
    super(ipcErrorMessage(cause))
    this.name = 'SendFailedOutOfView'
    this.cause = cause
  }
}

/** Whether this failure is worth showing the user, as opposed to one they caused by stopping the run. */
export function isReportableSendFailure(error: unknown) {
  /*
   * Unwrapped first, because a first send reports its failure as a `FirstSendFailed` carrying the session it
   * created - so a cancellation on that path arrived here wrapped, was not recognised, and the user was told
   * their own Stop had failed to send.
   */
  const cause = error instanceof FirstSendFailed ? error.cause : error
  return !(cause instanceof MessageNotDelivered) || cause.outcome === 'refused'
}

/**
 * A first send that failed, naming the session it created.
 *
 * Work submitted before a session exists is filed under the working path, and the session that is created to
 * carry it changes where the panel looks. Inferring the new location from what the panel happens to show when
 * the failure lands got it wrong twice: the scope selection resets for a brand-new session key, and in local
 * mode every session of a project shares one working path, so the review could land in a different session's
 * conversation. The session id is known here, so it is carried rather than guessed.
 */
export class FirstSendFailed extends Error {
  override readonly cause: Error
  readonly createdSessionId: string

  constructor(cause: Error, createdSessionId: string) {
    super(cause.message)
    this.name = 'FirstSendFailed'
    this.cause = cause
    this.createdSessionId = createdSessionId
  }
}

/** The session a failed first send created, or null when the failure was not a first send. */
export function createdSessionIdOf(error: unknown) {
  return error instanceof FirstSendFailed ? error.createdSessionId : null
}

/** What the Session Host's refusal codes a person's send can still meet mean, in plain words. */
const REFUSAL_REASONS = new Map([
  ['queue_capacity_reached', 'this Session already has as many queued messages as it can hold'],
  ['queue_byte_capacity_reached', 'this Session’s queued messages are already as large as allowed'],
  ['follow_up_reserved', 'a steered message is still being delivered to the running agent'],
])

/**
 * What a refused send says: the Host's own words when it wrote some, else what its code means.
 * The code is kept for support.
 */
export function refusalSummary(refusal: MessageNotDelivered, lead = 'Not sent') {
  const { code, message } = refusal
  const readable = message !== DEFAULT_NOT_DELIVERED_MESSAGE && message !== code
  const written = readable
    ? midSentence(message.endsWith('.') ? message.slice(0, -1) : message)
    : undefined
  const reason = written ?? (code ? REFUSAL_REASONS.get(code) : undefined)
  if (reason) return code ? `${lead}: ${reason} (${code}).` : `${lead}: ${reason}.`
  return code ? `${lead}: the Session Host refused it (${code}).` : `${lead}.`
}

/** A sentence the Host wrote, to follow a colon: its capital goes, unless it starts an acronym. */
function midSentence(sentence: string) {
  const [first = '', second = ''] = sentence
  return second === second.toLowerCase() ? first.toLowerCase() + sentence.slice(1) : sentence
}

/** The refusal behind a send that failed, a first send's too, or undefined. */
export function sendRefusalOf(error: unknown) {
  const cause = error instanceof FirstSendFailed ? error.cause : error
  return cause instanceof MessageNotDelivered && cause.outcome === 'refused' ? cause : undefined
}

/**
 * A send failure in words for a toast: a refusal says why after `leads.refused`, anything else
 * gives its own message after `leads.failed` when there is one.
 */
export function sendFailureText(
  error: unknown,
  leads: { readonly refused?: string; readonly failed?: string } = {},
) {
  const refusal = sendRefusalOf(error)
  if (refusal) return refusalSummary(refusal, leads.refused)
  const cause = error instanceof FirstSendFailed ? error.cause : error
  const message = cause instanceof Error ? cause.message : String(cause)
  // A failure no Session error shows needs saying that the message did not go.
  const failed =
    leads.failed ?? (cause instanceof SendFailedOutOfView ? 'Could not send' : undefined)
  return failed ? `${failed}: ${message}` : message
}
