import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupWorkerTranscript,
  emit,
  emitAssistantText,
  getWorkerTranscriptMocks,
  INITIAL_PROMPT,
  loadWorkerTranscriptHooks,
  MODEL,
  resetWorkerTranscriptState,
  transcriptText,
  workerDetailWithoutRunMessages,
} from './worker-session-transcript.test-harness'

/*
 * Opening a Worker mid-Run used to show just its first message and the current answer: every
 * earlier answer and tool call between them was lost until the Run finished.
 */

const { useAgentChat, useBackgroundRunMonitor } = await loadWorkerTranscriptHooks()
const { apiMock } = getWorkerTranscriptMocks()
const WORKER_ID = workerDetailWithoutRunMessages().id

/** The Worker's whole first Run so far, while nobody has its Session open. */
function emitWorkerRunInBackground() {
  emit({ type: 'agent_start', runId: 'worker-run-1', model: String(MODEL), timestamp: 1 })
  emit({
    type: 'message_start',
    messageId: 'live-user-1',
    role: 'user',
    userMessage: {
      parts: [{ type: 'text', text: INITIAL_PROMPT }],
      sessionNodeCreatedOrder: 2,
    },
    timestamp: 2,
  })
  emitAssistantText('live-assistant-1', 'Reading the store first.', 3)
  emit({
    type: 'message_update',
    messageId: 'live-assistant-1',
    role: 'assistant',
    assistantMessageEvent: {
      type: 'toolcall_start',
      contentIndex: 1,
      toolCallId: 'tool-read-1',
      toolName: 'read',
      input: { path: 'src/store.ts' },
    },
    timestamp: 5,
  })
  emit({ type: 'message_end', messageId: 'live-assistant-1', role: 'assistant', timestamp: 6 })
  emit({
    type: 'tool_execution_start',
    toolCallId: 'tool-read-1',
    toolName: 'read',
    args: { path: 'src/store.ts' },
    timestamp: 7,
  })
  emit({
    type: 'tool_execution_end',
    toolCallId: 'tool-read-1',
    toolName: 'read',
    result: 'export const store = {}',
    isError: false,
    timestamp: 8,
  })
  emitAssistantText('live-assistant-2', 'The cache is never invalidated.', 9)
  emit({ type: 'message_end', messageId: 'live-assistant-2', role: 'assistant', timestamp: 11 })
  emitAssistantText('live-assistant-3', 'Writing the fix', 12)
}

describe('Worker Session transcript opened while its Run continues in the background', () => {
  beforeEach(resetWorkerTranscriptState)
  afterEach(cleanupWorkerTranscript)

  it('shows every answer and tool call the Worker produced before the user opened it', async () => {
    const monitor = renderHook(() => useBackgroundRunMonitor())
    await act(async () => {
      await Promise.resolve()
    })

    act(() => emitWorkerRunInBackground())

    const opened = renderHook(() =>
      useAgentChat(WORKER_ID, workerDetailWithoutRunMessages(), MODEL),
    )

    await waitFor(() => {
      expect(apiMock.getBackgroundRun).toHaveBeenCalledWith(WORKER_ID)
      expect(transcriptText(opened.result.current.messages)).toEqual([
        ['user', INITIAL_PROMPT],
        ['assistant', 'Reading the store first. | tool:read'],
        ['assistant', 'The cache is never invalidated.'],
        ['assistant', 'Writing the fix'],
      ])
    })
    expect(opened.result.current.backgroundStreaming).toBe(true)

    // The opened Worker stays live: the streaming answer keeps growing in place.
    act(() =>
      emit({
        type: 'message_update',
        messageId: 'live-assistant-3',
        role: 'assistant',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' now.' },
        timestamp: 14,
      }),
    )
    await waitFor(() => {
      expect(transcriptText(opened.result.current.messages).at(-1)).toEqual([
        'assistant',
        'Writing the fix now.',
      ])
    })
    expect(transcriptText(opened.result.current.messages)).toHaveLength(4)

    opened.unmount()
    monitor.unmount()
  })
})
