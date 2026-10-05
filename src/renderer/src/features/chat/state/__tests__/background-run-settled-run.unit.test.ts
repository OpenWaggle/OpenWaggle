// @vitest-environment jsdom

import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunStore } from '../background-run-store'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listActiveRuns: vi.fn(async () => []),
    getBackgroundRun: vi.fn(async () => null),
    getSessionDetail: vi.fn(async () => null),
  },
}))

const SESSION = SessionId('session-b')

function message(id: string, role: UIMessage['role']): UIMessage {
  return { id, role, parts: [{ type: 'text', content: id }], createdAt: new Date(1) }
}

function snapshot() {
  return useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION)
}

describe('background run render snapshots of a settled Run', () => {
  beforeEach(() => {
    useBackgroundRunStore.setState({
      activeRunIds: new Set(),
      renderSnapshotsBySessionId: new Map(),
    })
  })

  it('marks and clears a named Run seed when the settlement names no Run', () => {
    // A reconnect that finds the Session idle settles without a run id; no later Run has started.
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION, { type: 'agent_start', runId: 'run-1', timestamp: 1 })
    store.applyRunRenderEvent(SESSION, {
      type: 'message_start',
      messageId: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
    })
    store.noteRunRenderSnapshotRunSettled(SESSION, undefined)
    expect(snapshot()?.seededByRunId).not.toBe('run-1')

    store.clearSettledRunRenderSnapshot(SESSION)
    expect(snapshot()).toBeNull()
  })

  it('reseeds a named Run seed for a manual compaction after a settlement naming no Run', () => {
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION, { type: 'agent_start', runId: 'run-1', timestamp: 1 })
    store.applyRunRenderEvent(SESSION, {
      type: 'message_start',
      messageId: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
    })
    store.noteRunRenderSnapshotRunSettled(SESSION, undefined)
    store.applyRunRenderEvent(SESSION, { type: 'agent_start', runId: 'run-2', timestamp: 3 })

    expect(snapshot()).toMatchObject({ messages: [], seededByRunId: 'run-2' })
  })

  it('remembers the settled messages across the next Run start and route writes', () => {
    const store = useBackgroundRunStore.getState()
    store.setRunRenderMessages(SESSION, [message('p1', 'user'), message('stream-a1', 'assistant')])
    store.noteRunRenderSnapshotRunSettled(SESSION, 'run-1')
    store.applyRunRenderEvent(SESSION, { type: 'agent_start', runId: 'run-2', timestamp: 1 })
    expect(snapshot()?.settledMessageIds).toEqual(new Set(['p1', 'stream-a1']))

    // The route still rendering the Session writes its whole transcript, settled rows included.
    store.setRunRenderMessages(SESSION, [
      message('p1', 'user'),
      message('stream-a1', 'assistant'),
      message('stream-a2', 'assistant'),
    ])
    expect(snapshot()?.settledMessageIds).toEqual(new Set(['p1', 'stream-a1']))

    // A route that rehydrated from the persisted transcript no longer holds the settled stream rows.
    store.setRunRenderMessages(SESSION, [message('p1', 'user'), message('stream-a2', 'assistant')])
    expect(snapshot()?.settledMessageIds).toEqual(new Set(['p1']))
  })

  it('keeps the settled mark apart from the run-start seed', () => {
    // Hydration treats only a run-start seed as the active Run's messages.
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION, { type: 'agent_start', runId: 'run-1', timestamp: 1 })
    store.applyRunRenderEvent(SESSION, {
      type: 'message_start',
      messageId: 'stream-a1',
      role: 'assistant',
      timestamp: 2,
    })
    store.noteRunRenderSnapshotRunSettled(SESSION, 'run-1')
    // A compaction before the next Run starts keeps the settled snapshot.
    store.applyRunRenderEvent(SESSION, {
      type: 'compaction_start',
      reason: 'threshold',
      timestamp: 3,
    })

    expect(snapshot()).not.toHaveProperty('seededByRunId')
    expect(snapshot()).toMatchObject({
      settledRunId: 'run-1',
      settledMessageIds: new Set(['stream-a1']),
    })
  })

  it('reseeds for the next Run although a route wrote the settled snapshot', () => {
    const store = useBackgroundRunStore.getState()
    store.setRunRenderMessages(SESSION, [message('p1', 'user'), message('stream-a1', 'assistant')])
    store.noteRunRenderSnapshotRunSettled(SESSION, 'run-1')
    store.setRunRenderMessages(SESSION, [message('p1', 'user'), message('stream-a1', 'assistant')])
    expect(snapshot()?.settledRunId).toBe('run-1')

    store.applyRunRenderEvent(SESSION, { type: 'agent_start', runId: 'run-2', timestamp: 1 })
    expect(snapshot()).toMatchObject({ messages: [], seededByRunId: 'run-2' })
    expect(snapshot()).not.toHaveProperty('settledRunId')
  })

  it('keeps a snapshot a Run start seeded after the settlement when the refresh ends', () => {
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION, { type: 'agent_start', runId: 'run-1', timestamp: 1 })
    store.noteRunRenderSnapshotRunSettled(SESSION, 'run-1')
    store.applyRunRenderEvent(SESSION, { type: 'agent_start', runId: 'run-2', timestamp: 2 })
    store.clearSettledRunRenderSnapshot(SESSION)

    expect(snapshot()).toMatchObject({ seededByRunId: 'run-2' })
  })

  it('keeps the transcript a route wrote for a Run that started while the refresh was pending', () => {
    const store = useBackgroundRunStore.getState()
    store.setRunRenderMessages(SESSION, [message('p1', 'user'), message('stream-a1', 'assistant')])
    store.noteRunRenderSnapshotRunSettled(SESSION, 'run-1')
    store.applyRunRenderEvent(SESSION, { type: 'agent_start', runId: 'run-2', timestamp: 1 })
    // The route rendering the Session writes its transcript, Run 2's rows included.
    store.setRunRenderMessages(SESSION, [
      message('p1', 'user'),
      message('stream-a1', 'assistant'),
      message('stream-a2', 'assistant'),
    ])
    store.clearSettledRunRenderSnapshot(SESSION)

    expect(snapshot()).toMatchObject({
      messages: [{ id: 'p1' }, { id: 'stream-a1' }, { id: 'stream-a2' }],
      settledMessageIds: new Set(['p1', 'stream-a1']),
    })
  })
})
