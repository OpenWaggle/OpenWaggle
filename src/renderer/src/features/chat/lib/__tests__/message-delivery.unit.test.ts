import { describe, expect, it } from 'vitest'
import {
  isReportableSendFailure,
  MessageDeliveredRunFailed,
  MessageNotDelivered,
  wasMessageDelivered,
} from '../message-delivery'

/**
 * Whether a failed send delivered its message decides whether a submitted review is restored, so getting it
 * wrong either loses the reviewer's work or offers the agent's own copy back for a second submission.
 */
describe('message delivery reporting', () => {
  it('recognises only a run that failed after delivery', () => {
    const cause = new Error('provider rate limit')

    expect(wasMessageDelivered(new MessageDeliveredRunFailed(cause))).toBe(true)
    expect(wasMessageDelivered(cause)).toBe(false)
    expect(new MessageDeliveredRunFailed(cause).message).toBe('provider rate limit')
  })

  it('reports a refusal to the user but not their own cancellation', () => {
    /*
     * Work the user submitted is kept in both cases - a review is restored - but only a refusal is worth
     * reporting: a cancellation is their own Stop, and telling them the turn "could not start" is noise about
     * something they asked for.
     */
    expect(isReportableSendFailure(new MessageNotDelivered('refused', 'no worktree'))).toBe(true)
    expect(isReportableSendFailure(new MessageNotDelivered('cancelled'))).toBe(false)
    // Anything else is an ordinary failure and is reported.
    expect(isReportableSendFailure(new Error('boom'))).toBe(true)
  })
})
