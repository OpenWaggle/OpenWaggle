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
