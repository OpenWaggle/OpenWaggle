import { match, matchBy } from '@diegogbrisa/ts-match'
import { TOOL_STATE_RANK } from '@shared/constants/tool-state'
import type { UIMessage, UIMessagePart } from '@shared/types/chat-ui'
import {
  consumeUserMessageTextCount,
  countUserMessagesByText,
  getNonEmptyUserMessageText,
} from './chat-message-text'

function isAssistantMessage(
  message: UIMessage,
): message is UIMessage & { readonly role: 'assistant' } {
  return message.role === 'assistant'
}

function mergeTextContent(snapshotContent: string, currentContent: string) {
  return match({ snapshotContent, currentContent })
    .when(
      (value) => value.snapshotContent.includes(value.currentContent),
      (value) => value.snapshotContent,
    )
    .when(
      (value) => value.currentContent.includes(value.snapshotContent),
      (value) => value.currentContent,
    )
    .otherwise((value) => `${value.snapshotContent}${value.currentContent}`)
}

function toolStateRank(state: string) {
  return match(state)
    .with('complete', 'error', 'output-available', () => TOOL_STATE_RANK.TERMINAL)
    .with('executing', () => TOOL_STATE_RANK.EXECUTING)
    .with('input-complete', () => TOOL_STATE_RANK.INPUT_COMPLETE)
    .with('input-streaming', () => TOOL_STATE_RANK.INPUT_STREAMING)
    .otherwise(() => TOOL_STATE_RANK.UNKNOWN)
}

function findLastTextPartIndex(parts: readonly UIMessagePart[]) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.type === 'text') {
      return index
    }
  }
  return -1
}

function findLastThinkingPartIndex(parts: readonly UIMessagePart[], stepId?: string) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part?.type !== 'thinking') {
      continue
    }
    if (!stepId || part.stepId === stepId) {
      return index
    }
  }
  return -1
}

function findMergeablePartIndex(parts: readonly UIMessagePart[], part: UIMessagePart) {
  return matchBy(part, 'type')
    .with('text', () => findLastTextPartIndex(parts))
    .with('thinking', (value) => findLastThinkingPartIndex(parts, value.stepId))
    .with('tool-call', (value) =>
      parts.findIndex((candidate) => candidate.type === 'tool-call' && candidate.id === value.id),
    )
    .with('tool-result', (value) =>
      parts.findIndex(
        (candidate) =>
          candidate.type === 'tool-result' && candidate.toolCallId === value.toolCallId,
      ),
    )
    .with('image', (value) =>
      parts.findIndex(
        (candidate) => candidate.type === 'image' && candidate.source.value === value.source.value,
      ),
    )
    .with('audio', (value) =>
      parts.findIndex(
        (candidate) => candidate.type === 'audio' && candidate.source.value === value.source.value,
      ),
    )
    .with('video', (value) =>
      parts.findIndex(
        (candidate) => candidate.type === 'video' && candidate.source.value === value.source.value,
      ),
    )
    .with('document', (value) =>
      parts.findIndex(
        (candidate) =>
          candidate.type === 'document' && candidate.source.value === value.source.value,
      ),
    )
    .exhaustive()
}

function mergeMessagePart(snapshotPart: UIMessagePart, currentPart: UIMessagePart): UIMessagePart {
  return match({ snapshotPart, currentPart })
    .with(
      { snapshotPart: { type: 'text' }, currentPart: { type: 'text' } },
      (value): UIMessagePart => ({
        type: 'text',
        content: mergeTextContent(value.snapshotPart.content, value.currentPart.content),
      }),
    )
    .with(
      { snapshotPart: { type: 'thinking' }, currentPart: { type: 'thinking' } },
      (value): UIMessagePart => {
        const stepId = value.currentPart.stepId ?? value.snapshotPart.stepId
        return {
          type: 'thinking',
          content: mergeTextContent(value.snapshotPart.content, value.currentPart.content),
          ...(stepId ? { stepId } : {}),
        }
      },
    )
    .with(
      { snapshotPart: { type: 'tool-call' }, currentPart: { type: 'tool-call' } },
      (value): UIMessagePart =>
        toolStateRank(value.currentPart.state) >= toolStateRank(value.snapshotPart.state)
          ? value.currentPart
          : value.snapshotPart,
    )
    .otherwise((value) => value.currentPart)
}

function mergeAssistantParts(
  snapshotParts: readonly UIMessagePart[],
  currentParts: readonly UIMessagePart[],
): UIMessagePart[] {
  const mergedParts = [...snapshotParts]
  for (const currentPart of currentParts) {
    const partIndex = findMergeablePartIndex(mergedParts, currentPart)
    const existingPart = partIndex >= 0 ? mergedParts[partIndex] : undefined
    if (!existingPart) {
      mergedParts.push(currentPart)
      continue
    }
    mergedParts[partIndex] = mergeMessagePart(existingPart, currentPart)
  }
  return mergedParts
}

export function mergeBackgroundReconnectMessages(
  reconnectMessages: UIMessage[],
  currentMessages: UIMessage[],
): UIMessage[] {
  const currentMessagesById = new Map(currentMessages.map((message) => [message.id, message]))
  const reconnectMessageIds = new Set(reconnectMessages.map((message) => message.id))
  const reconnectUserCountsByText = countUserMessagesByText(reconnectMessages)
  const mergedMessages = reconnectMessages.map((message) => {
    const currentMessage = currentMessagesById.get(message.id)
    return match(currentMessage)
      .with(undefined, () => message)
      .when(isAssistantMessage, (currentAssistantMessage) =>
        match(message)
          .when(
            isAssistantMessage,
            (assistantMessage): UIMessage => ({
              ...assistantMessage,
              parts: mergeAssistantParts(assistantMessage.parts, currentAssistantMessage.parts),
              createdAt: currentAssistantMessage.createdAt ?? assistantMessage.createdAt,
              metadata: currentAssistantMessage.metadata ?? assistantMessage.metadata,
            }),
          )
          .otherwise(() => currentAssistantMessage),
      )
      .otherwise((value) => value)
  })

  for (const currentMessage of currentMessages) {
    if (!reconnectMessageIds.has(currentMessage.id)) {
      const currentUserText = getNonEmptyUserMessageText(currentMessage)
      if (
        currentUserText &&
        consumeUserMessageTextCount(reconnectUserCountsByText, currentUserText)
      ) {
        continue
      }
      mergedMessages.push(currentMessage)
    }
  }

  return mergedMessages
}
