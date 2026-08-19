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

/**
 * Sessions whose agent has reported a turn started since the last send.
 *
 * The evidence for "delivered" cannot be the invoke resolving: main recovers every run failure into a value
 * and resolves, including a refusal raised before the message is recorded - a session whose worktree has gone
 * is exactly that - so a resolved send says nothing. The agent reporting the turn started does say it, and it
 * is the only such signal the renderer has. Held here rather than threaded as a ref because the two places
 * that need it, the run controls and the stream-event handler, share nothing else.
 */
const runStartedSessions = new Set<string>()

/** Called when a send begins: no evidence of delivery yet. */
export function clearRunStarted(sessionId: string) {
  runStartedSessions.delete(sessionId)
}

/** Called when the agent reports the turn started, i.e. it has the message. */
export function markRunStarted(sessionId: string) {
  runStartedSessions.add(sessionId)
}

/** Whether the agent reported a turn started since this session's send began. */
export function hasRunStarted(sessionId: string) {
  return runStartedSessions.has(sessionId)
}

/** True when the message reached the agent and only the run that followed failed. */
export function wasMessageDelivered(error: unknown) {
  return error instanceof MessageDeliveredRunFailed
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
