import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import type { SessionQueryResponse } from '@shared/types/session-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state/session-status-store'
import { useSessionStore } from '@/features/sessions/state/session-store'
import { useSessionStatusMonitor } from '../useSessionStatusMonitor'

type AgentEventHandler = (payload: IpcEventChannelMap['agent:event']['payload']) => void

const monitorMocks = vi.hoisted(() => {
  let eventHandler: AgentEventHandler | null = null
  return {
    getEventHandler: () => eventHandler,
    listActiveRuns: vi.fn(),
    querySessionControl: vi.fn(),
    onAgentEvent: vi.fn((handler: AgentEventHandler) => {
      eventHandler = handler
      return vi.fn()
    }),
    subscribe: vi.fn(() => vi.fn()),
    updateSessionTreeUiState: vi.fn(),
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listActiveRuns: monitorMocks.listActiveRuns,
    querySessionControl: monitorMocks.querySessionControl,
    onAgentEvent: monitorMocks.onAgentEvent,
    onAgentPhase: monitorMocks.subscribe,
    onRunCompleted: monitorMocks.subscribe,
    onWaggleTurnEvent: monitorMocks.subscribe,
    onWorktreeLaunch: monitorMocks.subscribe,
    updateSessionTreeUiState: monitorMocks.updateSessionTreeUiState,
  },
}))

const SESSION_ID = SessionId('session-multiple-interactions')

function interaction(id: string, createdAt: number): AgentLoopInteraction {
  return {
    interactionId: id,
    sessionId: SESSION_ID,
    runId: 'run-a',
    kind: 'input',
    source: 'pi-ui',
    createdAt,
    title: `Question ${id}`,
  }
}

function pendingResponse(requests: readonly AgentLoopInteraction[]) {
  return {
    contractVersion: 2 as const,
    requestId: 'pending-interactions',
    outcome: { operation: 'requests-list' as const, sessionId: SESSION_ID, requests },
  }
}

function emitRequest(handler: AgentEventHandler, value: AgentLoopInteraction) {
  handler({
    sessionId: SESSION_ID,
    event: { type: 'agent_interaction_request', timestamp: value.createdAt, interaction: value },
  })
}

function emitResolution(handler: AgentEventHandler, interactionId: string, timestamp: number) {
  handler({
    sessionId: SESSION_ID,
    event: {
      type: 'agent_interaction_resolved',
      timestamp,
      runId: 'run-a',
      interactionId,
      kind: 'input',
      status: 'resolved',
      response: { kind: 'input', value: 'answer' },
    },
  })
}

describe('Session status with concurrent interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    monitorMocks.listActiveRuns.mockResolvedValue([])
    monitorMocks.updateSessionTreeUiState.mockResolvedValue(undefined)
    useSessionStore.setState({ sessions: [] })
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      statusUpdatedAt: new Map(),
      lastVisitedAt: new Map(),
      phases: new Map(),
    })
  })

  it('stays Awaiting input until the final non-notify request resolves', async () => {
    const first = interaction('first', 100)
    const second = interaction('second', 110)
    monitorMocks.querySessionControl
      .mockResolvedValueOnce(pendingResponse([second]))
      .mockResolvedValueOnce(pendingResponse([]))
    renderHook(() => useSessionStatusMonitor())
    const handler = monitorMocks.getEventHandler()
    if (!handler) throw new Error('Expected agent event subscription')

    act(() => {
      emitRequest(handler, first)
      emitRequest(handler, second)
      emitResolution(handler, first.interactionId, 150)
    })
    expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('awaiting-input')
    await waitFor(() => expect(monitorMocks.querySessionControl).toHaveBeenCalledTimes(1))
    expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('awaiting-input')

    act(() =>
      handler({
        sessionId: SESSION_ID,
        event: {
          type: 'tool_execution_start',
          timestamp: 155,
          toolCallId: 'other-tool',
          toolName: 'read',
          args: {},
        },
      }),
    )
    expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('awaiting-input')

    act(() => emitResolution(handler, second.interactionId, 160))
    await waitFor(() =>
      expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('working'),
    )
    expect(monitorMocks.querySessionControl).toHaveBeenCalledTimes(2)
  })

  it('ignores a late response from the earlier resolution after the final one clears', async () => {
    const first = interaction('first', 100)
    const second = interaction('second', 110)
    const delayed = Promise.withResolvers<SessionQueryResponse>()
    monitorMocks.querySessionControl
      .mockReturnValueOnce(delayed.promise)
      .mockResolvedValueOnce(pendingResponse([]))
    renderHook(() => useSessionStatusMonitor())
    const handler = monitorMocks.getEventHandler()
    if (!handler) throw new Error('Expected agent event subscription')

    act(() => {
      emitRequest(handler, first)
      emitRequest(handler, second)
      emitResolution(handler, first.interactionId, 150)
      emitResolution(handler, second.interactionId, 160)
    })
    await waitFor(() =>
      expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('working'),
    )

    await act(async () => delayed.resolve(pendingResponse([second])))
    expect(useSessionStatusStore.getState().getStatus(SESSION_ID)).toBe('working')
  })
})
