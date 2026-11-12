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

/** A session on one branch: every entry is on the path to its leaf. */
function sessionEntries(entries: readonly SessionEntry[]) {
  return { getEntries: () => [...entries], getBranch: () => [...entries] }
}

function persistedUpdate(id: string, updateIds: readonly string[]) {
  return {
    type: 'custom_message',
    id,
    parentId: null,
    timestamp: new Date(0).toISOString(),
    customType: 'openwaggle-orchestration-update',
    content: 'persisted',
    display: true,
    details: { updateIds: [...updateIds] },
  } satisfies SessionEntry
}

/** The extension of a Run that starts with `pendingUpdates`, over a session holding `entries`. */
async function startRun(input: {
  readonly runId: string
  readonly branch: readonly SessionEntry[]
  readonly abandoned?: readonly SessionEntry[]
  readonly pendingUpdates?: readonly (typeof updates)[number][]
}) {
  const handlers = new Map<string, (event: unknown, context?: unknown) => unknown>()
  const sendMessage = vi.fn()
  const delivered = vi.fn()
  const extension = createOrchestrationUpdateExtension({
    runId: input.runId,
    pendingUpdates: input.pendingUpdates ?? updates,
    onDelivered: delivered,
  })
  await extension.factory(
    fromPartial<ExtensionAPI>({
      on: vi.fn((event: string, handler: (event: unknown, context?: unknown) => unknown) => {
        handlers.set(event, handler)
      }),
      sendMessage,
    }),
  )
  const sessionManager = {
    getEntries: () => [...input.branch, ...(input.abandoned ?? [])],
    getBranch: () => [...input.branch],
  }
  handlers.get('session_start')?.({}, { sessionManager })
  return { handlers, sendMessage, delivered, close: extension.close }
}

