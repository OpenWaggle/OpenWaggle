import { describe, expect, it } from 'vitest'
import {
  decodeSessionControlMutationResponse,
  SESSION_CONTROL_CONTRACT_VERSION,
} from '../session-control'

describe('Session Control explicit Follow-up outcome boundary', () => {
  it('decodes a Follow-up that became the next Run during admission', () => {
    const response = decodeSessionControlMutationResponse({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-follow-up',
      idempotencyKey: 'idempotency-follow-up',
      replayed: false,
      outcome: {
        operation: 'follow-up',
        effect: 'started-run',
        sessionId: 'session-target',
        runId: 'run-next',
        stateRevision: 4,
      },
    })

    expect(response.outcome).toEqual({
      operation: 'follow-up',
      effect: 'started-run',
      sessionId: 'session-target',
      runId: 'run-next',
      stateRevision: 4,
    })
  })
})
