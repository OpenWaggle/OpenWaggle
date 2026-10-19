import type { ChatRow, MessageChatRow, WaggleTurnChatRow } from './types-chat-row'

function hasReplyText(row: MessageChatRow) {
  return row.message.parts.some((part) => part.type === 'text' && part.content.trim().length > 0)
}

function isUserRow(row: ChatRow): row is MessageChatRow {
  return row.type === 'message' && row.message.role === 'user'
}

function isAssistantRow(row: ChatRow): row is MessageChatRow {
  return row.type === 'message' && row.message.role === 'assistant'
}

function lastReplyIndex(messages: readonly MessageChatRow[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message && message.message.role === 'assistant') {
      return hasReplyText(message) ? index : -1
    }
  }
  return -1
}

type ReplyMark = NonNullable<MessageChatRow['replyActions']>

function markWaggleTurn(row: WaggleTurnChatRow, mark: ReplyMark): WaggleTurnChatRow {
  const reply = lastReplyIndex(row.messages)
  return {
    ...row,
    messages: row.messages.map((message, index) =>
      index === reply ? { ...message, replyActions: mark } : message,
    ),
  }
}

/**
 * A turn's reply is the place to continue from or fork after: the last assistant message of the
 * turn a user message started, when it answered in text. Text the agent wrote between tool calls,
 * and the tool calls themselves, are steps of the turn, not points to copy from; the Session tree
 * still reaches them. The turn still running has no reply yet, so the rows after the last user
 * message are left alone while the Session runs. Each Waggle agent turn has a reply of its own.
 * The transcript's last reply is `latest`.
 */
export function markTurnReplies(
  rows: readonly ChatRow[],
  input: { readonly isLoading: boolean },
): ChatRow[] {
  let activeStart = rows.length
  if (input.isLoading) {
    activeStart = 0
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]
      if (row && isUserRow(row)) {
        activeStart = index
        break
      }
    }
  }
  const replyIndexes = new Set<number>()
  let candidate = -1
  const closeTurn = () => {
    if (candidate !== -1) replyIndexes.add(candidate)
    candidate = -1
  }
  for (const [index, row] of rows.entries()) {
    if (index >= activeStart) break
    if (isUserRow(row)) {
      closeTurn()
      continue
    }
    if (isAssistantRow(row)) candidate = hasReplyText(row) ? index : -1
  }
  closeTurn()
  for (const [index, row] of rows.entries()) {
    if (index < activeStart && row.type === 'waggle-turn' && lastReplyIndex(row.messages) !== -1) {
      replyIndexes.add(index)
    }
  }
  const latest = Math.max(-1, ...replyIndexes)
  return rows.map((row, index) => {
    if (!replyIndexes.has(index)) return row
    const mark: ReplyMark = index === latest ? 'latest' : 'reply'
    if (row.type === 'waggle-turn') return markWaggleTurn(row, mark)
    return row.type === 'message' ? { ...row, replyActions: mark } : row
  })
}