describe('Pi orchestration update extension', () => {
  it('batches pending Worker results into one Host-authored parent context message', async () => {
    let sessionStart: ((entries: readonly SessionEntry[]) => unknown) | undefined
    let turnStart: (() => unknown) | undefined
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
            sessionStart = (entries) => handler({}, { sessionManager: sessionEntries(entries) })
          }
          if (event === 'turn_start' && typeof handler === 'function') turnStart = () => handler({})
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
    // Delivered once the Run's first model request includes them, not when they are appended.
    expect(delivered).not.toHaveBeenCalled()
    turnStart?.()
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
              handler({}, { sessionManager: sessionEntries(currentEntries) })
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

  // The Session's active Run is still the classic one, but its sink closed when the Waggle began.
  it('delivers to the Waggle a classic Run requested once the classic Run has ended', async () => {
    const run = await startRun({ runId: 'waggle-of-run-classic', branch: [], pendingUpdates: [] })

    expect(deliverOrchestrationUpdates('run-classic', updates)).toBe(true)
    expect(run.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ customType: 'openwaggle-orchestration-update' }),
      { deliverAs: 'steer', triggerTurn: false },
    )
    run.close()
  })

  // Pi loads extensions well before it starts the session, and refuses messages until then.
  it('takes no live update before the session starts', async () => {
    const handlers = new Map<string, (event: unknown, context?: unknown) => unknown>()
    // Pi's loader refuses messages until the runtime is bound.
    let runtimeBound = false
    const sendMessage = vi.fn(() => {
      if (!runtimeBound) throw new Error('Extension runtime not initialized')
    })
    const delivered = vi.fn()
    const extension = createOrchestrationUpdateExtension({
      runId: 'run-before-start',
      pendingUpdates: [],
      onDelivered: delivered,
    })
    await extension.factory(
      fromPartial<ExtensionAPI>({
        on: vi.fn((event: string, handler: (event: unknown, context?: unknown) => unknown) => {
          handlers.set(event, handler)
        }),
        sendMessage,
      }),
    )

    expect(deliverOrchestrationUpdates('run-before-start', updates)).toBe(false)
    expect(sendMessage).not.toHaveBeenCalled()

    // The classic Run's final turn already put update-1 on the branch.
    runtimeBound = true
    handlers.get('session_start')?.(
      {},
      { sessionManager: sessionEntries([persistedUpdate('pi-entry-final-turn', ['update-1'])]) },
    )
    expect(sendMessage).not.toHaveBeenCalled()
    expect(deliverOrchestrationUpdates('run-before-start', updates)).toBe(true)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ details: { updateIds: ['update-2'] } }),
      { deliverAs: 'steer', triggerTurn: false },
    )
    handlers.get('turn_start')?.({})
    expect(delivered).toHaveBeenCalledWith(['update-1'])
    extension.close()
  })

  it('leaves a result that reached the parent during its final turn pending', async () => {
    const handlers = new Map<string, (event: unknown, context?: unknown) => unknown>()
    const entries: SessionEntry[] = []
    const sessionManager = sessionEntries(entries)
    const delivered = vi.fn()
    const extension = createOrchestrationUpdateExtension({
      runId: 'run-parent-final-turn',
      pendingUpdates: [],
      onDelivered: delivered,
    })
    await extension.factory(
      fromPartial<ExtensionAPI>({
        on: vi.fn((event: string, handler: (event: unknown, context?: unknown) => unknown) => {
          handlers.set(event, handler)
        }),
        // Pi appends a mid-turn message at the end of the turn.
        sendMessage: vi.fn((message: { readonly details: Record<string, unknown> }) => {
          entries.push({
            type: 'custom_message',
            id: `pi-entry-${entries.length}`,
            parentId: null,
            timestamp: new Date(0).toISOString(),
            customType: 'openwaggle-orchestration-update',
            content: 'persisted',
            display: true,
            details: message.details,
          })
        }),
      }),
    )
    handlers.get('session_start')?.({}, { sessionManager })
    handlers.get('turn_start')?.({})

    deliverOrchestrationUpdates('run-parent-final-turn', updates)
    handlers.get('agent_end')?.({})
    handlers.get('agent_settled')?.({})

    // The Run ended without another request, so the parent never read it: it stays pending and
    // wakes the parent once this Run settles.
    expect(delivered).not.toHaveBeenCalled()
    handlers.get('turn_start')?.({})
    expect(delivered).toHaveBeenCalledWith(['update-1', 'update-2'])
    extension.close()
  })

  it('acknowledges an update an earlier Run left unread at the wake Run’s first request', async () => {
    // The parent's last Run ended with both updates appended after its answer.
    const run = await startRun({
      runId: 'run-wake',
      branch: [persistedUpdate('pi-entry-unread', ['update-1', 'update-2'])],
    })

    expect(run.sendMessage).not.toHaveBeenCalled()
    run.handlers.get('agent_end')?.({})
    expect(run.delivered).not.toHaveBeenCalled()
    run.handlers.get('turn_start')?.({})
    expect(run.delivered).toHaveBeenCalledWith(['update-1', 'update-2'])
    run.close()
  })

  it('sends an update again when its entry is only on a branch the user left', async () => {
    const run = await startRun({
      runId: 'run-after-edit',
      branch: [],
      abandoned: [persistedUpdate('pi-entry-abandoned', ['update-1', 'update-2'])],
    })

    expect(run.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ details: { updateIds: ['update-1', 'update-2'] } }),
      { deliverAs: 'steer', triggerTurn: false },
    )
    run.close()
  })

  // A Waggle that inherited no list (it could not be read) learns of an update already on the
  // branch only from a later live delivery: it is acknowledged, never sent again.
  it('does not send again a live update already on the branch', async () => {
    const run = await startRun({
      runId: 'waggle-of-run-classic',
      branch: [persistedUpdate('pi-entry-final-turn', ['update-1'])],
      pendingUpdates: [],
    })

    // The Session's active Run is still the classic one.
    expect(deliverOrchestrationUpdates('run-classic', updates)).toBe(true)
    expect(run.sendMessage).toHaveBeenCalledTimes(1)
    expect(run.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ details: { updateIds: ['update-2'] } }),
      { deliverAs: 'steer', triggerTurn: false },
    )
    run.handlers.get('turn_start')?.({})
    expect(run.delivered).toHaveBeenCalledTimes(1)
    expect(run.delivered).toHaveBeenCalledWith(['update-1'])
    run.close()
  })
})
