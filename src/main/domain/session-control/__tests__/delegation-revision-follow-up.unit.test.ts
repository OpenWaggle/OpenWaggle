import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationRequest,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import { describe, expect, it } from 'vitest'
import { delegationRevisionFollowUp } from '../delegation-revision-follow-up'

function request(command: SessionControlMutationRequest['command']): SessionControlMutationRequest {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: 'review-request',
    idempotencyKey: 'review-key',
    command,
  }
}

function updated(
  operation: 'delegation-request-revision' | 'delegation-reopen' | 'delegation-accept',
  overrides: { readonly replayed?: boolean; readonly specificationChanged?: true } = {},
): SessionControlMutationResponse {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: 'review-request',
    idempotencyKey: 'review-key',
    replayed: overrides.replayed ?? false,
    outcome: {
      operation,
      effect: 'delegation-updated',
      sessionId: 'queen',
      delegationId: 'delegation-worker',
      parentSessionId: 'queen',
      workerSessionId: 'worker',
      delegationState: operation === 'delegation-accept' ? 'accepted' : 'revision_requested',
      specificationRevision: overrides.specificationChanged ? 2 : 1,
      submissionRevision: 3,
      ...(overrides.specificationChanged ? { specificationChanged: true } : {}),
    },
  }
}

const revisionCommand = {
  operation: 'delegation-request-revision',
  sessionId: 'queen',
  delegationId: 'delegation-worker',
  submissionRevision: 3,
  feedback: 'Cover the error path too.',
} as const

function payloadOf(text: string | undefined) {
  const line = text?.split('\n').find((candidate) => candidate.startsWith('{'))
  return line === undefined ? undefined : JSON.parse(line)
}

describe('delegationRevisionFollowUp', () => {
  it('sends feedback-only revision feedback to the Worker as a Host-authored Follow-up', () => {
    const followUp = delegationRevisionFollowUp(
      request(revisionCommand),
      updated('delegation-request-revision'),
    )

    expect(followUp).toMatchObject({
      requestId: 'delegation-revision:review-request',
      idempotencyKey: 'delegation-revision:review-key',
      command: { operation: 'follow-up', sessionId: 'worker', input: { attachmentIds: [] } },
    })
    const text = followUp?.command.input.text
    expect(text?.startsWith('OpenWaggle Host-authored Delegation revision request.')).toBe(true)
    expect(payloadOf(text)).toEqual({
      delegationId: 'delegation-worker',
      parentSessionId: 'queen',
      submissionRevision: 3,
      feedback: 'Cover the error path too.',
    })
  })

  it('names the revised specification revision when the review changed the specification', () => {
    const followUp = delegationRevisionFollowUp(
      request({
        ...revisionCommand,
        revisedSpecification: {
          objective: 'Review the tests',
          deliverables: [],
          acceptanceCriteria: [],
          resourceReferences: [],
        },
      }),
      updated('delegation-request-revision', { specificationChanged: true }),
    )

    expect(payloadOf(followUp?.command.input.text)).toMatchObject({ specificationRevision: 2 })
    expect(followUp?.command.input.text).toContain('Delegation specification update')
  })

  it('sends a reopen reason as the feedback', () => {
    const followUp = delegationRevisionFollowUp(
      request({
        operation: 'delegation-reopen',
        sessionId: 'queen',
        delegationId: 'delegation-worker',
        reason: 'The error path is still missing.',
      }),
      updated('delegation-reopen'),
    )

    expect(followUp?.command.input.text).toContain('reopened submission 3')
    expect(payloadOf(followUp?.command.input.text)).toMatchObject({
      feedback: 'The error path is still missing.',
    })
  })

  it('sends nothing for a replayed review, which already sent it', () => {
    expect(
      delegationRevisionFollowUp(
        request(revisionCommand),
        updated('delegation-request-revision', { replayed: true }),
      ),
    ).toBeUndefined()
  })

  it('sends nothing for a refused review or a review that does not send the Worker back', () => {
    expect(
      delegationRevisionFollowUp(request(revisionCommand), {
        ...updated('delegation-request-revision'),
        outcome: {
          operation: 'delegation-request-revision',
          effect: 'rejected',
          sessionId: 'queen',
          code: 'submission_revision_stale',
          kind: 'conflict',
        },
      }),
    ).toBeUndefined()
    expect(
      delegationRevisionFollowUp(
        request({
          operation: 'delegation-accept',
          sessionId: 'queen',
          delegationId: 'delegation-worker',
          submissionRevision: 3,
        }),
        updated('delegation-accept'),
      ),
    ).toBeUndefined()
  })
})
