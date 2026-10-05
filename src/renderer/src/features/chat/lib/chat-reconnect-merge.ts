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
import {
  placeAnchoredReconnectMessages,
  placeCurrentOnlyMessages,
} from './chat-reconnect-placement'

function isAssistantMessage(
  message: UIMessage,
): message is UIMessage & { readonly role: 'assistant' } {
  return message.role === 'assistant'
}

/**
 * The text of a part both sides hold. `baseline` is what this renderer showed of it when the
 * reconnect read the buffer: the buffer has the whole text up to then, so the merge takes it and
 * adds only what streamed in since. Without one (or once the shown text no longer extends it) the
 * longer text that contains the other wins, and otherwise the reconnect's: putting both side by
 * side repeated a text that lost a delta in a stall for the rest of the Run.
 */
function mergeTextContent(snapshotContent: string, currentContent: string, baseline?: string) {
  if (baseline !== undefined && currentContent.startsWith(baseline)) {
    return `${snapshotContent}${currentContent.slice(baseline.length)}`
  }
  if (snapshotContent.includes(currentContent)) return snapshotContent
  if (currentContent.includes(snapshotContent)) return currentContent
  return snapshotContent
}

function partText(part: UIMessagePart | undefined) {
  return part?.type === 'text' || part?.type === 'thinking' ? part.content : undefined
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

function mergeMessagePart(
  snapshotPart: UIMessagePart,
  currentPart: UIMessagePart,
  baseline?: string,
): UIMessagePart {
  return match({ snapshotPart, currentPart })
    .with(
      { snapshotPart: { type: 'text' }, currentPart: { type: 'text' } },
      (value): UIMessagePart => ({
        type: 'text',
        content: mergeTextContent(value.snapshotPart.content, value.currentPart.content, baseline),
      }),
    )
    .with(
      { snapshotPart: { type: 'thinking' }, currentPart: { type: 'thinking' } },
      (value): UIMessagePart => {
        const stepId = value.currentPart.stepId ?? value.snapshotPart.stepId
        return {
          type: 'thinking',
          content: mergeTextContent(
            value.snapshotPart.content,
            value.currentPart.content,
            baseline,
          ),
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

/** `baselineParts`: the shown parts of the message the buffer streams, when it was read. */
function mergeAssistantParts(
  snapshotParts: readonly UIMessagePart[],
  currentParts: readonly UIMessagePart[],
  baselineParts?: readonly UIMessagePart[],
): UIMessagePart[] {
  const mergedParts = [...snapshotParts]
  for (const currentPart of currentParts) {
    const partIndex = findMergeablePartIndex(mergedParts, currentPart)
    const existingPart = partIndex >= 0 ? mergedParts[partIndex] : undefined
    if (!existingPart) {
      mergedParts.push(currentPart)
      continue
    }
    const baseline = baselineParts
      ? (partText(baselineParts[findMergeablePartIndex(baselineParts, currentPart)]) ?? '')
      : undefined
    mergedParts[partIndex] = mergeMessagePart(existingPart, currentPart, baseline)
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

interface ReconnectMergeContext {
  /**
   * Ids of the reconnect's messages that precede every message only the current transcript holds:
   * the persisted transcript's, and the user messages the Run incorporated before its first answer.
   */
  readonly earlierMessageIds?: ReadonlySet<string>
  /** For each user message the reconnect buffer retained, the answer it followed. */
  readonly userMessageAnchors?: ReadonlyMap<string, string>
  /** The answer the buffer streams, as this renderer showed it when the buffer was read. */
  readonly streamingBaseline?: {
    readonly messageId: string
    readonly parts: readonly UIMessagePart[]
  }
}

/** Merges a reconnect (the persisted transcript, and the Run's buffer) into the current one. */
export function mergeBackgroundReconnectMessages(
  reconnectMessages: UIMessage[],
  currentMessages: UIMessage[],
  context: ReconnectMergeContext = {},
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
              parts: mergeAssistantParts(
                assistantMessage.parts,
                currentAssistantMessage.parts,
                context.streamingBaseline?.messageId === assistantMessage.id
                  ? context.streamingBaseline.parts
                  : undefined,
              ),
              createdAt: currentAssistantMessage.createdAt ?? assistantMessage.createdAt,
              metadata: currentAssistantMessage.metadata ?? assistantMessage.metadata,
            }),
          )
          .otherwise(() => currentAssistantMessage),
      )
      .otherwise((value) => retainSnapshotMessageOrder(value, message))
  })

  const currentMessageIds = new Set(currentMessagesById.keys())
  const placed = placeCurrentOnlyMessages({
    mergedMessages,
    currentMessages,
    reconnectMessageIds,
    currentMessageIds,
    earlierMessageIds: context.earlierMessageIds,
    isRepresented: (message) =>
      isRepresentedByReconnectUser(message, reconnectUserCountsByText, reconnectUserOrders),
  })
  return placeAnchoredReconnectMessages(
    placed,
    context.userMessageAnchors ?? new Map(),
    currentMessageIds,
  )
}
