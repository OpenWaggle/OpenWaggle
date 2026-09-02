import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunStore } from '@/features/chat/state'
import { useSessionStatusStore } from '@/features/sessions/state/session-status-store'
import { useSessionStore } from '@/features/sessions/state/session-store'
import { useSessionStatusMonitor } from '../useSessionStatusMonitor'

type RunCompletedHandler = (payload: IpcEventChannelMap['agent:run-completed']['payload']) => void

const monitorMocks = vi.hoisted(() => {
  let runCompletedHandler: RunCompletedHandler | null = null
  const subscribe = vi.fn(() => vi.fn())
  return {
    getRunCompletedHandler: () => runCompletedHandler,
    getSessionDetail: vi.fn(),
    listActiveRuns: vi.fn(),
    onRunCompleted: vi.fn((handler: RunCompletedHandler) => {
      runCompletedHandler = handler
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
    onAgentPhase: monitorMocks.subscribe,
    onRunCompleted: monitorMocks.onRunCompleted,
    onWaggleTurnEvent: monitorMocks.subscribe,
    onWorktreeLaunch: monitorMocks.subscribe,
    querySessionControl: monitorMocks.querySessionControl,
    updateSessionTreeUiState: monitorMocks.updateSessionTreeUiState,
  },
}))

const SESSION_ID = SessionId('session-a')

describe('useSessionStatusMonitor', () => {
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

  it('removes retained first-send contents after terminal durable delivery', async () => {
    monitorMocks.getSessionDetail.mockResolvedValue({
      id: SESSION_ID,
      title: 'Session A',
      projectPath: '/repo',
      messages: [
        {
          id: MessageId('message-a'),
          role: 'user',
          parts: [{ type: 'text', text: 'Delivered prompt' }],
          createdAt: 3,
        },
      ],
      createdAt: 1,
      updatedAt: 3,
      environmentMode: 'worktree',
    })
    useBackgroundRunStore.getState().setWorktreeLaunch(SESSION_ID, {
      status: 'complete',
      stage: 'starting-task',
      startedAt: 1,
      updatedAt: 2,
      details: ['Starting task'],
    })
    useBackgroundRunStore.getState().setFirstSendRecovery(SESSION_ID, {
      payload: { text: 'Retained prompt', thinkingLevel: 'medium', attachments: [] },
      waggleConfig: null,
      model: SupportedModelId('openai/gpt-5'),
    })
    renderHook(() => useSessionStatusMonitor())

    const handler = monitorMocks.getRunCompletedHandler()
    if (!handler) throw new Error('Expected run completion subscription')
    act(() => handler({ sessionId: SESSION_ID }))

    await waitFor(() => {
      expect(useBackgroundRunStore.getState().getWorktreeLaunch(SESSION_ID)).toBeNull()
      expect(useBackgroundRunStore.getState().firstSendRecoveryBySessionId.has(SESSION_ID)).toBe(
        false,
      )
    })
  })

  it('hydrates every active Run and pending interaction after a new window misses broadcasts', async () => {
    const runs = Array.from({ length: 101 }, (_value, index) => ({
      sessionId: SessionId(`session-${String(index)}`),
      model: SupportedModelId('openai/gpt-5'),
      mode: 'classic' as const,
      startedAt: index + 1,
    }))
    const lastRun = runs.at(-1)
    if (!lastRun) throw new Error('Expected an active Run fixture')
    monitorMocks.listActiveRuns.mockResolvedValue(runs)
    monitorMocks.querySessionControl.mockImplementation(async (request) => ({
      contractVersion: 2,
      requestId: request.requestId,
      outcome: {
        operation: 'requests-list' as const,
        sessionId: request.query.sessionId,
        requests:
          request.query.sessionId === lastRun.sessionId
            ? [
                {
                  interactionId: 'pending-last-page',
                  sessionId: lastRun.sessionId,
                  runId: 'run-last-page',
                  kind: 'input' as const,
                  source: 'pi-ui' as const,
                  createdAt: 1_000,
                  title: 'Input needed',
                },
              ]
            : [],
      },
    }))

    const firstWindow = renderHook(() => useSessionStatusMonitor())

    await waitFor(() => {
      expect(useSessionStatusStore.getState().statuses.get(lastRun.sessionId)).toBe(
        'awaiting-input',
      )
    })
    const firstRun = runs[0]
    if (!firstRun) throw new Error('Expected an active Run fixture')
    expect(useSessionStatusStore.getState().statuses.get(firstRun.sessionId)).toBe('working')
    expect(monitorMocks.querySessionControl).toHaveBeenCalledTimes(101)

    firstWindow.unmount()
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      statusUpdatedAt: new Map(),
      lastVisitedAt: new Map(),
      phases: new Map(),
    })
    renderHook(() => useSessionStatusMonitor())

    await waitFor(() => {
      expect(useSessionStatusStore.getState().statuses.get(lastRun.sessionId)).toBe(
        'awaiting-input',
      )
    })
  })
})
