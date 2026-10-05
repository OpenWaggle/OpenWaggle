import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAgentLoopEventStore } from '../../state/agent-loop-event-store'
import {
  cleanupWorkerTranscript,
  emit,
  emitAssistantText,
  getWorkerTranscriptMocks,
  INITIAL_PROMPT,
  loadWorkerTranscriptHooks,
  MODEL,
  resetWorkerTranscriptState,
  settle,
  transcriptText,
  WORKER_ID,
  workerDetailWithoutRunMessages,
  workerReconnectBuffer,
  workerRunRenderSnapshot,
} from './worker-session-transcript.test-harness'

/*
 * The chat route reuses one chat hook across Sessions. Switching from a Session streaming in the
 * background to a Worker whose detail is not cached yet renders no Session while it loads, and the
 * earlier Session's background streaming state used to stay set then. The Worker's events in that
 * window wrote the route's empty transcript over the Worker's run-start seed, losing every answer
 * it had streamed before the user opened it.
 */

const { useAgentChat, useBackgroundRunMonitor } = await loadWorkerTranscriptHooks()
const { apiMock } = getWorkerTranscriptMocks()

const OTHER_ID = SessionId('other-session')
const OTHER_DETAIL: SessionDetail = { ...workerDetailWithoutRunMessages(), id: OTHER_ID }

function emitForOtherSession(event: Parameters<typeof emit>[0]) {
  useAgentLoopEventStore.getState().applyEvent(OTHER_ID, event)
  for (const handler of [...apiMock.agentEventHandlers]) handler({ sessionId: OTHER_ID, event })
}

function emitWorkerRunInBackground() {
  emit({ type: 'agent_start', runId: 'worker-run-1', model: String(MODEL), timestamp: 1 })
  emit({
    type: 'message_start',
    messageId: 'live-user-1',
    role: 'user',
    userMessage: { parts: [{ type: 'text', text: INITIAL_PROMPT }], sessionNodeCreatedOrder: 2 },
    timestamp: 2,
  })
  emitAssistantText('live-assistant-1', 'Reading the store first.', 3)
  emit({ type: 'message_end', messageId: 'live-assistant-1', role: 'assistant', timestamp: 5 })
  emitAssistantText('live-assistant-2', 'The cache is never invalidated.', 6)
  emit({ type: 'message_end', messageId: 'live-assistant-2', role: 'assistant', timestamp: 8 })
  emitAssistantText('live-assistant-3', 'Writing the fix', 9)
}

interface ChatProps {
  readonly sessionId: SessionId
  readonly session: SessionDetail | null
}

describe('Worker Session transcript opened from another running Session', () => {
  beforeEach(resetWorkerTranscriptState)
  afterEach(cleanupWorkerTranscript)

  it('keeps the Worker answers streamed before it was opened while its detail loads', async () => {
    apiMock.getBackgroundRun.mockImplementation(async (sessionId: string) =>
      sessionId === WORKER_ID ? workerReconnectBuffer() : null,
    )
    const monitor = renderHook(() => useBackgroundRunMonitor())
    await settle()
    act(() => emitWorkerRunInBackground())

    // The user watches another Session streaming in the background.
    act(() =>
      emitForOtherSession({
        type: 'agent_start',
        runId: 'other-run',
        model: String(MODEL),
        timestamp: 1,
      }),
    )
    const chat = renderHook(
      ({ sessionId, session }: ChatProps) => useAgentChat(sessionId, session, MODEL),
      { initialProps: { sessionId: OTHER_ID, session: OTHER_DETAIL } },
    )
    await waitFor(() => expect(chat.result.current.backgroundStreaming).toBe(true))

    // The user opens the Worker; its detail is not cached, so no Session renders while it loads.
    chat.rerender({ sessionId: WORKER_ID, session: null })
    act(() =>
      emit({
        type: 'message_update',
        messageId: 'live-assistant-3',
        role: 'assistant',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' now.' },
        timestamp: 12,
      }),
    )
    expect(workerRunRenderSnapshot()).toMatchObject({
      seededByRunId: 'worker-run-1',
      messages: [{ id: 'live-user-1' }, {}, {}, { id: 'live-assistant-3' }],
    })

    chat.rerender({ sessionId: WORKER_ID, session: workerDetailWithoutRunMessages() })
    await waitFor(() => {
      expect(apiMock.getBackgroundRun).toHaveBeenCalledWith(WORKER_ID)
      expect(transcriptText(chat.result.current.messages)).toEqual([
        ['user', INITIAL_PROMPT],
        ['assistant', 'Reading the store first.'],
        ['assistant', 'The cache is never invalidated.'],
        ['assistant', 'Writing the fix now.'],
      ])
    })
    await settle()
    expect(transcriptText(chat.result.current.messages)).toHaveLength(4)

    chat.unmount()
    monitor.unmount()
  })
})
