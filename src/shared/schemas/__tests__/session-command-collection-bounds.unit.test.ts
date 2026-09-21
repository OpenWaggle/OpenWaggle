import { ATTACHMENT } from '@shared/constants/resource-limits'
import { MAX_FOLLOW_UP_QUEUE_ITEMS } from '@shared/types/session-control-queue'
import { describe, expect, it } from 'vitest'
import { decodeSessionControlMutationRequest } from '../session-control'
import { decodeSessionLifecycleRequest } from '../session-lifecycle'

function controlRequest(command: Record<string, unknown>) {
  return {
    contractVersion: 2,
    requestId: 'bounded-control',
    idempotencyKey: 'bounded-control-once',
    command,
  }
}

function lifecycleRequest(command: Record<string, unknown>) {
  return {
    contractVersion: 2,
    requestId: 'bounded-lifecycle',
    idempotencyKey: 'bounded-lifecycle-once',
    command,
  }
}

function attachmentIds(count: number) {
  return Array.from({ length: count }, (_, index) => `attachment-${String(index)}`)
}

function followUpIds(count: number) {
  return Array.from({ length: count }, (_, index) => `follow-up-${String(index)}`)
}

describe('Session command collection boundaries', () => {
  it('accepts the attachment limit and rejects a larger control message', () => {
    expect(() =>
      decodeSessionControlMutationRequest(
        controlRequest({
          operation: 'message',
          sessionId: 'session-target',
          input: {
            text: 'Use these attachments.',
            attachmentIds: attachmentIds(ATTACHMENT.MAX_COUNT),
          },
        }),
      ),
    ).not.toThrow()
    expect(() =>
      decodeSessionControlMutationRequest(
        controlRequest({
          operation: 'message',
          sessionId: 'session-target',
          input: {
            text: 'Use too many attachments.',
            attachmentIds: attachmentIds(ATTACHMENT.MAX_COUNT + 1),
          },
        }),
      ),
    ).toThrow()
  })

  it('rejects duplicate attachment capabilities in control and lifecycle commands', () => {
    expect(() =>
      decodeSessionControlMutationRequest(
        controlRequest({
          operation: 'start',
          sessionId: 'session-target',
          input: { text: 'Start once.', attachmentIds: ['attachment-1', 'attachment-1'] },
        }),
      ),
    ).toThrow(/unique/)
    expect(() =>
      decodeSessionLifecycleRequest(
        lifecycleRequest({
          operation: 'spawn',
          parentSessionId: 'session-parent',
          expectedParentRunId: 'run-parent',
          attachmentIds: ['attachment-1', 'attachment-1'],
          delegation: {
            objective: 'Inspect the attachments.',
            deliverables: [],
            acceptanceCriteria: [],
            dependencies: [],
            resourceReferences: [],
          },
        }),
      ),
    ).toThrow(/unique/)
  })

  it('rejects lifecycle attachment arrays above the shared attachment limit', () => {
    expect(() =>
      decodeSessionLifecycleRequest(
        lifecycleRequest({
          operation: 'launch',
          projectPath: '/project',
          objective: 'Inspect the attachments.',
          attachmentIds: attachmentIds(ATTACHMENT.MAX_COUNT + 1),
        }),
      ),
    ).toThrow()
  })

  it.each([
    ['queue-withdraw', 'followUpIds'],
    ['queue-reorder', 'orderedFollowUpIds'],
  ] as const)('rejects oversized %s collections', (operation, field) => {
    expect(() =>
      decodeSessionControlMutationRequest(
        controlRequest({
          operation,
          sessionId: 'session-target',
          ...(operation === 'queue-reorder' ? { expectedQueueRevision: 1 } : {}),
          [field]: followUpIds(MAX_FOLLOW_UP_QUEUE_ITEMS + 1),
        }),
      ),
    ).toThrow()
  })

  it.each([
    ['queue-withdraw', 'followUpIds'],
    ['queue-reorder', 'orderedFollowUpIds'],
  ] as const)('rejects duplicate %s identities', (operation, field) => {
    expect(() =>
      decodeSessionControlMutationRequest(
        controlRequest({
          operation,
          sessionId: 'session-target',
          ...(operation === 'queue-reorder' ? { expectedQueueRevision: 1 } : {}),
          [field]: ['follow-up-1', 'follow-up-1'],
        }),
      ),
    ).toThrow(/unique/)
  })
})
