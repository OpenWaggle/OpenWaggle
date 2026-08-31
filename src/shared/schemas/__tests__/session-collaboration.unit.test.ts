import { describe, expect, it } from 'vitest'
import {
  decodeSessionControlMutationRequest,
  SESSION_CONTROL_CONTRACT_VERSION,
} from '../session-control'

describe('Session collaboration v2 boundary', () => {
  it('decodes an explicit cross-session report without Run mutation fields', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-report',
      idempotencyKey: 'idempotency-report',
      command: {
        operation: 'report',
        sessionId: 'session-worker',
        sourceRunId: 'run-worker',
        target: { type: 'upstream' },
        input: {
          text: 'The migration is ready for review.',
          requestReply: true,
        },
      },
    })

    expect(request.command).toEqual({
      operation: 'report',
      sessionId: 'session-worker',
      sourceRunId: 'run-worker',
      target: { type: 'upstream' },
      input: {
        text: 'The migration is ready for review.',
        requestReply: true,
      },
    })
  })

  it('decodes an immutable Delegation submission with bounded evidence', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-submission',
      idempotencyKey: 'idempotency-submission',
      command: {
        operation: 'delegation-submit',
        sessionId: 'session-worker',
        delegationId: 'delegation-worker',
        summary: 'Implemented and verified the migration.',
        evidence: [
          {
            kind: 'observed-command',
            summary: 'Unit tests passed.',
            reference: 'pnpm test:unit',
          },
        ],
      },
    })

    expect(request.command).toMatchObject({
      operation: 'delegation-submit',
      delegationId: 'delegation-worker',
      evidence: [{ kind: 'observed-command' }],
    })
  })
})
