// @vitest-environment jsdom

import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { AgentTransportEvent } from '@shared/types/stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreCompactionSnapshots } from '../background-run-activity-restore'
import { useBackgroundRunStore } from '../background-run-store'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listActiveRuns: vi.fn(async () => []),
    getBackgroundRun: vi.fn(async () => null),
    getSessionDetail: vi.fn(async () => null),
  },
}))

const SESSION_A = SessionId('session-a')
const SESSION_B = SessionId('session-b')

function userMessage(id: string, content: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', content }], createdAt: new Date(1) }
}

function assistantTextEvent(messageId: string, delta: string): AgentTransportEvent {
  return {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
    timestamp: Date.now(),
  }
}

describe('background run render snapshots seeded by a Run start', () => {
  beforeEach(() => {
    useBackgroundRunStore.setState({
      activeRunIds: new Set(),
      renderSnapshotsBySessionId: new Map(),
    })
  })

  it('seeds a snapshot when a Run starts in a Session no route has rendered', () => {
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION_B, { type: 'agent_start', runId: 'run-1', timestamp: 1 })
    store.applyRunRenderEvent(SESSION_B, {
      type: 'message_start',
      messageId: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
    })
    store.applyRunRenderEvent(SESSION_B, assistantTextEvent('assistant-1', 'First answer'))
    // An auto-retry starts the same Run again; its earlier answers are not persisted yet.
    store.applyRunRenderEvent(SESSION_B, { type: 'agent_start', runId: 'run-1', timestamp: 3 })

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)?.messages).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        parts: [{ type: 'text', content: 'First answer' }],
      }),
    ])

    // The next Run starts after the first one was persisted, so its answers are not kept again.
    store.applyRunRenderEvent(SESSION_B, { type: 'agent_start', runId: 'run-2', timestamp: 4 })

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)).toMatchObject({
      messages: [],
      seededByRunId: 'run-2',
    })
  })

  it('keeps a route-owned snapshot when another Run starts', () => {
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION_A, { type: 'agent_start', runId: 'run-1', timestamp: 1 })
    store.setRunRenderMessages(SESSION_A, [userMessage('user-a', 'Prompt A')])
    store.applyRunRenderEvent(SESSION_A, { type: 'agent_start', runId: 'run-2', timestamp: 2 })

    const snapshot = useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_A)
    expect(snapshot?.messages).toEqual([userMessage('user-a', 'Prompt A')])
    expect(snapshot?.seededByRunId).toBeUndefined()
  })

  it('keeps the answers of a reconnect-announced Run when its real start follows', () => {
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION_B, {
      type: 'agent_start',
      runId: 'remote-snapshot:session-b',
      timestamp: 1,
    })
    store.applyRunRenderEvent(SESSION_B, {
      type: 'message_start',
      messageId: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
    })
    // The Run the reconnect announced retries: the same Run, under its real id.
    store.applyRunRenderEvent(SESSION_B, { type: 'agent_start', runId: 'run-1', timestamp: 3 })

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)).toMatchObject({
      messages: [expect.objectContaining({ id: 'assistant-1' })],
      seededByRunId: 'run-1',
    })
  })

  it('reseeds a reconnect-announced snapshot for the Follow-up after its Run settled', () => {
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION_B, {
      type: 'agent_start',
      runId: 'remote-snapshot:session-b',
      timestamp: 1,
    })
    store.applyRunRenderEvent(SESSION_B, {
      type: 'message_start',
      messageId: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
    })
    store.noteRunRenderSnapshotRunSettled(SESSION_B, 'run-1')
    store.applyRunRenderEvent(SESSION_B, { type: 'agent_start', runId: 'run-2', timestamp: 3 })

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)).toMatchObject({
      messages: [],
      seededByRunId: 'run-2',
    })
  })

  it('stops treating a snapshot as seeded once a route renders the Session', () => {
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION_B, { type: 'agent_start', runId: 'run-1', timestamp: 1 })
    store.setRunRenderMessages(SESSION_B, [userMessage('user-b', 'Prompt B')])

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)).not.toHaveProperty(
      'seededByRunId',
    )
  })

  it('does not publish a new state for an event that changes nothing it renders', () => {
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION_B, { type: 'agent_start', runId: 'run-1', timestamp: 1 })
    const before = useBackgroundRunStore.getState().renderSnapshotsBySessionId

    store.applyRunRenderEvent(SESSION_B, { type: 'turn_start', turnIndex: 0, timestamp: 2 })
    store.applyRunRenderEvent(SESSION_B, { type: 'agent_start', runId: 'run-1', timestamp: 3 })
    store.applyRunRenderEvent(SESSION_A, assistantTextEvent('assistant-a', 'No snapshot'))

    expect(useBackgroundRunStore.getState().renderSnapshotsBySessionId).toBe(before)
  })

  it('reseeds a route-owned snapshot for the next Run once its Run settled', () => {
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION_A, { type: 'agent_start', runId: 'run-1', timestamp: 1 })
    store.setRunRenderMessages(SESSION_A, [userMessage('user-a', 'Prompt A')])
    store.noteRunRenderSnapshotRunSettled(SESSION_A, 'run-1')
    store.applyRunRenderEvent(SESSION_A, { type: 'agent_start', runId: 'run-2', timestamp: 2 })

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_A)).toMatchObject({
      messages: [],
      seededByRunId: 'run-2',
    })
  })

  it('reseeds after a settlement that names no Run', () => {
    const store = useBackgroundRunStore.getState()
    store.setRunRenderMessages(SESSION_A, [userMessage('user-a', 'Prompt A')])
    store.noteRunRenderSnapshotRunSettled(SESSION_A, undefined)
    store.applyRunRenderEvent(SESSION_A, { type: 'agent_start', runId: 'run-2', timestamp: 2 })

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_A)).toMatchObject({
      messages: [],
      seededByRunId: 'run-2',
    })
  })

  it('keeps the seed of a Run that started before the previous Run settlement arrived', () => {
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION_B, { type: 'agent_start', runId: 'run-2', timestamp: 1 })
    store.applyRunRenderEvent(SESSION_B, {
      type: 'message_start',
      messageId: 'assistant-2',
      role: 'assistant',
      timestamp: 2,
    })
    store.noteRunRenderSnapshotRunSettled(SESSION_B, 'run-1')
    store.clearSettledRunRenderSnapshot(SESSION_B)

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)).toMatchObject({
      messages: [expect.objectContaining({ id: 'assistant-2' })],
      seededByRunId: 'run-2',
    })
  })

  it('clears the snapshot of the settled Run, route-owned or seeded, after its refresh', () => {
    const store = useBackgroundRunStore.getState()
    store.setRunRenderMessages(SESSION_A, [userMessage('user-a', 'Prompt A')])
    store.noteRunRenderSnapshotRunSettled(SESSION_A, 'run-a')
    store.applyRunRenderEvent(SESSION_B, { type: 'agent_start', runId: 'run-1', timestamp: 1 })
    store.noteRunRenderSnapshotRunSettled(SESSION_B, 'run-1')
    store.clearSettledRunRenderSnapshot(SESSION_A)
    store.clearSettledRunRenderSnapshot(SESSION_B)

    expect(useBackgroundRunStore.getState().renderSnapshotsBySessionId.size).toBe(0)
  })

  it('keeps a snapshot a reconnect announced after the settled Run while it refreshes', () => {
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION_B, { type: 'agent_start', runId: 'run-1', timestamp: 1 })
    store.noteRunRenderSnapshotRunSettled(SESSION_B, 'run-1')
    store.applyRunRenderEvent(SESSION_B, {
      type: 'agent_start',
      runId: 'remote-snapshot:session-b',
      timestamp: 2,
    })
    store.clearSettledRunRenderSnapshot(SESSION_B)

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)).toMatchObject({
      messages: [],
      seededByRunId: 'remote-snapshot:session-b',
    })
  })

  it('reseeds when a reconnect announces a Run while the seed names another Run', () => {
    // The bridge announces only a Run it did not know was active, so a seed naming a real Run is
    // an earlier Run, persisted by then.
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION_B, { type: 'agent_start', runId: 'run-0', timestamp: 1 })
    store.applyRunRenderEvent(SESSION_B, {
      type: 'message_start',
      messageId: 'assistant-0',
      role: 'assistant',
      timestamp: 2,
    })
    store.applyRunRenderEvent(SESSION_B, {
      type: 'agent_start',
      runId: 'remote-snapshot:session-b',
      timestamp: 3,
    })

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)).toMatchObject({
      messages: [],
      seededByRunId: 'remote-snapshot:session-b',
    })
  })

  it('seeds a compaction with no snapshot for its Run, which keeps it under the real start', () => {
    const store = useBackgroundRunStore.getState()
    store.applyRunRenderEvent(SESSION_B, {
      type: 'compaction_start',
      reason: 'threshold',
      timestamp: 1,
    })
    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)).toMatchObject({
      messages: [],
      seededByRunId: 'unnamed-run',
    })
    store.applyRunRenderEvent(SESSION_B, {
      type: 'message_start',
      messageId: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
    })
    store.applyRunRenderEvent(SESSION_B, { type: 'agent_start', runId: 'run-1', timestamp: 3 })

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)).toMatchObject({
      messages: [expect.objectContaining({ id: 'assistant-1' })],
      seededByRunId: 'run-1',
    })
  })

  it('seeds the snapshots it restores for activities already in progress', () => {
    const snapshots = restoreCompactionSnapshots(
      { renderSnapshotsBySessionId: new Map() },
      [
        {
          activity: 'compaction',
          sessionId: SESSION_A,
          model: SupportedModelId('model'),
          reason: 'manual',
          startedAt: 1,
        },
      ],
      [
        {
          activity: 'agent-run',
          sessionId: SESSION_B,
          model: SupportedModelId('model'),
          mode: 'classic',
          startedAt: 1,
          activityEvents: [{ type: 'compaction_start', reason: 'threshold', timestamp: 2 }],
        },
      ],
    )

    expect(snapshots.get(SESSION_A)).toMatchObject({ seededByRunId: 'unnamed-run' })
    expect(snapshots.get(SESSION_B)).toMatchObject({ seededByRunId: 'unnamed-run' })
  })
})
