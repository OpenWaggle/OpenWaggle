import type { MessagePart } from '@shared/types/agent'
import type { BackgroundRunSnapshot, BackgroundRunUserMessage } from '@shared/types/background-run'
import { ToolCallId } from '@shared/types/brand'
import type { AgentAssistantMessageEvent, AgentTransportEvent } from '@shared/types/stream'
import { MODEL, SESSION_ID } from './transcript-order.persisted'

/*
 * The reconnect stream buffer as `src/main/utils/stream-buffer.ts` keeps it: the Run it belongs to,
 * the user messages the Run incorporated (each with the answer it followed), the answers it
 * finished, and the answer streaming now. Every Run starts it empty; an auto-retry of the same Run
 * keeps it.
 */

export function emptyBuffer(runId: string, startedAt: number): BackgroundRunSnapshot {
  return {
    activity: 'agent-run',
    sessionId: SESSION_ID,
    runId,
    model: MODEL,
    mode: runId.startsWith('waggle-') ? 'waggle' : 'classic',
    startedAt,
    activityEvents: [],
    parts: [],
  }
}

function appendText(parts: readonly MessagePart[], delta: string, contentIndex: number) {
  const last = parts.at(-1)
  if (last?.type === 'text') return [...parts.slice(0, -1), { ...last, text: last.text + delta }]
  return [...parts, { type: 'text' as const, text: delta, contentIndex }]
}

function withToolCall(parts: readonly MessagePart[], toolCallId: string): MessagePart[] {
  const has = parts.some((part) => part.type === 'tool-call' && part.toolCall.id === toolCallId)
  if (has) return [...parts]
  return [
    ...parts,
    { type: 'tool-call', toolCall: { id: ToolCallId(toolCallId), name: 'bash', args: {} } },
  ]
}

/**
 * An answer's event as `src/main/utils/stream-buffer.ts` keeps it, split as the live view splits
 * it: a thought opens at its start and takes its own deltas, text goes on in the last text part,
 * each named by its content block.
 */
function withAssistantEvent(parts: readonly MessagePart[], event: AgentAssistantMessageEvent) {
  if (event.type === 'thinking_start') return withReasoning(parts, event.contentIndex, '')
  if (event.type === 'thinking_delta') return withReasoning(parts, event.contentIndex, event.delta)
  if (event.type === 'text_delta') return appendText(parts, event.delta, event.contentIndex)
  if (event.type === 'toolcall_start') return withToolCall(parts, event.toolCallId)
  return [...parts]
}

function withReasoning(parts: readonly MessagePart[], contentIndex: number, delta: string) {
  const index = parts.findIndex(
    (part) => part.type === 'reasoning' && part.contentIndex === contentIndex,
  )
  const part = parts[index]
  if (part?.type !== 'reasoning')
    return [...parts, { type: 'reasoning' as const, text: delta, contentIndex }]
  return parts.map((other, at) => (at === index ? { ...part, text: part.text + delta } : other))
}

/**
 * The buffer a Run starts with: a Waggle the agent requested (`waggle-of-<X>`) goes on with Run X,
 * keeping its start, user messages and finished answers; any other Run starts empty.
 */
export function startedBuffer(
  previous: BackgroundRunSnapshot | null,
  runId: string,
  startedAt: number,
) {
  if (!previous?.runId || runId !== `waggle-of-${previous.runId}`)
    return emptyBuffer(runId, startedAt)
  const { userMessages, assistantMessages } = withFinishedAnswer(previous)
  return {
    ...emptyBuffer(runId, previous.startedAt),
    ...(userMessages ? { userMessages } : {}),
    ...(assistantMessages ? { assistantMessages } : {}),
  }
}

/** The buffer with the answer it streamed retained as finished, as the next one starts. */
function withFinishedAnswer(buffer: BackgroundRunSnapshot): BackgroundRunSnapshot {
  const { messageId, parts } = buffer
  if (!messageId || parts.length === 0) return buffer
  const finished = { messageId, timestamp: buffer.messageStartedAt ?? buffer.startedAt, parts }
  return { ...buffer, assistantMessages: [...(buffer.assistantMessages ?? []), finished] }
}

/** What the stream buffer keeps of an event. */
export function projectEvent(buffer: BackgroundRunSnapshot, event: AgentTransportEvent) {
  if (event.type === 'message_start' && event.role === 'assistant') {
    return {
      ...withFinishedAnswer(buffer),
      messageId: event.messageId,
      messageStartedAt: event.timestamp,
      parts: [],
    }
  }
  if (event.type === 'message_start' && event.role === 'user' && event.userMessage) {
    const userMessage: BackgroundRunUserMessage = {
      ...event.userMessage,
      messageId: event.messageId,
      timestamp: event.timestamp,
      ...(buffer.messageId ? { afterAssistantMessageId: buffer.messageId } : {}),
    }
    return { ...buffer, userMessages: [...(buffer.userMessages ?? []), userMessage] }
  }
  if (event.type === 'message_update') {
    return { ...buffer, parts: withAssistantEvent(buffer.parts, event.assistantMessageEvent) }
  }
  if (event.type === 'tool_execution_end') {
    return { ...buffer, parts: withToolCall(buffer.parts, event.toolCallId) }
  }
  return buffer
}

/**
 * What the Host's buffer holds of the Run: all of it, no finished answers (its history budget
 * left them out), or neither those nor its user messages (over the size cap).
 */
export type Retention = 'all' | 'noHistory' | 'none'

export function withRetention(
  buffer: BackgroundRunSnapshot,
  retention: Retention,
): BackgroundRunSnapshot {
  if (retention === 'all') return buffer
  const { assistantMessages: _answers, ...withoutHistory } = buffer
  return retention === 'noHistory' ? withoutHistory : { ...withoutHistory, userMessages: [] }
}
