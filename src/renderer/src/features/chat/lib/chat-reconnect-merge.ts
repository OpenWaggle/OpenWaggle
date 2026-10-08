import { match } from '@diegogbrisa/ts-match'
import type { UIMessage } from '@shared/types/chat-ui'
import {
  reconcileSnapshotUserMessages,
  retainSnapshotMessageOrder,
} from './chat-message-reconciliation'
import {
  consumeUserMessageTextCount,
  countUserMessagesByText,
  getNonEmptyUserMessageText,
} from './chat-message-text'
import { mergeReconnectedAnswerParts, type StreamingPartsBaseline } from './chat-reconnect-parts'
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
  readonly streamingBaseline?: StreamingPartsBaseline & { readonly messageId: string }
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
              parts: mergeReconnectedAnswerParts(
                assistantMessage.parts,
                currentAssistantMessage.parts,
                context.streamingBaseline?.messageId === assistantMessage.id
                  ? context.streamingBaseline
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
