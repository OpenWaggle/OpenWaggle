import type { UIMessage } from '@shared/types/chat-ui'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import type { ChatRow, MessageChatRow } from './types-chat-row'

/*
 * The transcript row of one message. Rows are rebuilt for the whole branch on every render, a
 * streamed delta included, so a row whose inputs did not change is reused: the rebuild allocates
 * only what changed, and a bubble whose row and message keep their identity bails out of the
 * render. Nested tool results are cached the same way, keyed by the row they join.
 */

type ToolResultPart = Extract<UIMessage['parts'][number], { type: 'tool-result' }>
type SummaryRow = Extract<ChatRow, { type: 'branch-summary' | 'compaction-summary' }>

export function isToolResultOnlyMessage(message: UIMessage) {
  return message.parts.length > 0 && message.parts.every((part) => part.type === 'tool-result')
}

export function sameWaggleTurn(
  current: WaggleMessageMetadata | undefined,
  previous: WaggleMessageMetadata | undefined,
) {
  const bothHaveSessionId = current?.sessionId !== undefined && previous?.sessionId !== undefined
  return (
    current !== undefined &&
    previous !== undefined &&
    current.agentIndex === previous.agentIndex &&
    current.turnNumber === previous.turnNumber &&
    (!bothHaveSessionId || current.sessionId === previous.sessionId)
  )
}

function summaryRowFor(message: UIMessage): SummaryRow | null {
  const branchSummary = message.metadata?.branchSummary
  if (branchSummary) {
    return { type: 'branch-summary', id: message.id, summary: branchSummary.summary }
  }
  const compactionSummary = message.metadata?.compactionSummary
  if (compactionSummary) {
    return {
      type: 'compaction-summary',
      id: message.id,
      summary: compactionSummary.summary,
      tokensBefore: compactionSummary.tokensBefore,
      reason: compactionSummary.reason,
    }
  }
  return null
}

export function getSummaryRow(message: UIMessage): SummaryRow | null {
  return summaryRowFor(message)
}

function toolCallIds(message: UIMessage) {
  const ids = new Set<string>()
  for (const part of message.parts) {
    if (part.type === 'tool-call') {
      ids.add(part.id)
    }
  }
  return ids
}

function canNestToolResultMessage(target: UIMessage, toolResults: readonly ToolResultPart[]) {
  if (target.role !== 'assistant') {
    return false
  }

  const ids = toolCallIds(target)
  return toolResults.some((part) => ids.has(part.toolCallId))
}

function appendToolResultParts(target: UIMessage, toolResults: readonly ToolResultPart[]) {
  const existingResultIds = new Set(
    target.parts.flatMap((part) => (part.type === 'tool-result' ? [part.toolCallId] : [])),
  )
  const nextResults = toolResults.filter((part) => !existingResultIds.has(part.toolCallId))
  return nextResults.length > 0 ? { ...target, parts: [...target.parts, ...nextResults] } : target
}

function nestedRow(previousRow: MessageChatRow, message: UIMessage): MessageChatRow | null {
  const toolResults = message.parts
    .filter((part) => part.type === 'tool-result')
    .map((part) => ({ ...part, sourceMessageId: message.id }))
  if (!canNestToolResultMessage(previousRow.message, toolResults)) return null
  return { ...previousRow, message: appendToolResultParts(previousRow.message, toolResults) }
}

const nestedRowByRow = new WeakMap<MessageChatRow, WeakMap<UIMessage, MessageChatRow | null>>()

/** Folds a tool-result-only message into the assistant row whose call it answers. */
export function tryNestToolResultMessage(rows: ChatRow[], message: UIMessage) {
  if (!isToolResultOnlyMessage(message)) {
    return false
  }

  const previousRow = rows[rows.length - 1]
  if (previousRow?.type !== 'message') return false
  let byMessage = nestedRowByRow.get(previousRow)
  if (!byMessage) {
    byMessage = new WeakMap()
    nestedRowByRow.set(previousRow, byMessage)
  }
  let row = byMessage.get(message)
  if (row === undefined) {
    row = nestedRow(previousRow, message)
    byMessage.set(message, row)
  }
  if (row === null) return false
  rows[rows.length - 1] = row
  return true
}

interface MessageRowInput {
  readonly message: UIMessage
  readonly meta: WaggleMessageMetadata | undefined
  readonly previousVisibleWaggleMeta: WaggleMessageMetadata | undefined
  readonly isStreaming: boolean
  readonly isLoading: boolean
}

function messageRowFor({
  message,
  meta,
  previousVisibleWaggleMeta,
  isStreaming,
  isLoading,
}: MessageRowInput): MessageChatRow {
  const showTurnDivider =
    !!meta && message.role === 'assistant' && !sameWaggleTurn(meta, previousVisibleWaggleMeta)
  return {
    type: 'message',
    message,
    isStreaming,
    isRunActive: isLoading,
    showTurnDivider,
    turnDividerProps: showTurnDivider
      ? {
          turnNumber: meta.turnNumber,
          agentLabel: meta.agentLabel,
          agentColor: meta.agentColor,
          agentModel: meta.agentModel,
        }
      : undefined,
    assistantModel: message.role === 'assistant' ? meta?.agentModel : undefined,
    waggle: meta ? { agentLabel: meta.agentLabel, agentColor: meta.agentColor } : undefined,
    waggleMeta: meta,
  }
}

const messageRowCache = new WeakMap<
  UIMessage,
  { readonly input: MessageRowInput; readonly row: MessageChatRow }
>()

function sameRowInput(left: MessageRowInput, right: MessageRowInput) {
  return (
    left.meta === right.meta &&
    left.previousVisibleWaggleMeta === right.previousVisibleWaggleMeta &&
    left.isStreaming === right.isStreaming &&
    left.isLoading === right.isLoading
  )
}

export function createMessageRow(input: MessageRowInput): MessageChatRow {
  const cached = messageRowCache.get(input.message)
  if (cached && sameRowInput(cached.input, input)) return cached.row
  const row = messageRowFor(input)
  messageRowCache.set(input.message, { input, row })
  return row
}
