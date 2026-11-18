import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunStore } from '../../state/background-run-store'
import { useBackgroundRunMonitor } from '../useBackgroundRunMonitor'

type AgentEventPayload = IpcEventChannelMap['agent:event']['payload']
type AgentEventHandler = (payload: AgentEventPayload) => void

const apiMock = vi.hoisted(() => {
  let agentEventHandler: AgentEventHandler | null = null
  return {
    getAgentEventHandler: () => agentEventHandler,
    getBackgroundRun: vi.fn().mockResolvedValue(null),
    getSessionDetail: vi.fn().mockResolvedValue(null),
    listActiveRuns: vi.fn().mockResolvedValue([]),
    onAgentEvent: vi.fn((handler: AgentEventHandler) => {
      agentEventHandler = handler
      return vi.fn()
    }),
    onRunCompleted: vi.fn(() => vi.fn()),
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getBackgroundRun: apiMock.getBackgroundRun,
    getSessionDetail: apiMock.getSessionDetail,
    listActiveRuns: apiMock.listActiveRuns,
    onAgentEvent: apiMock.onAgentEvent,
    onRunCompleted: apiMock.onRunCompleted,
  },
}))

const SESSION_ID = SessionId('session-retry')
const RUN_MODEL = SupportedModelId('openai/gpt-5')

function emitAgentEvent(event: AgentEventPayload['event']) {
  const handler = apiMock.getAgentEventHandler()
  if (!handler) throw new Error('Expected agent event handler')
  handler({ sessionId: SESSION_ID, event })
}

function failAttemptThatWillRetry() {
  emitAgentEvent({ type: 'agent_start', runId: 'run-1', model: RUN_MODEL, timestamp: 1 })
  emitAgentEvent({
    type: 'agent_end',
    runId: 'run-1',
    reason: 'error',
    willRetry: true,
    model: RUN_MODEL,
    timestamp: 2,
  })
  emitAgentEvent({
    type: 'auto_retry_start',
    attempt: 1,
    maxAttempts: 3,
    delayMs: 2000,
    errorMessage: 'overloaded',
    model: RUN_MODEL,
    timestamp: 3,
  })
}

describe('useBackgroundRunMonitor auto-retry', () => {
  beforeEach(() => {
    useBackgroundRunStore.setState({
      activeRunIds: new Set(),
      runModelBySessionId: new Map(),
      renderSnapshotsBySessionId: new Map(),
    })
  })

  it('keeps the Run and its model while an auto-retry waits', () => {
    const { unmount } = renderHook(() => useBackgroundRunMonitor())

    failAttemptThatWillRetry()

    // Only the attempt ended; the Run continues on the model it started with.
    const state = useBackgroundRunStore.getState()
    expect(state.hasActiveRun(SESSION_ID)).toBe(true)
    expect(state.runModelBySessionId.get(SESSION_ID)).toBe(RUN_MODEL)
    unmount()
  })

  it('forgets the Run when the retry is cancelled', () => {
    const { unmount } = renderHook(() => useBackgroundRunMonitor())

    failAttemptThatWillRetry()
    emitAgentEvent({
      type: 'auto_retry_end',
      success: false,
      attempt: 1,
      cancelled: true,
      model: RUN_MODEL,
      timestamp: 4,
    })

    const state = useBackgroundRunStore.getState()
    expect(state.hasActiveRun(SESSION_ID)).toBe(false)
    expect(state.runModelBySessionId.has(SESSION_ID)).toBe(false)
    unmount()
  })
})
