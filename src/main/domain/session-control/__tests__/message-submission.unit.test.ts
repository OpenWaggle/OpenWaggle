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
})
