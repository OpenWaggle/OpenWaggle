import type { UIMessage } from '@shared/types/chat-ui'
import type { OptimisticSteerPreview } from '@/features/chat/state'

function getUIMessagePrimaryText(message: UIMessage) {
  return message.parts.find(
    (part): part is Extract<(typeof message.parts)[number], { type: 'text' }> =>
      part.type === 'text',
  )?.content
}

function indexUserMessagesByContent(messages: readonly UIMessage[]) {
  const userMessageIndexesByContent = new Map<string, number[]>()
  for (const [index, message] of messages.entries()) {
    if (message.role !== 'user') continue
    const content = getUIMessagePrimaryText(message)
    if (content === undefined) continue
    const indexes = userMessageIndexesByContent.get(content) ?? []
    indexes.push(index)
    userMessageIndexesByContent.set(content, indexes)
  }
  return userMessageIndexesByContent
}

function firstAvailableMessageIndex(
  candidates: readonly number[],
  messages: readonly UIMessage[],
  baselineUserMessageIds: ReadonlySet<string>,
  consumedMessageIndexes: ReadonlySet<number>,
) {
  return candidates.find(
    (candidateIndex) =>
      !baselineUserMessageIds.has(messages[candidateIndex]?.id ?? '') &&
      !consumedMessageIndexes.has(candidateIndex),
  )
}

export interface SteeredUserTurnMatch {
  readonly index: number | null
  readonly messageId: string
  readonly createdOrder?: number
  /** Shown as delivered for now, but not recorded: the Host receipt has yet to confirm it. */
  readonly provisional?: boolean
}

/**
 * The first user row the transcript received for a queued receipt: the row the Run incorporated
 * carries the same log boundary and durable text digest the receipt names, so this is exact.
 */
function receiptMessageIndex(
  messages: readonly UIMessage[],
  receipt: NonNullable<OptimisticSteerPreview['receipt']>,
  consumedMessageIndexes: ReadonlySet<number>,
) {
  const index = messages.findIndex((message, candidateIndex) => {
    const createdOrder = message.metadata?.sessionNodeCreatedOrder
    return (
      message.role === 'user' &&
      !consumedMessageIndexes.has(candidateIndex) &&
      createdOrder !== undefined &&
      createdOrder >= receipt.minimumCreatedOrder &&
      message.metadata?.durableTextSha256 === receipt.durableTextSha256
    )
  })
  return index >= 0 ? index : undefined
}

/**
 * While the Host has not answered a promotion yet, a user row the Run incorporated after the
 * preview began with exactly the preview's text stands in for it, so the steer does not show twice
 * until the receipt arrives and names the delivered row.
 */
function awaitingReceiptMessageIndex(
  messages: readonly UIMessage[],
  turn: OptimisticSteerPreview,
  consumedMessageIndexes: ReadonlySet<number>,
) {
  const index = messages.findIndex(
    (message, candidateIndex) =>
      message.role === 'user' &&
      message.metadata?.sessionNodeCreatedOrder !== undefined &&
      !turn.baselineUserMessageIds.has(message.id) &&
      !consumedMessageIndexes.has(candidateIndex) &&
      getUIMessagePrimaryText(message) === turn.content,
  )
  return index >= 0 ? index : undefined
}

function matchedMessage(
  messages: readonly UIMessage[],
  index: number,
  provisional?: true,
): SteeredUserTurnMatch | null {
  const message = messages[index]
  if (!message) return null
  const createdOrder = message.metadata?.sessionNodeCreatedOrder
  return {
    index,
    messageId: message.id,
    ...(createdOrder === undefined ? {} : { createdOrder }),
    ...(provisional ? { provisional } : {}),
  }
}

interface MatchContext {
  readonly messages: readonly UIMessage[]
  readonly matches: Map<string, SteeredUserTurnMatch>
  readonly consumedMessageIndexes: Set<number>
}

