import type { BackgroundRunAssistantMessage } from '@shared/types/background-run'
import { durableSessionRunId } from '../domain/session-control/root-session-project-reach'
import { type ActiveStreamBuffer, isMessageCutShort } from './stream-buffer-snapshots'

/*
 * The Run's finished assistant messages a stream buffer keeps beside the one streaming: a Run's
 * messages are persisted only when it ends, so a reconnect (a renderer reload) has nothing else to
 * show them from. This history has its own byte budgets, apart from the live content's, so it never
 * crowds out the message streaming now in its Session or any other: the oldest messages go first,
 * and a reload shows their persisted copies when the Run ends, as before.
 */

/** The history one buffer keeps. */
export const MAX_RUN_HISTORY_BYTES = 1024 * 1024
/**
 * The history all buffers keep. With the live content's 6 MiB, the snapshots stay within the
 * Local Session protocol's 8 MiB frame.
 */
export const MAX_TOTAL_RUN_HISTORY_BYTES = 1.5 * 1024 * 1024

const JSON_ARRAY_BRACKETS_BYTES = 2
const JSON_ARRAY_SEPARATOR_BYTES = 1

/** The JSON size of an array of entries this size each. */
function arrayBytes(entryBytes: readonly number[]) {
  if (entryBytes.length === 0) return 0
  const entries = entryBytes.reduce((total, bytes) => total + bytes, 0)
  return JSON_ARRAY_BRACKETS_BYTES + entries + (entryBytes.length - 1) * JSON_ARRAY_SEPARATOR_BYTES
}

function messageBytes(message: BackgroundRunAssistantMessage) {
  return Buffer.byteLength(JSON.stringify(message), 'utf8')
}

/** The bytes a buffer's history holds. */
export function runHistoryBytes(history: { readonly assistantMessageBytes?: readonly number[] }) {
  return arrayBytes(history.assistantMessageBytes ?? [])
}

/**
 * The newest of `messages` (each `bytes[i]` long) that fit in `budget`, oldest evicted first; none
 * when the newest alone does not fit.
 */
function newestThatFit(
  messages: readonly BackgroundRunAssistantMessage[],
  bytes: readonly number[],
  budget: number,
) {
  let first = 0
  while (first < messages.length && arrayBytes(bytes.slice(first)) > budget) first += 1
  return { assistantMessages: messages.slice(first), assistantMessageBytes: bytes.slice(first) }
}

function withHistory(
  buffer: ActiveStreamBuffer,
  history: {
    readonly assistantMessages: readonly BackgroundRunAssistantMessage[]
    readonly assistantMessageBytes: readonly number[]
  },
): ActiveStreamBuffer {
  const { assistantMessages: _messages, assistantMessageBytes: _bytes, ...rest } = buffer
  return history.assistantMessages.length > 0 ? { ...rest, ...history } : rest
}

/**
 * The buffer with the assistant message it streamed added to its history as the next one starts,
 * and the change to the history bytes of all buffers (`totalHistoryBytes` before it). One the
 * live caps cut short is left out, as is one larger than the budget left to this buffer.
 */
export function retainFinishedAssistantMessage(
  buffer: ActiveStreamBuffer,
  totalHistoryBytes: number,
) {
  const { messageId } = buffer
  const cutShort = isMessageCutShort(buffer)
  const existing = buffer.assistantMessages ?? []
  const unchanged = { buffer, historyDelta: 0 }
  if (messageId === undefined || buffer.parts.length === 0 || cutShort) return unchanged
  if (existing.some((message) => message.messageId === messageId)) return unchanged
  const message: BackgroundRunAssistantMessage = {
    messageId,
    timestamp: buffer.messageStartedAt ?? buffer.startedAt,
    parts: [...buffer.parts],
  }
  const before = runHistoryBytes(buffer)
  const budget = Math.min(
    MAX_RUN_HISTORY_BYTES,
    MAX_TOTAL_RUN_HISTORY_BYTES - (totalHistoryBytes - before),
  )
  const bytes = messageBytes(message)
  if (arrayBytes([bytes]) > budget) return unchanged
  const history = newestThatFit(
    [...existing, message],
    [...(buffer.assistantMessageBytes ?? []), bytes],
    budget,
  )
  const next = withHistory(buffer, history)
  return { buffer: next, historyDelta: runHistoryBytes(next) - before }
}

/** A snapshot's history, the newest messages that fit what the restored buffers left. */
export function restoreRunHistory(
  messages: readonly BackgroundRunAssistantMessage[],
  totalHistoryBytes: number,
) {
  const budget = Math.min(MAX_RUN_HISTORY_BYTES, MAX_TOTAL_RUN_HISTORY_BYTES - totalHistoryBytes)
  const history = newestThatFit(messages, messages.map(messageBytes), budget)
  return history.assistantMessages.length > 0 ? history : {}
}

/**
 * What the buffer a Run starts keeps from the one before when it goes on with that Run: a Waggle
 * the agent requested (`waggle-of-<X>`) streams on in X, which is persisted only when it ends. Its
 * start, user messages and history (the message it streamed last included) stay; none for another
 * Run. The user messages count toward the live bytes, the history toward its own.
 */
export function continuedRunContent(
  previous: ActiveStreamBuffer | undefined,
  runId: string | undefined,
  totalHistoryBytes: number,
): Partial<ActiveStreamBuffer> {
  if (!previous?.runId || !runId || previous.runId === runId) return {}
  if (durableSessionRunId(previous.runId) !== durableSessionRunId(runId)) return {}
  const finished = retainFinishedAssistantMessage(previous, totalHistoryBytes).buffer
  const { startedAt, assistantMessages, assistantMessageBytes, userMessages, userMessagesBytes } =
    finished
  return {
    startedAt,
    ...(assistantMessages && assistantMessageBytes
      ? { assistantMessages, assistantMessageBytes }
      : {}),
    ...(userMessages ? { userMessages, userMessagesBytes: userMessagesBytes ?? 0 } : {}),
  }
}
