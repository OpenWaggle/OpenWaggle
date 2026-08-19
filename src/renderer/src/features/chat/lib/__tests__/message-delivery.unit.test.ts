import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRunStarted,
  hasRunStarted,
  MessageDeliveredRunFailed,
  markRunStarted,
  wasMessageDelivered,
} from '../message-delivery'

/**
 * Whether a failed send delivered its message decides whether a submitted review is restored, so getting it
 * wrong either loses the reviewer's work or offers the agent's own copy back for a second submission.
 */
describe('message delivery evidence', () => {
  beforeEach(() => {
    clearRunStarted('session-1')
    clearRunStarted('session-2')
  })

  it('reports no delivery until the agent starts the turn', () => {
    /*
     * The evidence cannot be the invoke resolving. Main recovers every run failure into a value and resolves
     * - including a refusal raised before the message is recorded, such as a session whose worktree has gone
     * - so a resolved send says nothing about delivery. Absent positive evidence the caller must assume the
     * message was lost, which is the side that keeps the user's work.
     */
    expect(hasRunStarted('session-1')).toBe(false)

    markRunStarted('session-1')
    expect(hasRunStarted('session-1')).toBe(true)
  })

  it('keeps sessions apart', () => {
    markRunStarted('session-1')

    expect(hasRunStarted('session-2')).toBe(false)
  })

  it('forgets the previous turn when a new send begins', () => {
    markRunStarted('session-1')
    clearRunStarted('session-1')

    expect(hasRunStarted('session-1')).toBe(false)
  })

  it('recognises only a run that failed after delivery', () => {
    const cause = new Error('provider rate limit')

    expect(wasMessageDelivered(new MessageDeliveredRunFailed(cause))).toBe(true)
    expect(wasMessageDelivered(cause)).toBe(false)
    expect(new MessageDeliveredRunFailed(cause).message).toBe('provider rate limit')
  })
})
