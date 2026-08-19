/**
 * Whether a failed send had already delivered the message.
 *
 * Sending a message and running the agent turn are one promise to callers, so a provider error, a rate
 * limit or any mid-stream failure rejects it long after the message reached the transcript. A caller that
 * reads that rejection as "not delivered" undoes work it should keep: the diff panel restored a review the
 * agent had already received, offering it for a second submission and reporting that it could not be sent.
 */
export class MessageDeliveredRunFailed extends Error {
  readonly cause: Error

  constructor(cause: Error) {
    super(cause.message)
    this.name = 'MessageDeliveredRunFailed'
    this.cause = cause
  }
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

  constructor(outcome: 'refused' | 'cancelled', message?: string) {
    super(message ?? DEFAULT_NOT_DELIVERED_MESSAGE)
    this.name = 'MessageNotDelivered'
    this.outcome = outcome
  }
}

const DEFAULT_NOT_DELIVERED_MESSAGE = 'The agent did not receive this message.'

/** Whether this failure is worth showing the user, as opposed to one they caused by stopping the run. */
export function isReportableSendFailure(error: unknown) {
  return !(error instanceof MessageNotDelivered) || error.outcome === 'refused'
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
  readonly cause: Error
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
