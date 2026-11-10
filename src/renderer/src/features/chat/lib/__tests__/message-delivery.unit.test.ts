import { describe, expect, it } from 'vitest'
import {
  FirstSendFailed,
  isReportableSendFailure,
  MessageDeliveredRunFailed,
  MessageNotDelivered,
  sendFailureText,
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

  it('does not report a cancellation that arrives wrapped by a first send', () => {
    /*
     * A first send reports its failure as a `FirstSendFailed` carrying the session it created, so a
     * cancellation on that path arrives wrapped. Unrecognised, it told the user their own Stop had failed.
     */
    const cancelled = new FirstSendFailed(new MessageNotDelivered('cancelled'), 'session-a')
    const refused = new FirstSendFailed(
      new MessageNotDelivered('refused', 'no worktree'),
      'session-a',
    )

    expect(isReportableSendFailure(cancelled)).toBe(false)
    expect(isReportableSendFailure(refused)).toBe(true)
  })
})

// Retry, starter prompts and diff review toast it: a raw code told the person nothing.
describe('sendFailureText', () => {
  it('says why the Host refused a send in plain words, keeping the code', () => {
    const refusal = new MessageNotDelivered(
      'refused',
      'queue_capacity_reached',
      'queue_capacity_reached',
    )
    expect(sendFailureText(refusal)).toBe(
      'Not sent: this Session already has as many queued messages as it can hold (queue_capacity_reached).',
    )
  })

  it('says why a new Session’s first send was refused, under the caller’s lead', () => {
    const refusal = new MessageNotDelivered(
      'refused',
      'queue_capacity_reached',
      'queue_capacity_reached',
    )
    expect(
      sendFailureText(new FirstSendFailed(refusal, 'created'), { refused: 'Review not sent' }),
    ).toBe(
      'Review not sent: this Session already has as many queued messages as it can hold (queue_capacity_reached).',
    )
  })

  it('keeps any other failure’s own message', () => {
    expect(sendFailureText(new Error('Network down'))).toBe('Network down')
  })
})
