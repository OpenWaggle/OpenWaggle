import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunStore } from '../../state/background-run-store'
import { useFirstSendPendingStore } from '../../state/first-send-pending-store'
import { useRunFinishingStore } from '../../state/run-finishing-store'
import { useBackgroundRunMonitor } from '../useBackgroundRunMonitor'

type AgentEventPayload = IpcEventChannelMap['agent:event']['payload']
type AgentEventHandler = (payload: AgentEventPayload) => void
type RunCompletedHandler = (payload: IpcEventChannelMap['agent:run-completed']['payload']) => void

const apiMock = vi.hoisted(() => {
  let agentEventHandler: AgentEventHandler | null = null
  let runCompletedHandler: RunCompletedHandler | null = null
  return {
    getAgentEventHandler: () => agentEventHandler,
    getRunCompletedHandler: () => runCompletedHandler,
    getBackgroundRun: vi.fn().mockResolvedValue(null),
    getSessionDetail: vi.fn().mockResolvedValue(null),
    listActiveRuns: vi.fn().mockResolvedValue([]),
    onAgentEvent: vi.fn((handler: AgentEventHandler) => {
      agentEventHandler = handler
      return vi.fn()
    }),
    onRunCompleted: vi.fn((handler: RunCompletedHandler) => {
      runCompletedHandler = handler
      return vi.fn()
    }),
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

const SESSION_ID = SessionId('session-lost-start')
const RUN_MODEL = SupportedModelId('openai/gpt-5')

function emitAgentEvent(event: AgentEventPayload['event']) {
  const handler = apiMock.getAgentEventHandler()
  if (!handler) throw new Error('Expected agent event handler')
  handler({ sessionId: SESSION_ID, event })
}

/*
 * Whether the renderer shows a Session as running used to rest on one event, the Run's
 * `agent_start`. A Session another agent launched streamed its whole Run into a chat that showed
 * nothing, because that start never reached the renderer: the Run was active on the Host, its
 * events kept arriving, and the chat hydrated it as idle from a transcript the Run had not saved
 * yet. A message or tool execution starting or updating now tells the renderer the Run is active;
 * the end events that can follow the Run's last `agent_end` do not.
 */
describe('useBackgroundRunMonitor without the Run start', () => {
  beforeEach(() => {
    useBackgroundRunStore.setState({
      activeRunIds: new Set(),
      runModelBySessionId: new Map(),
      renderSnapshotsBySessionId: new Map(),
      unannouncedRunNotices: new Map(),
    })
  })

  it('takes a Run it streams as active when its start never arrived', () => {
    const { unmount } = renderHook(() => useBackgroundRunMonitor())

    emitAgentEvent({
      type: 'message_update',
      messageId: 'answer-7',
      role: 'assistant',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Reading the store' },
      model: RUN_MODEL,
      timestamp: 5,
    })

    const state = useBackgroundRunStore.getState()
    expect(state.hasActiveRun(SESSION_ID)).toBe(true)
    expect(state.runModelBySessionId.get(SESSION_ID)).toBe(RUN_MODEL)
    // The chat showing the Session hydrates it again, as running.
    expect(state.unannouncedRunNotices.get(SESSION_ID)).toBe(1)
    unmount()
  })

  it('ends the first send’s "Starting session" when its Run streams without a start', () => {
    useFirstSendPendingStore.getState().mark(SESSION_ID)
    const { unmount } = renderHook(() => useBackgroundRunMonitor())

    emitAgentEvent({
      type: 'message_start',
      messageId: 'answer-1',
      role: 'assistant',
      timestamp: 1,
    })

    expect(useFirstSendPendingStore.getState().ids.has(SESSION_ID)).toBe(false)
    unmount()
  })

  // The Run before ended into a queued Follow-up whose start was lost: the new Run is not finishing.
  it('ends the Run before’s finishing when the next Run streams without a start', () => {
    const { unmount } = renderHook(() => useBackgroundRunMonitor())
    emitAgentEvent({ type: 'agent_start', runId: 'run-1', timestamp: 1 })
    emitAgentEvent({ type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 2 })
    expect(useRunFinishingStore.getState().ids.has(SESSION_ID)).toBe(true)

    emitAgentEvent({
      type: 'message_start',
      messageId: 'answer-2',
      role: 'assistant',
      timestamp: 3,
    })

    expect(useRunFinishingStore.getState().ids.has(SESSION_ID)).toBe(false)
    unmount()
  })

  it('does not take a Hive wake or a tool update for a Run streaming', () => {
    const { unmount } = renderHook(() => useBackgroundRunMonitor())

    emitAgentEvent({
      type: 'message_start',
      messageId: 'custom-1',
      role: 'user',
      userMessage: { parts: [], sessionNodeCreatedOrder: 4, hiveWake: true },
      timestamp: 1,
    })
    emitAgentEvent({
      type: 'tool_execution_update',
      toolCallId: 'tool-1',
      toolName: 'bash',
      args: {},
      partialResult: { content: [] },
      timestamp: 2,
    })

    expect(useBackgroundRunStore.getState().hasActiveRun(SESSION_ID)).toBe(false)
    unmount()
  })

  it('notices a Run once, not for every event it streams', () => {
    const { unmount } = renderHook(() => useBackgroundRunMonitor())

    emitAgentEvent({
      type: 'message_start',
      messageId: 'answer-1',
      role: 'assistant',
      timestamp: 1,
    })
    emitAgentEvent({
      type: 'message_start',
      messageId: 'answer-2',
      role: 'assistant',
      timestamp: 2,
    })

    expect(useBackgroundRunStore.getState().unannouncedRunNotices.get(SESSION_ID)).toBe(1)
    unmount()
  })

  it('notices a Run that streams while only a manual compaction was active', () => {
    const { unmount } = renderHook(() => useBackgroundRunMonitor())

    emitAgentEvent({ type: 'compaction_start', reason: 'manual', timestamp: 1 })
    expect(useBackgroundRunStore.getState().unannouncedRunNotices.get(SESSION_ID)).toBeUndefined()
    emitAgentEvent({
      type: 'message_start',
      messageId: 'answer-1',
      role: 'assistant',
      timestamp: 2,
    })

    expect(useBackgroundRunStore.getState().unannouncedRunNotices.get(SESSION_ID)).toBe(1)
    unmount()
  })

  it.each([
    { type: 'message_start', messageId: 'answer-8', role: 'assistant', timestamp: 6 },
    {
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'bash',
      args: { command: 'ls' },
      timestamp: 6,
    },
  ] satisfies AgentEventPayload['event'][])('takes a $type as a Run streaming', (event) => {
    const { unmount } = renderHook(() => useBackgroundRunMonitor())

    emitAgentEvent(event)

    expect(useBackgroundRunStore.getState().hasActiveRun(SESSION_ID)).toBe(true)
    unmount()
  })

  it('does not take what a Run sends as it ends for another Run starting', () => {
    const { unmount } = renderHook(() => useBackgroundRunMonitor())

    emitAgentEvent({ type: 'agent_start', runId: 'run-1', model: RUN_MODEL, timestamp: 1 })
    emitAgentEvent({
      type: 'agent_end',
      runId: 'run-1',
      reason: 'stop',
      model: RUN_MODEL,
      timestamp: 2,
    })
    emitAgentEvent({ type: 'message_end', messageId: 'answer-1', role: 'assistant', timestamp: 2 })
    emitAgentEvent({ type: 'context_usage', tokens: 10, contextWindow: 100, timestamp: 2 })

    expect(useBackgroundRunStore.getState().hasActiveRun(SESSION_ID)).toBe(false)
    unmount()
  })

  it('forgets the Run it took as streaming when the Run settles', () => {
    const { unmount } = renderHook(() => useBackgroundRunMonitor())

    emitAgentEvent({
      type: 'message_start',
      messageId: 'answer-9',
      role: 'assistant',
      timestamp: 7,
    })
    apiMock.getRunCompletedHandler()?.({ sessionId: SESSION_ID, runId: 'run-2' })

    expect(useBackgroundRunStore.getState().hasActiveRun(SESSION_ID)).toBe(false)
    unmount()
  })
})
