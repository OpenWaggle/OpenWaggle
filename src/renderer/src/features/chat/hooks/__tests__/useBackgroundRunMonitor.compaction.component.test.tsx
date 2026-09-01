import { SessionId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import { act, renderHook } from '@testing-library/react'
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
    listActiveRuns: vi.fn(),
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
    listActiveRuns: apiMock.listActiveRuns,
    onAgentEvent: apiMock.onAgentEvent,
    onRunCompleted: apiMock.onRunCompleted,
  },
}))

const SESSION_ID = SessionId('session-1')

function emitAgentEvent(event: AgentEventPayload['event']) {
  const handler = apiMock.getAgentEventHandler()
  if (!handler) throw new Error('Expected agent event handler')
  handler({ sessionId: SESSION_ID, event })
}

describe('useBackgroundRunMonitor compaction lifecycle', () => {
  beforeEach(() => {
    apiMock.listActiveRuns.mockReset()
    useBackgroundRunStore.setState({
      activeRunIds: new Set(),
      renderSnapshotsBySessionId: new Map(),
      worktreeLaunchBySessionId: new Map(),
      firstSendRecoveryBySessionId: new Map(),
    })
  })

  it('does not end an initialized agent run when automatic compaction finishes', async () => {
    let resolveActiveRuns: ((runs: Array<{ sessionId: typeof SESSION_ID }>) => void) | undefined
    apiMock.listActiveRuns.mockReturnValue(
      new Promise<Array<{ sessionId: typeof SESSION_ID }>>((resolve) => {
        resolveActiveRuns = resolve
      }),
    )
    const { unmount } = renderHook(() => useBackgroundRunMonitor())

    emitAgentEvent({ type: 'compaction_start', reason: 'threshold', timestamp: 1 })
    expect(useBackgroundRunStore.getState().hasActiveRun(SESSION_ID)).toBe(true)

    await act(async () => resolveActiveRuns?.([{ sessionId: SESSION_ID }]))
    emitAgentEvent({
      type: 'compaction_end',
      reason: 'threshold',
      result: {},
      timestamp: 2,
      aborted: false,
      willRetry: false,
    })

    expect(useBackgroundRunStore.getState().hasActiveRun(SESSION_ID)).toBe(true)
    unmount()
  })
})
