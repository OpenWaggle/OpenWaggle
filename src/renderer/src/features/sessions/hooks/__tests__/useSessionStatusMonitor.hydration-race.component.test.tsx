import type { ActiveRunInfo } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import type { SessionQueryResponse } from '@shared/types/session-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunStore } from '@/features/chat/state'
import { useSessionStatusStore } from '@/features/sessions/state/session-status-store'
import { useSessionStore } from '@/features/sessions/state/session-store'
import { useSessionStatusMonitor } from '../useSessionStatusMonitor'

type RunCompletedHandler = (payload: IpcEventChannelMap['agent:run-completed']['payload']) => void
type AgentPhaseHandler = (payload: IpcEventChannelMap['agent:phase']['payload']) => void

const monitorMocks = vi.hoisted(() => {
  let runCompletedHandler: RunCompletedHandler | null = null
  let agentPhaseHandler: AgentPhaseHandler | null = null
  const subscribe = vi.fn(() => vi.fn())
  return {
    getRunCompletedHandler: () => runCompletedHandler,
    getAgentPhaseHandler: () => agentPhaseHandler,
    getSessionDetail: vi.fn(),
    listActiveRuns: vi.fn(),
    onRunCompleted: vi.fn((handler: RunCompletedHandler) => {
      runCompletedHandler = handler
      return vi.fn()
    }),
    onAgentPhase: vi.fn((handler: AgentPhaseHandler) => {
      agentPhaseHandler = handler
      return vi.fn()
    }),
    querySessionControl: vi.fn(),
    subscribe,
    updateSessionTreeUiState: vi.fn(),
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSessionDetail: monitorMocks.getSessionDetail,
    listActiveRuns: monitorMocks.listActiveRuns,
    onAgentEvent: monitorMocks.subscribe,
    onAgentPhase: monitorMocks.onAgentPhase,
    onRunCompleted: monitorMocks.onRunCompleted,
    onWaggleTurnEvent: monitorMocks.subscribe,
    onWorktreeLaunch: monitorMocks.subscribe,
    querySessionControl: monitorMocks.querySessionControl,
    updateSessionTreeUiState: monitorMocks.updateSessionTreeUiState,
  },
}))

const SESSION_ID = SessionId('session-a')

describe('useSessionStatusMonitor hydration race', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    monitorMocks.listActiveRuns.mockResolvedValue([])
    monitorMocks.querySessionControl.mockResolvedValue({
      contractVersion: 2,
      requestId: 'empty',
      outcome: { operation: 'requests-list', sessionId: SESSION_ID, requests: [] },
    })
    monitorMocks.updateSessionTreeUiState.mockResolvedValue(undefined)
    useBackgroundRunStore.setState({
      activeRunIds: new Set(),
      renderSnapshotsBySessionId: new Map(),
      worktreeLaunchBySessionId: new Map(),
      firstSendRecoveryBySessionId: new Map(),
    })
    useSessionStore.setState({ sessions: [] })
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      statusUpdatedAt: new Map(),
      lastVisitedAt: new Map(),
      phases: new Map(),
    })
  })

  it('does not revive a completed Waggle Run from a late active-Run snapshot', async () => {
    const pendingRuns = Promise.withResolvers<ActiveRunInfo[]>()
    monitorMocks.listActiveRuns.mockReturnValue(pendingRuns.promise)
    useSessionStatusStore.getState().setStatus(SESSION_ID, 'working', 100)
    renderHook(() => useSessionStatusMonitor())

    const completedHandler = monitorMocks.getRunCompletedHandler()
    const phaseHandler = monitorMocks.getAgentPhaseHandler()
    if (!completedHandler || !phaseHandler) throw new Error('Expected lifecycle subscriptions')
    act(() => completedHandler({ sessionId: SESSION_ID }))
    act(() => {
      useSessionStore.setState({
        sessions: [
          {
            id: SESSION_ID,
            title: 'Session A',
            projectPath: '/repo',
            createdAt: 1,
            updatedAt: 100,
            latestRun: { status: 'completed', updatedAt: 100 },
          },
        ],
      })
    })
    expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('completed')

    await act(async () => {
      pendingRuns.resolve([
        {
          activity: 'agent-run',
          sessionId: SESSION_ID,
          model: SupportedModelId('openai/gpt-5'),
          mode: 'waggle',
          startedAt: 100,
          activityEvents: [],
        },
      ])
    })
    expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('completed')

    act(() => phaseHandler({ sessionId: SESSION_ID, phase: { label: 'Thinking', startedAt: 200 } }))
    expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('working')
  })

  it('does not revive a completed Run from a late pending-interaction snapshot', async () => {
    const pendingInteraction = Promise.withResolvers<SessionQueryResponse>()
    monitorMocks.listActiveRuns.mockResolvedValue([
      {
        activity: 'agent-run',
        sessionId: SESSION_ID,
        model: SupportedModelId('openai/gpt-5'),
        mode: 'classic',
        startedAt: 100,
        activityEvents: [],
      },
    ])
    monitorMocks.querySessionControl.mockReturnValue(pendingInteraction.promise)
    renderHook(() => useSessionStatusMonitor())
    await waitFor(() => expect(monitorMocks.querySessionControl).toHaveBeenCalledTimes(1))

    const completedHandler = monitorMocks.getRunCompletedHandler()
    if (!completedHandler) throw new Error('Expected completion subscription')
    act(() => completedHandler({ sessionId: SESSION_ID }))
    expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('completed')

    await act(async () => {
      pendingInteraction.resolve({
        contractVersion: 2,
        requestId: 'late-interaction',
        outcome: {
          operation: 'requests-list',
          sessionId: SESSION_ID,
          requests: [
            {
              interactionId: 'stale-input',
              sessionId: SESSION_ID,
              runId: 'old-run',
              kind: 'input',
              source: 'pi-ui',
              createdAt: 150,
              title: 'Already resolved',
            },
          ],
        },
      })
    })
    expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('completed')
  })
})
