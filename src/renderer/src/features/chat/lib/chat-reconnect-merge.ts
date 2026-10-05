import { match, matchBy } from '@diegogbrisa/ts-match'
import { TOOL_STATE_RANK } from '@shared/constants/tool-state'
import type { UIMessage, UIMessagePart } from '@shared/types/chat-ui'
import {
  reconcileSnapshotUserMessages,
  retainSnapshotMessageOrder,
} from './chat-message-reconciliation'
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

/**
 * Whether a user row only the current transcript holds is already shown by a reconnect user row
 * with its text (an optimistic send the reconnect recorded under another id). A row the Session log
 * placed at an order no such reconnect row has is a different prompt and is kept.
 */
function isRepresentedByReconnectUser(
  message: UIMessage,
  reconnectUserCountsByText: Map<string, number>,
  reconnectUserOrders: ReadonlySet<number>,
) {
  const text = getNonEmptyUserMessageText(message)
  if (!text) return false
  const order = message.metadata?.sessionNodeCreatedOrder
  if (order !== undefined && !reconnectUserOrders.has(order)) return false
  return consumeUserMessageTextCount(reconnectUserCountsByText, text)
}

function reconnectUserOrdersOf(messages: readonly UIMessage[]) {
  const orders = new Set<number>()
  for (const message of messages) {
    const order = message.role === 'user' ? message.metadata?.sessionNodeCreatedOrder : undefined
    if (order !== undefined) orders.add(order)
  }
  return orders
}

/**
 * Places the messages only the current transcript holds. Each keeps its place after the shared
 * message it followed there; ones before the first shared message stay before it. Appending them
 * put a Run's earlier answers, streamed while its Session was not shown, below the answer the
 * reconnect buffer still holds. With no shared message at all they are appended. One pass over
 * each list: a transcript can hold thousands of messages and this runs on every open.
 */
function placeCurrentOnlyMessages(
  mergedMessages: UIMessage[],
  currentMessages: readonly UIMessage[],
  reconnectMessageIds: ReadonlySet<string>,
  isRepresented: (message: UIMessage) => boolean,
): UIMessage[] {
  const leading: UIMessage[] = []
  const followersByAnchorId = new Map<string, UIMessage[]>()
  let anchorId: string | null = null
  let firstSharedId: string | null = null
  for (const currentMessage of currentMessages) {
    if (reconnectMessageIds.has(currentMessage.id)) {
      anchorId = currentMessage.id
      firstSharedId ??= currentMessage.id
      continue
    }
    if (isRepresented(currentMessage)) continue
    if (anchorId === null) {
      leading.push(currentMessage)
      continue
    }
    const followers = followersByAnchorId.get(anchorId)
    if (followers) followers.push(currentMessage)
    else followersByAnchorId.set(anchorId, [currentMessage])
  }
  if (leading.length === 0 && followersByAnchorId.size === 0) return mergedMessages
  if (firstSharedId === null) return [...mergedMessages, ...leading]

  const placed: UIMessage[] = []
  for (const message of mergedMessages) {
    if (message.id === firstSharedId) {
      placed.push(...leading)
      firstSharedId = null
    }
    placed.push(message)
    const followers = followersByAnchorId.get(message.id)
    if (followers) {
      placed.push(...followers)
      followersByAnchorId.delete(message.id)
    }
  }
  return placed
}

export function mergeBackgroundReconnectMessages(
  reconnectMessages: UIMessage[],
  currentMessages: UIMessage[],
): UIMessage[] {
  const reconciledMessages = reconcileSnapshotUserMessages(reconnectMessages, currentMessages)
  const currentMessagesById = new Map(currentMessages.map((message) => [message.id, message]))
  const reconnectMessageIds = new Set(reconciledMessages.map((message) => message.id))
  const reconnectUserCountsByText = countUserMessagesByText(reconciledMessages)
  const reconnectUserOrders = reconnectUserOrdersOf(reconciledMessages)
  const mergedMessages = reconciledMessages.map((message) => {
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
      .otherwise((value) => retainSnapshotMessageOrder(value, message))
  })

  return placeCurrentOnlyMessages(mergedMessages, currentMessages, reconnectMessageIds, (message) =>
    isRepresentedByReconnectUser(message, reconnectUserCountsByText, reconnectUserOrders),
  )
}
