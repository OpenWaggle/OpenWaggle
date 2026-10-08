import type { Message } from '@shared/types/agent'
import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { MessageId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupWorkerTranscript,
  completeRun,
  emit,
  emitAssistantText,
  getWorkerTranscriptMocks,
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
 * A Worker's later Run seeds a snapshot holding only that Run's messages; the earlier Runs are
 * persisted under their Session node ids. A repeated prompt ("continue") used to take the place of
 * the first one, putting this Run's answers above the previous Run's.
 */

const { useAgentChat, useBackgroundRunMonitor } = await loadWorkerTranscriptHooks()
const { apiMock, chatStoreMock } = getWorkerTranscriptMocks()

const REPEATED_PROMPT = 'continue'

function persistedMessage(id: string, role: Message['role'], text: string, order: number): Message {
  return {
    id: MessageId(id),
    role,
    parts: [{ type: 'text', text }],
    createdAt: order,
    metadata: { sessionNodeCreatedOrder: order },
  }
}

/** The Worker's first Run, persisted under its Session node ids when it ended. */
const RUN_1_PERSISTED: readonly Message[] = [
  persistedMessage('node-user-1', 'user', REPEATED_PROMPT, 1),
  persistedMessage('node-assistant-1', 'assistant', 'Run 1 answer.', 2),
]

/** Run 2, persisted once it ended. */
const RUN_2_PERSISTED: readonly Message[] = [
  persistedMessage('node-user-2', 'user', REPEATED_PROMPT, 5),
  persistedMessage('node-assistant-2', 'assistant', 'Reading the store first.', 6),
  persistedMessage('node-assistant-3', 'assistant', 'The cache is never invalidated.', 7),
  persistedMessage('node-assistant-4', 'assistant', 'Writing the fix', 8),
]

function workerDetail(messages: readonly Message[], updatedAt = 1): SessionDetail {
  return { ...workerDetailWithoutRunMessages(), updatedAt, messages: [...messages] }
}

/** The Worker's second Run, which repeats the first Run's prompt text. */
function emitSecondRunInBackground(options: { readonly compactAfterFirstAnswer?: boolean } = {}) {
  emit({ type: 'agent_start', runId: 'worker-run-2', model: String(MODEL), timestamp: 20 })
  emit({
    type: 'message_start',
    messageId: 'live-user-2',
    role: 'user',
    userMessage: { parts: [{ type: 'text', text: REPEATED_PROMPT }], sessionNodeCreatedOrder: 5 },
    timestamp: 21,
  })
  emitAssistantText('live-assistant-1', 'Reading the store first.', 22)
  emit({ type: 'message_end', messageId: 'live-assistant-1', role: 'assistant', timestamp: 24 })
  if (options.compactAfterFirstAnswer) {
    emit({ type: 'compaction_start', reason: 'threshold', timestamp: 25 })
    emit({
      type: 'compaction_end',
      reason: 'threshold',
      result: { entryId: 'node-summary-1' },
      aborted: false,
      willRetry: false,
      timestamp: 26,
    })
  }
  emitAssistantText('live-assistant-2', 'The cache is never invalidated.', 27)
  emit({ type: 'message_end', messageId: 'live-assistant-2', role: 'assistant', timestamp: 29 })
  emitAssistantText('live-assistant-3', 'Writing the fix', 30)
}

function secondRunReconnectBuffer(): BackgroundRunSnapshot {
  return {
    ...workerReconnectBuffer(),
    startedAt: 20,
    userMessages: [
      {
        messageId: 'live-user-2',
        parts: [{ type: 'text', text: REPEATED_PROMPT }],
        sessionNodeCreatedOrder: 5,
        timestamp: 21,
      },
    ],
  }
}

const SECOND_RUN_TRANSCRIPT = [
  ['user', REPEATED_PROMPT],
  ['assistant', 'Run 1 answer.'],
  ['user', REPEATED_PROMPT],
  ['assistant', 'Reading the store first.'],
  ['assistant', 'The cache is never invalidated.'],
  ['assistant', 'Writing the fix'],
]

function expectUniqueIds(messages: readonly UIMessage[]) {
  const ids = messages.map((message) => message.id)
  expect(new Set(ids).size).toBe(ids.length)
}

describe('Worker Session transcript of a later Run opened in the background', () => {
  beforeEach(resetWorkerTranscriptState)
  afterEach(cleanupWorkerTranscript)

  it('shows a second Run that repeats the prompt of the first below the first Run', async () => {
    apiMock.getSessionDetail.mockResolvedValue(workerDetail(RUN_1_PERSISTED))
    apiMock.getBackgroundRun.mockResolvedValue(secondRunReconnectBuffer())
    const monitor = renderHook(() => useBackgroundRunMonitor())
    await settle()

    act(() => emitSecondRunInBackground())
    const opened = renderHook(() => useAgentChat(WORKER_ID, workerDetail(RUN_1_PERSISTED), MODEL))

    await waitFor(() => {
      expect(apiMock.getBackgroundRun).toHaveBeenCalledWith(WORKER_ID)
      expect(transcriptText(opened.result.current.messages)).toEqual(SECOND_RUN_TRANSCRIPT)
    })
    await settle()
    expect(transcriptText(opened.result.current.messages)).toEqual(SECOND_RUN_TRANSCRIPT)
    expectUniqueIds(opened.result.current.messages)

    opened.unmount()
    monitor.unmount()
  })

  it('shows each message once after the Run ends and its persisted transcript loads', async () => {
    apiMock.getSessionDetail.mockResolvedValue(workerDetail(RUN_1_PERSISTED))
    apiMock.getBackgroundRun.mockResolvedValue(secondRunReconnectBuffer())
    const monitor = renderHook(() => useBackgroundRunMonitor())
    await settle()
    act(() => emitSecondRunInBackground())
    const opened = renderHook(
      ({ session }: { readonly session: SessionDetail }) => useAgentChat(WORKER_ID, session, MODEL),
      { initialProps: { session: workerDetail(RUN_1_PERSISTED) } },
    )
    await waitFor(() => {
      expect(transcriptText(opened.result.current.messages)).toEqual(SECOND_RUN_TRANSCRIPT)
    })

    const persisted = workerDetail([...RUN_1_PERSISTED, ...RUN_2_PERSISTED], 2)
    apiMock.getSessionDetail.mockResolvedValue(persisted)
    apiMock.getBackgroundRun.mockResolvedValue(null)
    await act(async () => {
      emit({ type: 'message_end', messageId: 'live-assistant-3', role: 'assistant', timestamp: 31 })
      emit({ type: 'agent_end', runId: 'worker-run-2', reason: 'stop', timestamp: 32 })
      completeRun('worker-run-2')
      await Promise.resolve()
    })
    opened.rerender({ session: persisted })

    await waitFor(() => {
      expect(chatStoreMock.refreshSession).toHaveBeenCalledWith(WORKER_ID)
      expect(workerRunRenderSnapshot()).toBeNull()
      expect(opened.result.current.backgroundStreaming).toBe(false)
      expect(transcriptText(opened.result.current.messages)).toEqual(SECOND_RUN_TRANSCRIPT)
    })
    expectUniqueIds(opened.result.current.messages)

    opened.unmount()
    monitor.unmount()
  })

  it('keeps the seeded snapshot of a Run that starts while the last refresh is pending', async () => {
    let finishRefresh = () => {}
    chatStoreMock.refreshSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
        }),
    )
    apiMock.getSessionDetail.mockResolvedValue(workerDetail(RUN_1_PERSISTED))
    apiMock.getBackgroundRun.mockResolvedValue(secondRunReconnectBuffer())
    const monitor = renderHook(() => useBackgroundRunMonitor())
    await settle()

    act(() => {
      emit({ type: 'agent_start', runId: 'worker-run-1', model: String(MODEL), timestamp: 1 })
      emit({ type: 'agent_end', runId: 'worker-run-1', reason: 'stop', timestamp: 2 })
      completeRun('worker-run-1')
    })
    expect(chatStoreMock.refreshSession).toHaveBeenCalledWith(WORKER_ID)
    act(() => emitSecondRunInBackground())
    await act(async () => {
      finishRefresh()
      await Promise.resolve()
    })

    expect(workerRunRenderSnapshot()).toMatchObject({
      seededByRunId: 'worker-run-2',
    })
    const opened = renderHook(() => useAgentChat(WORKER_ID, workerDetail(RUN_1_PERSISTED), MODEL))
    await waitFor(() => {
      expect(transcriptText(opened.result.current.messages)).toEqual(SECOND_RUN_TRANSCRIPT)
    })

    opened.unmount()
    monitor.unmount()
  })

  it('anchors a compaction that ran while the Worker was hidden after its earlier history', async () => {
    apiMock.getSessionDetail.mockResolvedValue(workerDetail(RUN_1_PERSISTED))
    apiMock.getBackgroundRun.mockResolvedValue(secondRunReconnectBuffer())
    const monitor = renderHook(() => useBackgroundRunMonitor())
    await settle()

    act(() => emitSecondRunInBackground({ compactAfterFirstAnswer: true }))
    const opened = renderHook(() => useAgentChat(WORKER_ID, workerDetail(RUN_1_PERSISTED), MODEL))

    await waitFor(() => {
      expect(transcriptText(opened.result.current.messages)).toEqual(SECOND_RUN_TRANSCRIPT)
      // After Run 1's two persisted messages and the Run's prompt and first answer.
      expect(opened.result.current.compactionStatus).toMatchObject({
        type: 'completed',
        timeline: [{ messageCountAtStart: RUN_1_PERSISTED.length + 2 }],
      })
    })

    opened.unmount()
    monitor.unmount()
  })
})
