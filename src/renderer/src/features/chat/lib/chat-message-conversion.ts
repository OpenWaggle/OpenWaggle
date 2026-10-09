import { matchBy } from '@diegogbrisa/ts-match'
import type { MessageMetadata, MessagePart } from '@shared/types/agent'
import type { UIMessage, UIMessageMetadata } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import type { NestedToolCalls } from '@shared/types/tools'
import { formatAttachmentPreview } from './chat-attachment-preview'
import { makeThinkingStepId } from './chat-stream-state-helpers'

/** Pi's record, or the active Run buffer's record of a call still running, as it is. */
function nestedCallsToUI(nestedCalls: NestedToolCalls | undefined) {
  return nestedCalls && (nestedCalls.calls.length > 0 || nestedCalls.droppedCalls)
    ? { nestedCalls }
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
        ...nestedCallsToUI(value.toolCall.nestedCalls),
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

function hasUIMetadata(metadata: MessageMetadata) {
  return !(
    metadata.sessionNodeCreatedOrder === undefined &&
    !metadata.durableTextSha256 &&
    !metadata.branchSummary &&
    !metadata.compactionSummary &&
    !metadata.waggleInvocation &&
    !metadata.visualizationSessionId &&
    !metadata.error
  )
}

function messageMetadataToUI(metadata: MessageMetadata | undefined): UIMessageMetadata | undefined {
  if (!metadata || !hasUIMetadata(metadata)) return undefined
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
    ...(metadata.error ? { error: metadata.error } : {}),
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

/**
 * A part of the Host stream buffer: a reasoning part it kept the content block of is named like
 * the thinking step the live view streamed it into, so a reconnect matches the two.
 */
function bufferedPartToUIParts(part: MessagePart, messageId: string): UIMessage['parts'] {
  if (part.type !== 'reasoning' || part.contentIndex === undefined)
    return messagePartToUIParts(part)
  return [
    {
      type: 'thinking',
      content: part.text,
      stepId: makeThinkingStepId(messageId, part.contentIndex),
    },
  ]
}

export function buildPartialAssistantMessage(
  parts: readonly MessagePart[],
  messageId?: string,
): UIMessage | null {
  const id = messageId ?? `bg-stream-${Date.now()}`
  const uiParts: UIMessage['parts'] = parts.flatMap((part) => bufferedPartToUIParts(part, id))
  if (uiParts.length === 0) {
    return null
  }

  return {
    id,
    role: 'assistant',
    parts: uiParts,
    createdAt: new Date(),
  }
}
