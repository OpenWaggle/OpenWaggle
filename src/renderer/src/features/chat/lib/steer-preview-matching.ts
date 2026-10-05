import type { UIMessage } from '@shared/types/chat-ui'
import type { OptimisticSteerPreview, SteerIncorporatedContent } from '@/features/chat/state'
import { ATTACHMENT_TEXT_PREFIX } from './chat-attachment-preview'

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

/** What a user row shows, split as a steer preview knows it: typed text and attachment count. */
function incorporatedContentOf(message: UIMessage): SteerIncorporatedContent {
  const textParts = message.parts.flatMap((part) => (part.type === 'text' ? [part.content] : []))
  const attachments = textParts.filter((text) => text.startsWith(ATTACHMENT_TEXT_PREFIX))
  return {
    text: textParts
      .filter((text) => !text.startsWith(ATTACHMENT_TEXT_PREFIX))
      .join('\n\n')
      .trim(),
    attachmentCount: attachments.length,
  }
}

/**
 * While the Host has not answered a promotion yet, a user row the log appended after the preview
 * began (above every log order the transcript held then), with exactly the preview's typed text and
 * attachment count, stands in for it so the steer does not show twice until the receipt arrives.
 * This pairing is display-only: it is never recorded, and only the receipt's log boundary and
 * digest name the delivered row.
 */
function awaitingReceiptMessageIndex(
  messages: readonly UIMessage[],
  turn: OptimisticSteerPreview,
  consumedMessageIndexes: ReadonlySet<number>,
) {
  const expected = turn.incorporatedContent
  const index = messages.findIndex((message, candidateIndex) => {
    const createdOrder = message.metadata?.sessionNodeCreatedOrder
    if (
      message.role !== 'user' ||
      createdOrder === undefined ||
      // Only a message the log appended after the preview began can be the steer.
      createdOrder <= turn.baselineMaxCreatedOrder ||
      turn.baselineUserMessageIds.has(message.id) ||
      consumedMessageIndexes.has(candidateIndex)
    ) {
      return false
    }
    const shown = incorporatedContentOf(message)
    return shown.text === expected.text && shown.attachmentCount === expected.attachmentCount
  })
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

/**
 * Shows each steer preview the transcript does not hold yet after everything it holds, in the order
 * they were promoted. Pi incorporates a steer at the next turn boundary, after the answer streaming
 * now and its tools, so that is where the message will be. A preview placed at the transcript
 * length when it began moved into older history whenever the transcript above it was rebuilt while
 * it waited (a reconnect, a settled Run reloaded under its Pi entry ids with tool results as
 * messages of their own, a compaction summary).
 */
export function insertOptimisticSteeredUserTurn(
  messages: UIMessage[],
  optimisticSteeredUserTurns: readonly OptimisticSteerPreview[],
): UIMessage[] {
  if (optimisticSteeredUserTurns.length === 0) {
    return messages
  }
  const matches = matchSteeredUserTurns(messages, optimisticSteeredUserTurns)
  const pending = optimisticSteeredUserTurns.flatMap((turn) =>
    matches.has(turn.id) ? [] : [turn.message],
  )
  return pending.length === 0 ? messages : [...messages, ...pending]
}
