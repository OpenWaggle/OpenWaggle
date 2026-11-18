import { ATTACHMENT } from '@shared/constants/resource-limits'
import { decodeLocalSessionCommandPayload } from '@shared/schemas/local-session-protocol'
import { SESSION_INPUT_LIMITS } from '@shared/session-input-limits'
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

describe('canonical Session input boundaries', () => {
  it('rejects empty and oversized identifiers at control and query boundaries', () => {
    for (const sessionId of ['', 's'.repeat(SESSION_INPUT_LIMITS.idLength + 1)]) {
      expect(() =>
        decodeSessionControlMutationRequest(controlRequest({ operation: 'archive', sessionId })),
      ).toThrow()
    }
  })

  it('rejects text whose UTF-8 encoding exceeds the persisted text limit', () => {
    const oversizedMultibyteText = 'é'.repeat(SESSION_INPUT_LIMITS.persistedTextBytes / 2 + 1)
    expect(() =>
      decodeSessionControlMutationRequest(
        controlRequest({
          operation: 'message',
          sessionId: 'session-1',
          input: { text: oversizedMultibyteText, attachmentIds: [] },
        }),
      ),
    ).toThrow(/UTF-8 bytes/)
  })

  it('rejects oversized specification items and project paths', () => {
    expect(() =>
      decodeSessionLifecycleRequest(
        lifecycleRequest({
          operation: 'spawn',
          parentSessionId: 'parent',
          expectedParentRunId: 'run-parent',
          delegation: {
            objective: 'Bound the work.',
            deliverables: ['x'.repeat(SESSION_INPUT_LIMITS.itemTextLength + 1)],
            acceptanceCriteria: [],
            dependencies: [],
            resourceReferences: [],
          },
        }),
      ),
    ).toThrow()
    expect(() =>
      decodeSessionLifecycleRequest(
        lifecycleRequest({
          operation: 'create',
          projectPath: `/${'p'.repeat(SESSION_INPUT_LIMITS.pathLength)}`,
        }),
      ),
    ).toThrow()
  })

  it('bounds attachment preparation and transport collections before Host dispatch', () => {
    const paths = Array.from(
      { length: ATTACHMENT.MAX_COUNT + 1 },
      (_, index) => `/repo/file-${String(index)}.txt`,
    )
    expect(() =>
      decodeLocalSessionCommandPayload({
        contract: 'local-attachments-v1',
        request: {
          requestId: 'prepare-too-many',
          entries: paths.map((path) => ({ path })),
        },
      }),
    ).toThrow()
    expect(() =>
      decodeLocalSessionCommandPayload({
        contract: 'session-control-v2',
        request: controlRequest({
          operation: 'message',
          sessionId: 'session-1',
          input: { text: 'Inspect.', attachmentIds: [] },
        }),
        transport: { attachmentPaths: paths },
      }),
    ).toThrow()
  })

  it('bounds persisted tree expansion state before local UI dispatch', () => {
    expect(() =>
      decodeLocalSessionCommandPayload({
        contract: 'local-ui-v1',
        request: {
          requestId: 'expanded-tree-too-large',
          command: {
            operation: 'update-tree-ui-state',
            sessionId: 'session-1',
            patch: {
              expandedNodeIds: Array.from(
                { length: SESSION_INPUT_LIMITS.expandedTreeNodeItems + 1 },
                (_, index) => `node-${String(index)}`,
              ),
            },
          },
        },
      }),
    ).toThrow()
  })
})
