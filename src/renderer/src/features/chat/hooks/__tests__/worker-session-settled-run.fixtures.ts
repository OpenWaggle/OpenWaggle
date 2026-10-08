import type { Message } from '@shared/types/agent'
import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { MessageId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import {
  emit,
  emitAssistantText,
  getWorkerTranscriptMocks,
  loadWorkerTranscriptHooks,
  MODEL,
  settle,
  transcriptText,
  WORKER_ID,
  workerDetailWithoutRunMessages,
  workerReconnectBuffer,
  workerRunRenderSnapshot,
} from './worker-session-transcript.test-harness'

/**
 * Fixtures for a Worker the user opens during Run 1, whose Run 2 follows once Run 1 settled. Run 1
 * is then persisted under Pi entry ids its stream ids never match.
 */

const { useAgentChat } = await loadWorkerTranscriptHooks()
const { apiMock, chatStoreMock } = getWorkerTranscriptMocks()

export function persistedMessage(
  id: string,
  role: Message['role'],
  text: string,
  order: number,
): Message {
  return {
    id: MessageId(id),
    role,
    parts: [{ type: 'text', text }],
    createdAt: order,
    metadata: { sessionNodeCreatedOrder: order },
  }
}

/** Everything before Run 1. */
export const EARLIER_HISTORY: readonly Message[] = [
  persistedMessage('p1', 'user', 'Earlier prompt', 1),
  persistedMessage('pa1', 'assistant', 'Earlier answer', 2),
]

/** Run 1, persisted under its Pi entry ids once it settled. */
export const RUN_1_PERSISTED: readonly Message[] = [
  persistedMessage('n-u1', 'user', 'Run 1 prompt', 3),
  persistedMessage('n-a1', 'assistant', 'done R1', 4),
]

export const EXPECTED_TRANSCRIPT = [
  ['user', 'Earlier prompt'],
  ['assistant', 'Earlier answer'],
  ['user', 'Run 1 prompt'],
  ['assistant', 'done R1'],
  ['user', 'Run 2 prompt'],
  ['assistant', 'R2 working'],
]

export function workerDetail(messages: readonly Message[], updatedAt = 1): SessionDetail {
  return { ...workerDetailWithoutRunMessages(), updatedAt, messages: [...messages] }
}

export function emitUserMessage(messageId: string, text: string, order: number, timestamp: number) {
  emit({
    type: 'message_start',
    messageId,
    role: 'user',
    userMessage: { parts: [{ type: 'text', text }], sessionNodeCreatedOrder: order },
    timestamp,
  })
}

export function runBuffer(input: {
  readonly userMessageId: string
  readonly prompt: string
  readonly order: number
  readonly assistantMessageId: string
  readonly answer: string
}): BackgroundRunSnapshot {
  return {
    ...workerReconnectBuffer(),
    messageId: input.assistantMessageId,
    parts: [{ type: 'text', text: input.answer }],
    userMessages: [
      {
        messageId: input.userMessageId,
        parts: [{ type: 'text', text: input.prompt }],
        sessionNodeCreatedOrder: input.order,
        timestamp: input.order,
      },
    ],
  }
}

export const RUN_1_BUFFER = runBuffer({
  userMessageId: 'live-u1',
  prompt: 'Run 1 prompt',
  order: 3,
  assistantMessageId: 'stream-a1',
  answer: 'done',
})

export const RUN_2_BUFFER = runBuffer({
  userMessageId: 'live-u2',
  prompt: 'Run 2 prompt',
  order: 5,
  assistantMessageId: 'stream-a2',
  answer: 'R2 working',
})

/** Opens the Worker while Run 1 streams: its route renders it and owns the snapshot. */
export async function openWorkerMidRun1() {
  apiMock.getSessionDetail.mockResolvedValue(workerDetail(EARLIER_HISTORY))
  apiMock.getBackgroundRun.mockResolvedValue(RUN_1_BUFFER)
  act(() => {
    emit({ type: 'agent_start', runId: 'run-1', model: String(MODEL), timestamp: 10 })
    emitUserMessage('live-u1', 'Run 1 prompt', 3, 11)
    emitAssistantText('stream-a1', 'done', 12)
  })
  const opened = renderHook(
    ({ session }: { readonly session: SessionDetail }) => useAgentChat(WORKER_ID, session, MODEL),
    { initialProps: { session: workerDetail(EARLIER_HISTORY) } },
  )
  await waitFor(() => {
    expect(transcriptText(opened.result.current.messages)).toEqual([
      ['user', 'Earlier prompt'],
      ['assistant', 'Earlier answer'],
      ['user', 'Run 1 prompt'],
      ['assistant', 'done'],
    ])
  })
  await settle()
  expect(workerRunRenderSnapshot()).not.toHaveProperty('seededByRunId')
  return opened
}

/** Opens the Worker while Run 1 streams, then leaves it: the snapshot is route-owned. */
export async function openWorkerMidRun1ThenLeave() {
  const opened = await openWorkerMidRun1()
  opened.unmount()
}

export function finishRun1() {
  emit({
    type: 'message_update',
    messageId: 'stream-a1',
    role: 'assistant',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' R1' },
    timestamp: 14,
  })
  emit({ type: 'message_end', messageId: 'stream-a1', role: 'assistant', timestamp: 15 })
  emit({ type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 16 })
}

export function streamRun2() {
  emit({ type: 'agent_start', runId: 'run-2', model: String(MODEL), timestamp: 20 })
  emitUserMessage('live-u2', 'Run 2 prompt', 5, 21)
  emitAssistantText('stream-a2', 'R2 working', 22)
}

export async function reopenMidRun2() {
  const persisted = workerDetail([...EARLIER_HISTORY, ...RUN_1_PERSISTED], 2)
  apiMock.getSessionDetail.mockResolvedValue(persisted)
  apiMock.getBackgroundRun.mockResolvedValue(RUN_2_BUFFER)
  const reopened = renderHook(() => useAgentChat(WORKER_ID, persisted, MODEL))
  await waitFor(() => {
    expect(apiMock.getBackgroundRun).toHaveBeenLastCalledWith(WORKER_ID)
    expect(transcriptText(reopened.result.current.messages)).toEqual(EXPECTED_TRANSCRIPT)
  })
  await settle()
  expect(transcriptText(reopened.result.current.messages)).toEqual(EXPECTED_TRANSCRIPT)
  expectUniqueIds(reopened.result.current.messages)
  return reopened
}

export function expectUniqueIds(messages: readonly UIMessage[]) {
  const ids = messages.map((message) => message.id)
  expect(new Set(ids).size).toBe(ids.length)
}

export function deferRefresh() {
  const pending = { finish: () => {} }
  chatStoreMock.refreshSession.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        pending.finish = resolve
      }),
  )
  return pending
}
