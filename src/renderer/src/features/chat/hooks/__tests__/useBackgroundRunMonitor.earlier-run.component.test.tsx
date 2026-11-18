import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunMonitor } from '@/features/chat/hooks/useBackgroundRunMonitor'
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store'
import { useRunFinishingStore } from '@/features/chat/state/run-finishing-store'

type AgentEventPayload = IpcEventChannelMap['agent:event']['payload']
type CompletedPayload = IpcEventChannelMap['agent:run-completed']['payload']

const h = vi.hoisted(() => {
  const state: {
    onEvent: ((p: AgentEventPayload) => void) | null
    onCompleted: ((p: CompletedPayload) => void) | null
  } = { onEvent: null, onCompleted: null }
  return {
    state,
    refreshSession: vi.fn(() => Promise.resolve()),
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getBackgroundRun: vi.fn().mockResolvedValue(null),
    getSessionDetail: vi.fn().mockResolvedValue(null),
    listActiveRuns: vi.fn().mockResolvedValue([]),
    onAgentEvent: vi.fn((handler: (p: AgentEventPayload) => void) => {
      h.state.onEvent = handler
      return vi.fn()
    }),
    onRunCompleted: vi.fn((handler: (p: CompletedPayload) => void) => {
      h.state.onCompleted = handler
      return vi.fn()
    }),
  },
}))

vi.mock('@/features/chat/state/chat-store', () => ({
  useChatStore: (select: (s: { refreshSession: typeof h.refreshSession }) => unknown) =>
    select({ refreshSession: h.refreshSession }),
}))

const SESSION = SessionId('session-earlier-run')
const MODEL = SupportedModelId('openai/gpt-5')

function emit(event: AgentEventPayload['event']) {
  h.state.onEvent?.({ sessionId: SESSION, event })
}
function complete(payload: Omit<CompletedPayload, 'sessionId'>) {
  h.state.onCompleted?.({ sessionId: SESSION, ...payload })
}
function finishing() {
  return useRunFinishingStore.getState().ids.has(SESSION)
}

describe('useBackgroundRunMonitor settling a Run that started before the last one', () => {
  beforeEach(() => {
    h.refreshSession.mockClear()
    useRunFinishingStore.setState({ ids: new Set() })
    useBackgroundRunStore.setState({
      activeRunIds: new Set(),
      runModelBySessionId: new Map(),
      renderSnapshotsBySessionId: new Map(),
    })
  })

  it('settles the Session when the classic Run behind an agent-requested Waggle settles', async () => {
    const { unmount } = renderHook(() => useBackgroundRunMonitor())
    emit({ type: 'agent_start', runId: 'run-1', model: MODEL, timestamp: 1 })
    emit({ type: 'message_start', messageId: 'a1', role: 'assistant', timestamp: 2 })
    emit({ type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 3 })
    // The Waggle an agent requested streams under the classic Run's id with a prefix.
    emit({ type: 'agent_start', runId: 'waggle-of-run-1', timestamp: 4 })
    emit({ type: 'message_start', messageId: 'w1', role: 'assistant', timestamp: 5 })
    emit({ type: 'agent_end', runId: 'waggle-of-run-1', reason: 'stop', timestamp: 6 })
    // The Host settles the classic Run's session_runs row: runId run-1.
    complete({ runId: 'run-1', terminalStatus: 'completed' })
    await Promise.resolve()
    await Promise.resolve()

    expect(finishing()).toBe(false)
    unmount()
  })

  it('settles the Session when a Run that failed before Pi started settles', async () => {
    const { unmount } = renderHook(() => useBackgroundRunMonitor())
    emit({ type: 'agent_start', runId: 'run-1', model: MODEL, timestamp: 1 })
    emit({ type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 2 })
    complete({ runId: 'run-1', terminalStatus: 'completed' })
    await Promise.resolve()
    expect(finishing()).toBe(false)

    // A Run that fails before Pi starts publishes agent_end only, then settles.
    emit({
      type: 'agent_end',
      runId: 'run-2',
      reason: 'error',
      error: { message: 'invalid model', code: 'invalid-model' },
      timestamp: 3,
    })
    complete({ runId: 'run-2', terminalStatus: 'failed' })
    await Promise.resolve()
    await Promise.resolve()

    expect(finishing()).toBe(false)
    unmount()
  })
})
