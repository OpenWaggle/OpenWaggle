import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunStore } from '@/features/chat/state'
import { useSessionStatusStore } from '@/features/sessions/state/session-status-store'
import { useSessionStore } from '@/features/sessions/state/session-store'
import { useSessionStatusMonitor } from '../useSessionStatusMonitor'

type RunCompletedHandler = (payload: IpcEventChannelMap['agent:run-completed']['payload']) => void
type AgentEventHandler = (payload: IpcEventChannelMap['agent:event']['payload']) => void
type AgentPhaseHandler = (payload: IpcEventChannelMap['agent:phase']['payload']) => void

const monitorMocks = vi.hoisted(() => {
  let runCompletedHandler: RunCompletedHandler | null = null
  let agentEventHandler: AgentEventHandler | null = null
  let agentPhaseHandler: AgentPhaseHandler | null = null
  const subscribe = vi.fn(() => vi.fn())
  return {
    getRunCompletedHandler: () => runCompletedHandler,
    getAgentEventHandler: () => agentEventHandler,
    getAgentPhaseHandler: () => agentPhaseHandler,
    getSessionDetail: vi.fn(),
    listActiveRuns: vi.fn(),
    onRunCompleted: vi.fn((handler: RunCompletedHandler) => {
      runCompletedHandler = handler
      return vi.fn()
    }),
    onAgentEvent: vi.fn((handler: AgentEventHandler) => {
      agentEventHandler = handler
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
    onAgentEvent: monitorMocks.onAgentEvent,
    onAgentPhase: monitorMocks.onAgentPhase,
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

  it('replaces a synthetic completion with the durable failed Run', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(300)
    useSessionStatusStore.getState().setStatus(SESSION_ID, 'working', 100)
    renderHook(() => useSessionStatusMonitor())

    const handler = monitorMocks.getRunCompletedHandler()
    if (!handler) throw new Error('Expected run completion subscription')
    act(() => handler({ sessionId: SESSION_ID }))
    expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('completed')

    act(() => {
      useSessionStore.setState({
        sessions: [
          {
            id: SESSION_ID,
            title: 'Session A',
            projectPath: '/repo',
            createdAt: 1,
            updatedAt: 200,
            latestRun: { status: 'failed', updatedAt: 200 },
          },
        ],
      })
    })

    await waitFor(() =>
      expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('error'),
    )
  })

  it('orders delayed live signals by their source time, not renderer receipt time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(300)
    renderHook(() => useSessionStatusMonitor())

    const phaseHandler = monitorMocks.getAgentPhaseHandler()
    const eventHandler = monitorMocks.getAgentEventHandler()
    const completedHandler = monitorMocks.getRunCompletedHandler()
    if (!phaseHandler || !eventHandler || !completedHandler) {
      throw new Error('Expected lifecycle subscriptions')
    }

    act(() => {
      phaseHandler({ sessionId: SESSION_ID, phase: { label: 'Thinking', startedAt: 100 } })
      eventHandler({
        sessionId: SESSION_ID,
        event: {
          type: 'message_update',
          timestamp: 110,
          messageId: 'message-a',
          role: 'assistant',
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello' },
        },
      })
      eventHandler({
        sessionId: SESSION_ID,
        event: {
          type: 'tool_execution_start',
          timestamp: 120,
          toolCallId: 'tool-a',
          toolName: 'read',
          args: {},
        },
      })
    })
    expect(useSessionStatusStore.getState().statusUpdatedAt.get(SESSION_ID)).toBe(120)

    act(() => completedHandler({ sessionId: SESSION_ID }))
    act(() => {
      useSessionStore.setState({
        sessions: [
          {
            id: SESSION_ID,
            title: 'Session A',
            projectPath: '/repo',
            createdAt: 1,
            updatedAt: 200,
            latestRun: { status: 'failed', updatedAt: 200 },
          },
        ],
      })
    })

    await waitFor(() =>
      expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('error'),
    )
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
