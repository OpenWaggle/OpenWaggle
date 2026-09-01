import { SESSION_COLLABORATION_COLLECTION_LIMIT } from '@shared/session-collaboration-collections'
import { describe, expect, it } from 'vitest'
import { decodeSessionControlMutationRequest } from '../session-control'
import { decodeSessionLifecycleRequest } from '../session-lifecycle'

function values(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index)}`)
}

function controlRequest(command: Record<string, unknown>) {
  return {
    contractVersion: 2,
    requestId: 'collaboration-bounds',
    idempotencyKey: 'collaboration-bounds-once',
    command,
  }
}

function specification(dependencies: readonly unknown[] = []) {
  return {
    objective: 'Implement the bounded operation.',
    deliverables: values('deliverable', SESSION_COLLABORATION_COLLECTION_LIMIT),
    acceptanceCriteria: [],
    dependencies,
    resourceReferences: [],
  }
}

describe('Session collaboration collection boundaries', () => {
  it('accepts the report target limit and rejects larger or duplicate targets', () => {
    const command = {
      operation: 'report',
      sessionId: 'worker',
      target: {
        type: 'sessions',
        sessionIds: values('session', SESSION_COLLABORATION_COLLECTION_LIMIT),
      },
      input: { text: 'Status.', requestReply: false },
    }
    expect(() => decodeSessionControlMutationRequest(controlRequest(command))).not.toThrow()
    expect(() =>
      decodeSessionControlMutationRequest(
        controlRequest({
          ...command,
          target: {
            type: 'sessions',
            sessionIds: values('session', SESSION_COLLABORATION_COLLECTION_LIMIT + 1),
          },
        }),
      ),
    ).toThrow()
    expect(() =>
      decodeSessionControlMutationRequest(
        controlRequest({ ...command, target: { type: 'sessions', sessionIds: ['same', 'same'] } }),
      ),
    ).toThrow(/unique/)
  })

  it('bounds and deduplicates evidence and claims', () => {
    const evidence = values('evidence', SESSION_COLLABORATION_COLLECTION_LIMIT).map((summary) => ({
      kind: 'asserted-note',
      summary,
    }))
    const claims = values('claim', SESSION_COLLABORATION_COLLECTION_LIMIT).map((path) => ({
      access: 'write',
      target: { type: 'workspace-file', path },
    }))
    for (const [operation, field, items] of [
      ['delegation-submit', 'evidence', evidence],
      ['delegation-claim', 'claims', claims],
    ] as const) {
      const command = {
        operation,
        sessionId: 'worker',
        delegationId: 'delegation',
        ...(operation === 'delegation-submit' ? { summary: 'Ready.' } : { reason: 'Coordinate.' }),
        [field]: items,
      }
      expect(() => decodeSessionControlMutationRequest(controlRequest(command))).not.toThrow()
      expect(() =>
        decodeSessionControlMutationRequest(
          controlRequest({ ...command, [field]: [...items, items[0]] }),
        ),
      ).toThrow()
      expect(() =>
        decodeSessionControlMutationRequest(
          controlRequest({ ...command, [field]: [items[0], items[0]] }),
        ),
      ).toThrow(/unique/)
    }
  })

  it('bounds specification collections and rejects duplicate dependency identities', () => {
    const request = {
      contractVersion: 2,
      requestId: 'spawn-bounds',
      idempotencyKey: 'spawn-bounds-once',
      command: {
        operation: 'spawn',
        parentSessionId: 'parent',
        expectedParentRunId: 'run-parent',
        delegation: specification(),
      },
    }
    expect(() => decodeSessionLifecycleRequest(request)).not.toThrow()
    expect(() =>
      decodeSessionLifecycleRequest({
        ...request,
        command: {
          ...request.command,
          delegation: {
            ...request.command.delegation,
            deliverables: values('deliverable', SESSION_COLLABORATION_COLLECTION_LIMIT + 1),
          },
        },
      }),
    ).toThrow()
    expect(() =>
      decodeSessionLifecycleRequest({
        ...request,
        command: {
          ...request.command,
          delegation: specification([
            { delegationId: 'same', requiredState: 'ready_for_review' },
            { delegationId: 'same', requiredState: 'accepted' },
          ]),
        },
      }),
    ).toThrow(/unique/)
  })

  it('applies the same boundary to revised specifications', () => {
    const command = {
      operation: 'delegation-request-revision',
      sessionId: 'parent',
      delegationId: 'delegation',
      submissionRevision: 1,
      feedback: 'Add the complete checklist.',
      revisedSpecification: {
        objective: 'Revise the work.',
        deliverables: values('deliverable', SESSION_COLLABORATION_COLLECTION_LIMIT),
        acceptanceCriteria: [],
        resourceReferences: [],
      },
    }
    expect(() => decodeSessionControlMutationRequest(controlRequest(command))).not.toThrow()
    expect(() =>
      decodeSessionControlMutationRequest(
        controlRequest({
          ...command,
          revisedSpecification: {
            ...command.revisedSpecification,
            deliverables: [...command.revisedSpecification.deliverables, 'one-too-many'],
          },
        }),
      ),
    ).toThrow()
    expect(() =>
      decodeSessionControlMutationRequest(
        controlRequest({
          ...command,
          revisedSpecification: { ...command.revisedSpecification, deliverables: ['same', 'same'] },
        }),
      ),
    ).toThrow(/unique/)
  })
})
