import type { Message, MessagePart } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId, ToolCallId } from '@shared/types/brand'

export const SESSION_ID = SessionId('order-session')
export const MODEL = SupportedModelId('claude-sonnet-4-5')

export function entryKey(entry: { readonly role: string; readonly text: string }) {
  return `${entry.role}:${entry.text}`
}

/** One entry of the Pi Session log the transcript shows as a message. */
export interface TruthEntry {
  readonly role: 'user' | 'assistant'
  /** The message's display key: the same live and persisted. */
  readonly text: string
  readonly liveId: string
  readonly piId: string
  readonly order: number
  readonly runId: string
  readonly timestamp: number
  readonly toolCallIds: readonly string[]
  /** A compaction summary: persisted with its Run, never streamed as a message. */
  readonly compactionSummary?: true
}

/**
 * The durable text digest the Host gives a user message and a steer receipt. The renderer only
 * compares digests (it hashes a row only when the Host gave none), so any stable function will do.
 */
export function textDigest(text: string) {
  return `digest:${text}`
}

function textPart(text: string): MessagePart {
  return { type: 'text', text }
}

function toolResultMessage(entry: TruthEntry, id: string, index: number): Message {
  return {
    id: MessageId(`${entry.piId}-result-${String(index)}`),
    role: 'assistant',
    parts: [
      {
        type: 'tool-result',
        toolResult: {
          id: ToolCallId(id),
          name: 'bash',
          args: { command: id },
          result: 'ok',
          isError: false,
          duration: 1,
        },
      },
    ],
    createdAt: entry.timestamp,
    metadata: { sessionNodeCreatedOrder: entry.order + 1 + index },
  }
}

/** A persisted log entry as the Host projects it into the Session detail. */
export function persistedMessages(entry: TruthEntry): Message[] {
  if (entry.role === 'user') {
    return [
      {
        id: MessageId(entry.piId),
        role: 'user',
        parts: [textPart(entry.text)],
        createdAt: entry.timestamp,
        metadata: {
          sessionNodeCreatedOrder: entry.order,
          durableTextSha256: textDigest(entry.text),
        },
      },
    ]
  }
  const toolCalls = entry.toolCallIds.map(
    (id): MessagePart => ({
      type: 'tool-call',
      toolCall: { id: ToolCallId(id), name: 'bash', args: { command: id } },
    }),
  )
  const assistant: Message = {
    id: MessageId(entry.piId),
    role: 'assistant',
    parts: [textPart(entry.text), ...toolCalls],
    createdAt: entry.timestamp,
    // A compaction summary is a structural message: it carries no log order.
    metadata: entry.compactionSummary
      ? { compactionSummary: { summary: entry.text, tokensBefore: 100 } }
      : { sessionNodeCreatedOrder: entry.order },
  }
  return [assistant, ...entry.toolCallIds.map((id, index) => toolResultMessage(entry, id, index))]
}
