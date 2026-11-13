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
  it("sends feedback-only revision feedback to the Worker as the reviewer's Follow-up", () => {
    const followUp = delegationRevisionFollowUp(
      request(revisionCommand),
      updated('delegation-request-revision'),
    )

    expect(followUp).toMatchObject({
      requestId: 'delegation-revision:delegation-request-revision:review-request',
      idempotencyKey: 'delegation-revision:delegation-request-revision:review-key',
      command: { operation: 'follow-up', sessionId: 'worker', input: { attachmentIds: [] } },
    })
    const text = followUp?.command.input.text
    expect(
      text?.startsWith("OpenWaggle Delegation revision request, sent as your parent's Follow-up."),
    ).toBe(true)
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

  it('sends a task change that set aside a reviewed result, with its reason as the feedback', () => {
    const response: SessionControlMutationResponse = {
      ...updated('delegation-request-revision'),
      outcome: {
        operation: 'delegation-amend',
        effect: 'delegation-specification-amended',
        sessionId: 'queen',
        delegationId: 'delegation-worker',
        delegationState: 'revision_requested',
        specificationRevision: 2,
        workerSessionId: 'worker',
        revisionRequest: { parentSessionId: 'queen', submissionRevision: 3 },
      },
    }
    const amend = request({
      operation: 'delegation-amend',
      sessionId: 'queen',
      delegationId: 'delegation-worker',
      expectedSpecificationRevision: 1,
      specification: {
        objective: 'Review the tests',
        deliverables: [],
        acceptanceCriteria: [],
        resourceReferences: [],
        dependencies: [],
      },
      reason: '  Cover the error path.  ',
    })

    const followUp = delegationRevisionFollowUp(amend, response)
    expect(followUp?.command.sessionId).toBe('worker')
    expect(followUp?.command.input.text).toContain(
      "changed your Delegation's task after submission 3",
    )
    expect(payloadOf(followUp?.command.input.text)).toEqual({
      delegationId: 'delegation-worker',
      parentSessionId: 'queen',
      submissionRevision: 3,
      specificationRevision: 2,
      feedback: 'Cover the error path.',
    })

    // A Worker still on the task gets the new specification in its Run, not a revision request.
    expect(
      delegationRevisionFollowUp(amend, {
        ...response,
        outcome: {
          operation: 'delegation-amend',
          effect: 'delegation-specification-amended',
          sessionId: 'queen',
          delegationId: 'delegation-worker',
          delegationState: 'revision_requested',
          specificationRevision: 2,
          workerSessionId: 'worker',
        },
      }),
    ).toBeUndefined()
  })
})