function recordMatch(
  context: MatchContext,
  turn: OptimisticSteerPreview,
  matchingIndex: number | undefined,
  provisional?: true,
) {
  if (matchingIndex === undefined) return
  const match = matchedMessage(context.messages, matchingIndex, provisional)
  if (!match) return
  context.matches.set(turn.id, match)
  context.consumedMessageIndexes.add(matchingIndex)
}

function matchRecordedTurns(context: MatchContext, turns: readonly OptimisticSteerPreview[]) {
  const messageIndexById = new Map(context.messages.map((message, index) => [message.id, index]))
  for (const turn of turns) {
    if (!turn.durableMessageId) continue
    const durableIndex =
      turn.durableMessageCreatedOrder === undefined
        ? (messageIndexById.get(turn.durableMessageId) ?? -1)
        : context.messages.findIndex(
            (message) =>
              message.metadata?.sessionNodeCreatedOrder === turn.durableMessageCreatedOrder,
          )
    if (durableIndex >= 0) context.consumedMessageIndexes.add(durableIndex)
    context.matches.set(turn.id, {
      index: durableIndex >= 0 ? durableIndex : null,
      messageId: turn.durableMessageId,
    })
  }
}

function matchLocallyKnownTurns(context: MatchContext, turns: readonly OptimisticSteerPreview[]) {
  const userMessageIndexesByContent = indexUserMessagesByContent(context.messages)
  for (const turn of turns) {
    if (turn.durableMessageId || turn.receipt !== undefined) continue
    recordMatch(
      context,
      turn,
      firstAvailableMessageIndex(
        userMessageIndexesByContent.get(turn.durableContent) ?? [],
        context.messages,
        turn.baselineUserMessageIds,
        context.consumedMessageIndexes,
      ),
    )
  }
}

/**
 * Pairs each steer preview with the user row it became. A recorded pairing wins; a queued receipt
 * pairs exactly by log boundary and digest; a preview without a receipt pairs by its known prompt
 * text; and a promotion still awaiting its receipt pairs provisionally, for display only.
 */
export function matchSteeredUserTurns(
  messages: readonly UIMessage[],
  turns: readonly OptimisticSteerPreview[],
): ReadonlyMap<string, SteeredUserTurnMatch> {
  const context: MatchContext = { messages, matches: new Map(), consumedMessageIndexes: new Set() }
  if (turns.length === 0) return context.matches
  matchRecordedTurns(context, turns)
  for (const turn of turns) {
    if (turn.durableMessageId || !turn.receipt) continue
    recordMatch(
      context,
      turn,
      receiptMessageIndex(messages, turn.receipt, context.consumedMessageIndexes),
    )
  }
  matchLocallyKnownTurns(context, turns)
  for (const turn of turns) {
    if (turn.durableMessageId || turn.receipt !== null) continue
    recordMatch(
      context,
      turn,
      awaitingReceiptMessageIndex(messages, turn, context.consumedMessageIndexes),
      true,
    )
  }
  return context.matches
}

export function insertOptimisticSteeredUserTurn(
  messages: UIMessage[],
  optimisticSteeredUserTurns: readonly OptimisticSteerPreview[],
): UIMessage[] {
  if (optimisticSteeredUserTurns.length === 0) {
    return messages
  }
  const matches = matchSteeredUserTurns(messages, optimisticSteeredUserTurns)
  let insertedCount = 0
  let insertionFloor = 0

  return optimisticSteeredUserTurns.reduce<UIMessage[]>((current, turn) => {
    const match = matches.get(turn.id)
    if (match) {
      if (match.index !== null) {
        insertionFloor = Math.max(insertionFloor, match.index + insertedCount + 1)
      }
      return current
    }
    const insertionIndex = Math.min(
      Math.max(insertionFloor, turn.baselineLength + insertedCount),
      current.length,
    )
    insertedCount += 1
    insertionFloor = insertionIndex + 1
    return [...current.slice(0, insertionIndex), turn.message, ...current.slice(insertionIndex)]
  }, messages)
}
