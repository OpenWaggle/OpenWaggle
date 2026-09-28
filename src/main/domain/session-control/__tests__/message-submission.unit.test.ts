import { describe, expect, it } from 'vitest'
import { planMessageSubmission } from '../message-submission'

const EMPTY_RUNNING_QUEUE = { pendingCount: 0, state: 'running', headDeliverable: false } as const

describe('Session Control message submission', () => {
  it('starts a Run when the Session is idle and has no pending Follow-ups', () => {
    const plan = planMessageSubmission({
      run: { state: 'idle' },
      followUpQueue: EMPTY_RUNNING_QUEUE,
    })

    expect(plan).toEqual({ action: 'start-run' })
  })

  it('appends a Follow-up when the Session has an active Run', () => {
    const plan = planMessageSubmission({
      run: { state: 'active', runId: 'run-active' },
      followUpQueue: EMPTY_RUNNING_QUEUE,
    })

    expect(plan).toEqual({ action: 'append-follow-up' })
  })

  it('appends a Follow-up behind waiting ones the queue is about to deliver', () => {
    const plan = planMessageSubmission({
      run: { state: 'idle' },
      followUpQueue: { pendingCount: 1, state: 'running', headDeliverable: true },
    })

    expect(plan).toEqual({ action: 'append-follow-up' })
  })

  /*
   * A failed Run pauses the queue and leaves the Session idle with Follow-ups still waiting. A
   * message sent after that is the user answering the failure, so it runs; joining the paused
   * queue left it waiting for a Resume nobody knew was needed. The paused items stay paused.
   */
  it('starts a Run when an idle Session only has Follow-ups in a paused queue', () => {
    const plan = planMessageSubmission({
      run: { state: 'idle' },
      followUpQueue: { pendingCount: 2, state: 'paused', headDeliverable: true },
    })

    expect(plan).toEqual({ action: 'start-run' })
  })

  it('starts a Run when the queue head is waiting for attention', () => {
    const plan = planMessageSubmission({
      run: { state: 'idle' },
      followUpQueue: { pendingCount: 1, state: 'running', headDeliverable: false },
    })

    expect(plan).toEqual({ action: 'start-run' })
  })
})
