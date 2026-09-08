import { matchBy } from '@diegogbrisa/ts-match'
import type { MessageMetadata, MessagePart } from '@shared/types/agent'
import type { UIMessage, UIMessageMetadata } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import { formatAttachmentPreview } from './chat-attachment-preview'

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
