import type { ChatRow, MessageChatRow, WaggleTurnChatRow } from './types-chat-row'

type ReplyMark = NonNullable<MessageChatRow['replyActions']>

/**
 * A reply answered in text and ended its turn: a message that also called a tool was a step of a
 * turn a steer or an interruption cut short, and a copy at it would end on a call without its
 * result. A failed response is not a reply either.
 */
function isReply(row: MessageChatRow) {
  const { message } = row
  if (message.role !== 'assistant' || message.metadata?.error !== undefined) return false
  if (message.parts.some((part) => part.type === 'tool-call')) return false
  return message.parts.some((part) => part.type === 'text' && part.content.trim().length > 0)
}

function isUserRow(row: ChatRow): row is MessageChatRow {
  return row.type === 'message' && row.message.role === 'user'
}

function lastReplyIndex(messages: readonly MessageChatRow[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message && message.message.role === 'assistant') return isReply(message) ? index : -1
  }
  return -1
}

/*
 * Rows are rebuilt on every streamed token, and a row that keeps its identity keeps its bubble from
 * re-rendering (see `chat-message-row-model.ts`). A marked row is cached by the row it marks.
 */
const markedMessageRows = new WeakMap<MessageChatRow, Map<ReplyMark, MessageChatRow>>()
const markedWaggleRows = new WeakMap<WaggleTurnChatRow, Map<ReplyMark, WaggleTurnChatRow>>()

function cached<Row extends object>(
  cache: WeakMap<Row, Map<ReplyMark, Row>>,
  row: Row,
  mark: ReplyMark,
  build: () => Row,
): Row {
  const byMark = cache.get(row) ?? new Map<ReplyMark, Row>()
  cache.set(row, byMark)
  const existing = byMark.get(mark)
  if (existing) return existing
  const next = build()
  byMark.set(mark, next)
  return next
}

function markMessageRow(row: MessageChatRow, mark: ReplyMark) {
  return cached(markedMessageRows, row, mark, () => ({ ...row, replyActions: mark }))
}

function markWaggleTurn(row: WaggleTurnChatRow, mark: ReplyMark) {
  const reply = lastReplyIndex(row.messages)
  return cached(markedWaggleRows, row, mark, () => ({
    ...row,
    messages: row.messages.map((message, index) =>
      index === reply ? markMessageRow(message, mark) : message,
    ),
  }))
}

/** A steer the agent has not read yet renders last, but the turn it steers is still running. */
function isPendingSteer(row: MessageChatRow) {
  return row.message.metadata?.steerDelivery !== undefined
}

function activeTurnStart(rows: readonly ChatRow[], isLoading: boolean) {
  if (!isLoading) return rows.length
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row && isUserRow(row) && !isPendingSteer(row)) return index
  }
  return 0
}

function replyRowIndexes(rows: readonly ChatRow[], activeStart: number) {
  const replies: number[] = []
  let candidate = -1
  for (const [index, row] of rows.entries()) {
    if (index >= activeStart) break
    if (row.type === 'message') {
      const { role } = row.message
      // A user message closes the turn before it; an assistant message is its latest candidate.
      if (role === 'user' && candidate !== -1) replies.push(candidate)
      if (role === 'user') candidate = -1
      if (role === 'assistant') candidate = isReply(row) && !row.isStreaming ? index : -1
      continue
    }
    if (row.type === 'waggle-turn') {
      // The Waggle turn answered after it: the message before is no longer the turn's reply.
      candidate = -1
      if (lastReplyIndex(row.messages) !== -1) replies.push(index)
    }
  }
  if (candidate !== -1) replies.push(candidate)
  return replies
}

/**
 * A turn's reply is the place to continue from, fork after, or copy (ADR 0055): the last assistant
 * message of the turn a user message started, when it answered in text. Text the agent wrote
 * between tool calls, and the tool calls themselves, are steps of the turn, not points to copy
 * from; the Session tree still reaches them. The turn still running has no reply yet, so the rows
 * after the last user message are left alone while the Session runs. Each Waggle agent turn has a
 * reply of its own. The transcript's last reply is `latest`.
 */
export function markTurnReplies(
  rows: readonly ChatRow[],
  input: { readonly isLoading: boolean },
): ChatRow[] {
  const replies = replyRowIndexes(rows, activeTurnStart(rows, input.isLoading))
  if (replies.length === 0) return [...rows]
  const marks = new Map<number, ReplyMark>(replies.map((index) => [index, 'reply']))
  marks.set(replies[replies.length - 1] ?? -1, 'latest')
  return rows.map((row, index) => {
    const mark = marks.get(index)
    if (!mark) return row
    if (row.type === 'waggle-turn') return markWaggleTurn(row, mark)
    return row.type === 'message' ? markMessageRow(row, mark) : row
  })
}
