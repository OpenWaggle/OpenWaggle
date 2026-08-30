import type { ExtensionAPI, SessionEntry } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import {
  createDelegationSpecificationUpdateExtension,
  deliverDelegationSpecificationUpdates,
} from '../delegation-specification-update-extension'

const updates = [
  {
    updateId: 'delegation-specification:delegation-1:2',
    delegationId: 'delegation-1',
    parentSessionId: 'queen',
    workerSessionId: 'worker-1',
    specificationRevision: 2,
    specification: {
      objective: 'Implement and document the verifier.',
      deliverables: ['Implementation', 'Documentation'],
      acceptanceCriteria: ['Tests pass'],
      dependencies: [],
      resourceReferences: [],
    },
    reason: 'Documentation was added to scope.',
    createdAt: 1000,
  },
] as const

describe('Pi Delegation specification update extension', () => {
  it('injects pending revisions before a Worker starts', async () => {
    let sessionStart: ((entries: readonly SessionEntry[]) => unknown) | undefined
    const entries: SessionEntry[] = []
    const sendMessage = vi.fn(() => {
      entries.push({
        type: 'custom_message',
        id: 'pi-entry-startup',
        parentId: null,
        timestamp: new Date(0).toISOString(),
        customType: 'openwaggle-delegation-specification-update',
        content: 'persisted',
        display: true,
        details: { updateIds: ['delegation-specification:delegation-1:2'] },
      })
    })
    const delivered = vi.fn()
    const extension = createDelegationSpecificationUpdateExtension({
      runId: 'run-worker',
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
        customType: 'openwaggle-delegation-specification-update',
        display: true,
        details: { updateIds: ['delegation-specification:delegation-1:2'] },
        content: expect.stringContaining('"specificationRevision":2'),
      },
      { deliverAs: 'steer', triggerTurn: false },
    )
    expect(delivered).toHaveBeenCalledWith(['delegation-specification:delegation-1:2'])
    extension.close()
  })

  it('steers an active Worker without starting another turn', async () => {
    let sessionStart: ((entries: readonly SessionEntry[]) => unknown) | undefined
    const sendMessage = vi.fn()
    const delivered = vi.fn()
    const extension = createDelegationSpecificationUpdateExtension({
      runId: 'run-worker-live',
      pendingUpdates: [],
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
    sessionStart?.([])

    expect(deliverDelegationSpecificationUpdates('run-worker-live', updates)).toBe(true)
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ customType: 'openwaggle-delegation-specification-update' }),
      { deliverAs: 'steer', triggerTurn: false },
    )
    extension.close()
  })
})
