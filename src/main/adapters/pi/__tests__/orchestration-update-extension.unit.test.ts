import type { ExtensionAPI, SessionEntry } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import {
  createOrchestrationUpdateExtension,
  deliverOrchestrationUpdates,
} from '../orchestration-update-extension'

const updates = [
  {
    updateId: 'update-1',
    delegationId: 'delegation-1',
    workerSessionId: 'worker-1',
    sourceRunId: 'run-worker-1',
    state: 'ready_for_review',
    summary: 'Protocol implementation and tests are complete.',
    createdAt: 1000,
  },
  {
    updateId: 'update-2',
    delegationId: 'delegation-2',
    workerSessionId: 'worker-2',
    sourceRunId: 'run-worker-2',
    state: 'needs_attention',
    summary: 'Worker Run was interrupted and needs attention.',
    createdAt: 1001,
  },
] as const

describe('Pi orchestration update extension', () => {
  it('batches pending Worker results into one Host-authored parent context message', async () => {
    let sessionStart: ((entries: readonly SessionEntry[]) => unknown) | undefined
    const entries: SessionEntry[] = []
    const sendMessage = vi.fn(() => {
      entries.push({
        type: 'custom_message',
        id: 'pi-entry-startup',
        parentId: null,
        timestamp: new Date(0).toISOString(),
        customType: 'openwaggle-orchestration-update',
        content: 'persisted',
        display: true,
        details: { updateIds: ['update-1', 'update-2'] },
      })
    })
    const delivered = vi.fn()
    const extension = createOrchestrationUpdateExtension({
      runId: 'run-queen',
      pendingUpdates: updates,
      onDelivered: delivered,
    })
    await extension.factory(
      fromPartial<ExtensionAPI>({
        on: vi.fn((event: unknown, handler: unknown) => {
          if (event === 'session_start' && typeof handler === 'function') {
            sessionStart = (entries) =>
              handler({}, { sessionManager: { getEntries: () => [...entries] } })
          }
        }),
        sendMessage,
      }),
    )

    sessionStart?.(entries)

    expect(sendMessage).toHaveBeenCalledWith(
      {
        customType: 'openwaggle-orchestration-update',
        display: true,
        details: { updateIds: ['update-1', 'update-2'] },
        content: expect.stringContaining('"workerSessionId":"worker-1"'),
      },
      { deliverAs: 'steer', triggerTurn: false },
    )
    expect(delivered).toHaveBeenCalledWith(['update-1', 'update-2'])
    extension.close()
  })

  it('delivers newly committed results to an active parent at a safe boundary', async () => {
    let sessionStart: ((entries: readonly SessionEntry[]) => unknown) | undefined
    const entries: SessionEntry[] = []
    const sendMessage = vi.fn()
    const delivered = vi.fn()
    const extension = createOrchestrationUpdateExtension({
      runId: 'run-parent-live',
      pendingUpdates: [],
      onDelivered: delivered,
    })
    await extension.factory(
      fromPartial<ExtensionAPI>({
        on: vi.fn((event: unknown, handler: unknown) => {
          if (event === 'session_start' && typeof handler === 'function') {
            sessionStart = (currentEntries) =>
              handler({}, { sessionManager: { getEntries: () => [...currentEntries] } })
          }
        }),
        sendMessage,
      }),
    )
    sessionStart?.(entries)

    expect(deliverOrchestrationUpdates('run-parent-live', updates)).toBe(true)
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ customType: 'openwaggle-orchestration-update' }),
      { deliverAs: 'steer', triggerTurn: false },
    )
    expect(delivered).not.toHaveBeenCalled()
    extension.close()
    expect(deliverOrchestrationUpdates('run-parent-live', updates)).toBe(false)
  })
})
