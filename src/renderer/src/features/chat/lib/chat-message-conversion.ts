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
export function messagePartToUIParts(part: MessagePart) {
  return matchBy(part, 'type')
    .with('text', (value) => {
      const message: UIMessage['parts'] = [{ type: 'text', content: value.text }]
      return message
    })
    .with('tool-call', (value) => {
      const message: UIMessage['parts'] = [
        {
          type: 'tool-call',
          id: String(value.toolCall.id),
          name: value.toolCall.name,
          arguments: JSON.stringify(value.toolCall.args),
          state: value.toolCall.state ?? 'input-complete',
          ...nestedCallsToUI(value.toolCall.nestedCalls),
        },
      ]
      return message
    })
    .with('tool-result', (value) => {
      const message: UIMessage['parts'] = [
        {
          type: 'tool-result',
          toolCallId: String(value.toolResult.id),
          content: value.toolResult.result,
          state: value.toolResult.isError ? 'error' : 'complete',
          ...nestedCallsToUI(value.toolResult.nestedCalls),
        },
      ]
      return message
    })
    .with('attachment', (value) => {
      const message: UIMessage['parts'] = [
        {
          type: 'text',
          content: formatAttachmentPreview(value.attachment),
        },
      ]
      return message
    })
    .with('reasoning', (value) => {
      const message: UIMessage['parts'] = [
        {
          type: 'thinking',
          content: value.text,
        },
      ]
      return message
    })
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
    !metadata.error &&
    !metadata.scheduledTask &&
    !metadata.hiveWake
  )
}

/** The metadata of a stored message the transcript shows, whichever branch it is on. */
export function messageMetadataToUI(metadata: MessageMetadata | undefined) {
  if (!metadata || !hasUIMetadata(metadata)) return undefined
  const result: UIMessageMetadata | undefined = {
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
    ...(metadata.scheduledTask ? { scheduledTask: metadata.scheduledTask } : {}),
    ...(metadata.hiveWake ? { hiveWake: true as const } : {}),
  }
  return result
}

export function sessionToUIMessages(session: SessionDetail) {
  const message: UIMessage[] = session.messages.map((msg) => {
    const metadata = messageMetadataToUI(msg.metadata)
    return {
      id: String(msg.id),
      role: msg.role,
      parts: msg.parts.flatMap(messagePartToUIParts),
      createdAt: new Date(msg.createdAt),
      ...(metadata === undefined ? {} : { metadata }),
    }
  })
  return message
}

/**
 * A part of the Host stream buffer: a reasoning part it kept the content block of is named like
 * the thinking step the live view streamed it into, so a reconnect matches the two.
 */
function bufferedPartToUIParts(part: MessagePart, messageId: string) {
  if (part.type !== 'reasoning' || part.contentIndex === undefined) {
    return messagePartToUIParts(part)
  }
  const message: UIMessage['parts'] = [
    {
      type: 'thinking',
      content: part.text,
      stepId: makeThinkingStepId(messageId, part.contentIndex),
    },
  ]
  return message
}

export function buildPartialAssistantMessage(parts: readonly MessagePart[], messageId?: string) {
  const id = messageId ?? `bg-stream-${Date.now()}`
  const uiParts: UIMessage['parts'] = parts.flatMap((part) => bufferedPartToUIParts(part, id))
  if (uiParts.length === 0) {
    return null
  }

  const message: UIMessage | null = {
    id,
    role: 'assistant',
    parts: uiParts,
    createdAt: new Date(),
  }
  return message
}
