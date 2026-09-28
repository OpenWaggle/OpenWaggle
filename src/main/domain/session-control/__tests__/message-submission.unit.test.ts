import { describe, expect, it } from 'vitest'
import { planMessageSubmission } from '../message-submission'

describe('Session Control message submission', () => {
  it('starts a Run when the Session is idle and has no pending Follow-ups', () => {
    const plan = planMessageSubmission({
      run: { state: 'idle' },
      followUpQueue: { pendingCount: 0 },
    })

    expect(plan).toEqual({ action: 'start-run' })
  })

  it('appends a Follow-up when the Session has an active Run', () => {
    const plan = planMessageSubmission({
      run: { state: 'active', runId: 'run-active' },
      followUpQueue: { pendingCount: 0 },
    })

    expect(plan).toEqual({ action: 'append-follow-up' })
  })

  // A failed Run pauses the queue and leaves the Session idle with Follow-ups still waiting. A new
  // message joins them so order is preserved; it does not start a Run. Clients must not assume a
  // message to an idle Session starts one (see `agent:send-message`'s `queued` report).
  it('appends a Follow-up when an idle Session still has pending Follow-ups', () => {
    const plan = planMessageSubmission({
      run: { state: 'idle' },
      followUpQueue: { pendingCount: 1 },
    })

    expect(plan).toEqual({ action: 'append-follow-up' })
  })
})
