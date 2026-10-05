import type { MessagePart } from '@shared/types/agent'
import type { BackgroundRunSnapshot, BackgroundRunUserMessage } from '@shared/types/background-run'
import { ToolCallId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { MODEL, SESSION_ID } from './transcript-order.persisted'

/*
 * The reconnect stream buffer as `src/main/utils/stream-buffer.ts` keeps it: the Run it belongs to,
 * the user messages the Run incorporated (each with the answer it followed), and only the answer
 * streaming now. Every Run starts it empty; an auto-retry of the same Run keeps it.
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

function appendText(parts: readonly MessagePart[], delta: string): MessagePart[] {
  const last = parts.at(-1)
  if (last?.type === 'text')
    return [...parts.slice(0, -1), { type: 'text', text: last.text + delta }]
  return [...parts, { type: 'text', text: delta }]
}

/** What the stream buffer keeps of an event. */
export function projectEvent(buffer: BackgroundRunSnapshot, event: AgentTransportEvent) {
  if (event.type === 'message_start' && event.role === 'assistant') {
    return { ...buffer, messageId: event.messageId, parts: [] }
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
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
    return { ...buffer, parts: appendText(buffer.parts, event.assistantMessageEvent.delta) }
  }
  if (event.type === 'tool_execution_end') {
    const toolCall: MessagePart = {
      type: 'tool-call',
      toolCall: { id: ToolCallId(event.toolCallId), name: event.toolName, args: {} },
    }
    return { ...buffer, parts: [...buffer.parts, toolCall] }
  }
  return buffer
}
