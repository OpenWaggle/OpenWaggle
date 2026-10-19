import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunStore } from '../../state/background-run-store'
import { useExtensionStatusStore } from '../../state/extension-status-store'
import {
  FINISHING_STOP_OFFER_DELAY_MS,
  useRunFinishingStore,
} from '../../state/run-finishing-store'
import { useBackgroundRunMonitor } from '../useBackgroundRunMonitor'

type AgentEventPayload = IpcEventChannelMap['agent:event']['payload']
type AgentEventHandler = (payload: AgentEventPayload) => void

const apiMock = vi.hoisted(() => {
  let agentEventHandler: AgentEventHandler | null = null
  let runCompletedHandler:
    | ((payload: { sessionId: typeof SESSION_ID; runId?: string; continues?: true }) => void)
    | null = null
  return {
    getAgentEventHandler: () => agentEventHandler,
    getRunCompletedHandler: () => runCompletedHandler,
    getBackgroundRun: vi.fn().mockResolvedValue(null),
    getSessionDetail: vi.fn().mockResolvedValue(null),
    listActiveRuns: vi.fn(),
    onAgentEvent: vi.fn((handler: AgentEventHandler) => {
      agentEventHandler = handler
      return vi.fn()
    }),
    onRunCompleted: vi.fn(
      (
        handler: (payload: {
          sessionId: typeof SESSION_ID
          runId?: string
          continues?: true
        }) => void,
      ) => {
        runCompletedHandler = handler
        return vi.fn()
      },
    ),
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

const SESSION_ID = SessionId('session-1')
const OTHER_SESSION_ID = SessionId('session-2')

function emitAgentEvent(event: AgentEventPayload['event']) {
  const handler = apiMock.getAgentEventHandler()
  if (!handler) throw new Error('Expected agent event handler')
  handler({ sessionId: SESSION_ID, event })
}

describe('useBackgroundRunMonitor compaction lifecycle', () => {
  beforeEach(() => {
    apiMock.listActiveRuns.mockReset()
    apiMock.getBackgroundRun.mockReset().mockResolvedValue(null)
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

  it('restores a manual compaction across remount and settles it on completion', async () => {
    apiMock.listActiveRuns.mockResolvedValue([
      {
        activity: 'compaction',
        sessionId: SESSION_ID,
        model: SupportedModelId('openai/gpt-5.4'),
        reason: 'manual',
        startedAt: 7,
      },
    ])

    const { unmount } = renderHook(() => useBackgroundRunMonitor())

    await vi.waitFor(() => {
      expect(useBackgroundRunStore.getState().hasActiveRun(SESSION_ID)).toBe(true)
      expect(
        useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_ID)?.compactionStatus,
      ).toMatchObject({
        type: 'compacting',
        reason: 'manual',
        timeline: [{ id: '7:0', phase: 'running' }],
      })
    })

    act(() => apiMock.getRunCompletedHandler()?.({ sessionId: SESSION_ID }))

    expect(useBackgroundRunStore.getState().hasActiveRun(SESSION_ID)).toBe(false)
    unmount()
  })

  it('does not resurrect a compaction completed while initialization is pending', async () => {
    let finishBackgroundRunRead: (() => void) | undefined
    apiMock.listActiveRuns.mockResolvedValue([
      {
        activity: 'compaction',
        sessionId: SESSION_ID,
        model: SupportedModelId('openai/gpt-5.4'),
        reason: 'manual',
        startedAt: 7,
      },
      {
        activity: 'agent-run',
        sessionId: OTHER_SESSION_ID,
        model: SupportedModelId('openai/gpt-5.4'),
        mode: 'classic',
        startedAt: 8,
      },
    ])
    apiMock.getBackgroundRun.mockReturnValue(
      new Promise((resolve) => {
        finishBackgroundRunRead = () => resolve(null)
      }),
    )
    const { unmount } = renderHook(() => useBackgroundRunMonitor())
    await vi.waitFor(() => expect(apiMock.getBackgroundRun).toHaveBeenCalled())

    act(() => apiMock.getRunCompletedHandler()?.({ sessionId: SESSION_ID }))
    await act(async () => finishBackgroundRunRead?.())

    await vi.waitFor(() => {
      expect(useBackgroundRunStore.getState().hasActiveRun(SESSION_ID)).toBe(false)
      expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_ID)).toBeNull()
    })
    unmount()
  })
})

describe('useBackgroundRunMonitor finishing Runs', () => {
  beforeEach(() => {
    apiMock.listActiveRuns.mockReset().mockResolvedValue([])
    apiMock.getBackgroundRun.mockReset().mockResolvedValue(null)
    useRunFinishingStore.setState({ ids: new Set(), stoppableIds: new Set() })
    useExtensionStatusStore.setState({ bySessionId: new Map() })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function completeRun(payload: { readonly runId?: string; readonly continues?: true }) {
    const handler = apiMock.getRunCompletedHandler()
    if (!handler) throw new Error('Expected run-completed handler')
    handler({ sessionId: SESSION_ID, ...payload })
  }

  // The Session is finishing from the agent's terminal agent_end until the Host settles the Run.
  it('marks a Session finishing from its terminal agent_end until the Run settles', () => {
    const { unmount } = renderHook(() => useBackgroundRunMonitor())
    const isFinishing = () => useRunFinishingStore.getState().ids.has(SESSION_ID)

    emitAgentEvent({ type: 'agent_start', runId: 'run-1', timestamp: 1 })
    emitAgentEvent({
      type: 'agent_end',
      runId: 'run-1',
      reason: 'error',
      willRetry: true,
      timestamp: 2,
    })
    expect(isFinishing()).toBe(false)

    emitAgentEvent({ type: 'agent_end', runId: 'run-1', reason: 'error', timestamp: 3 })
    expect(isFinishing()).toBe(true)

    // The Host went straight on to a Follow-up: still finishing until that Run starts.
    completeRun({ continues: true })
    expect(isFinishing()).toBe(true)
    emitAgentEvent({ type: 'agent_start', runId: 'run-2', timestamp: 4 })
    expect(isFinishing()).toBe(false)

    emitAgentEvent({ type: 'agent_end', runId: 'run-2', reason: 'stop', timestamp: 5 })
    expect(isFinishing()).toBe(true)
    completeRun({})
    expect(isFinishing()).toBe(false)
    unmount()
  })

  /*
   * gosafe's club-hooks extension runs a lint and type-check gate in agent_before_settle: the chat
   * sat on "Finishing..." for minutes with no word of why and no way to stop it.
   */
  it('offers Stop and shows extension status while Pi still works after the agent ended', () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useBackgroundRunMonitor())
    const isStoppable = () => useRunFinishingStore.getState().stoppableIds.has(SESSION_ID)
    const statusTexts = () =>
      useExtensionStatusStore
        .getState()
        .bySessionId.get(SESSION_ID)
        ?.statuses.map((line) => line.text)

    emitAgentEvent({ type: 'agent_start', runId: 'run-1', timestamp: 1 })
    emitAgentEvent({ type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 2 })
    emitAgentEvent({
      type: 'extension_status',
      runId: 'run-1',
      slot: { kind: 'status', key: 'club-hooks' },
      text: 'TypeScript hooks: lint, type-check, tests',
      timestamp: 3,
    })
    expect(statusTexts()).toEqual(['TypeScript hooks: lint, type-check, tests'])
    // Pi's post-loop work usually settles at once; Stop does not flash up for it.
    expect(isStoppable()).toBe(false)

    act(() => {
      vi.advanceTimersByTime(FINISHING_STOP_OFFER_DELAY_MS)
    })
    expect(isStoppable()).toBe(true)

    // Pi settled the agent's work: only the Host's own settlement is left, nothing to stop.
    emitAgentEvent({ type: 'agent_settled', runId: 'run-1', aborted: true, timestamp: 4 })
    expect(isStoppable()).toBe(false)
    expect(useRunFinishingStore.getState().ids.has(SESSION_ID)).toBe(true)

    completeRun({ runId: 'run-1' })
    expect(statusTexts()).toBeUndefined()
    unmount()
  })
})
