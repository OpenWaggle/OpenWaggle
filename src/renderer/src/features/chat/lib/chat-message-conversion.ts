import { matchBy } from '@diegogbrisa/ts-match'
import type { MessageMetadata, MessagePart } from '@shared/types/agent'
import type { ChatNestedToolCall, UIMessage, UIMessageMetadata } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import type { NestedToolCallRecord, NestedToolCalls } from '@shared/types/tools'
import { formatAttachmentPreview } from './chat-attachment-preview'

const NESTED_CALL_STATE = {
  ok: 'complete',
  error: 'error',
  unfinished: 'unfinished',
} as const satisfies Record<NestedToolCallRecord['status'], ChatNestedToolCall['state']>

function nestedCallToUI(record: NestedToolCallRecord): ChatNestedToolCall {
  return {
    id: record.id,
    name: record.name,
    ...(record.args !== undefined ? { arguments: JSON.stringify(record.args) } : {}),
    state: NESTED_CALL_STATE[record.status],
    ...(record.error !== undefined ? { error: record.error } : {}),
  }
}

function nestedCallsToUI(nestedCalls: NestedToolCalls | undefined) {
  return nestedCalls && nestedCalls.calls.length > 0
    ? { nestedCalls: nestedCalls.calls.map(nestedCallToUI) }
    : {}
}

/**
 * Convert a persisted agent message part into renderer UI parts.
 * This is the boundary between storage transport shapes and chat presentation state.
 */
export function messagePartToUIParts(part: MessagePart): UIMessage['parts'] {
  return matchBy(part, 'type')
    .with('text', (value): UIMessage['parts'] => [{ type: 'text', content: value.text }])
    .with('tool-call', (value): UIMessage['parts'] => [
      {
        type: 'tool-call',
        id: String(value.toolCall.id),
        name: value.toolCall.name,
        arguments: JSON.stringify(value.toolCall.args),
        state: value.toolCall.state ?? 'input-complete',
      },
    ])
    .with('tool-result', (value): UIMessage['parts'] => [
      {
        type: 'tool-result',
        toolCallId: String(value.toolResult.id),
        content: value.toolResult.result,
        state: value.toolResult.isError ? 'error' : 'complete',
        ...nestedCallsToUI(value.toolResult.nestedCalls),
      },
    ])
    .with('attachment', (value): UIMessage['parts'] => [
      {
        type: 'text',
        content: formatAttachmentPreview(value.attachment),
      },
    ])
    .with('reasoning', (value): UIMessage['parts'] => [
      {
        type: 'thinking',
        content: value.text,
      },
    ])
    .exhaustive()
}

function messageMetadataToUI(metadata: MessageMetadata | undefined): UIMessageMetadata | undefined {
  if (!metadata) return undefined
  if (
    metadata.sessionNodeCreatedOrder === undefined &&
    !metadata.durableTextSha256 &&
    !metadata.branchSummary &&
    !metadata.compactionSummary &&
    !metadata.waggleInvocation &&
    !metadata.visualizationSessionId
  )
    return undefined
  return {
    ...(metadata.sessionNodeCreatedOrder !== undefined
      ? { sessionNodeCreatedOrder: metadata.sessionNodeCreatedOrder }
      : {}),
    ...(metadata.durableTextSha256 ? { durableTextSha256: metadata.durableTextSha256 } : {}),
    ...(metadata.visualizationSessionId
      ? { visualizationSessionId: metadata.visualizationSessionId }
      : {}),
    ...(metadata.branchSummary ? { branchSummary: metadata.branchSummary } : {}),
    ...(metadata.compactionSummary ? { compactionSummary: metadata.compactionSummary } : {}),
    ...(metadata.waggleInvocation ? { waggleInvocation: metadata.waggleInvocation } : {}),
  }
}

export function sessionToUIMessages(session: SessionDetail): UIMessage[] {
  return session.messages.map((msg) => ({
    id: String(msg.id),
    role: msg.role,
    parts: msg.parts.flatMap(messagePartToUIParts),
    createdAt: new Date(msg.createdAt),
    metadata: messageMetadataToUI(msg.metadata),
  }))
}

export function buildPartialAssistantMessage(
  parts: readonly MessagePart[],
  messageId?: string,
): UIMessage | null {
  const uiParts: UIMessage['parts'] = parts.flatMap(messagePartToUIParts)
  if (uiParts.length === 0) {
    return null
  }

  return {
    id: messageId ?? `bg-stream-${Date.now()}`,
    role: 'assistant',
    parts: uiParts,
    createdAt: new Date(),
  }
}
