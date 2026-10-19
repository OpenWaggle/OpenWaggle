import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { markTurnReplies } from '../turn-reply-actions'
import type { ChatRow, MessageChatRow } from '../types-chat-row'

function row(id: string, role: UIMessage['role'], parts: UIMessage['parts']): MessageChatRow {
  return {
    type: 'message',
    message: { id, role, parts, createdAt: new Date(0) },
    isStreaming: false,
    isRunActive: false,
    showTurnDivider: false,
  }
}

const user = (id: string) => row(id, 'user', [{ type: 'text', content: id }])
const reply = (id: string) => row(id, 'assistant', [{ type: 'text', content: `${id} text` }])
const toolStep = (id: string) =>
  row(id, 'assistant', [
    { type: 'tool-call', id: `${id}-call`, name: 'read', arguments: '{}', state: 'input-complete' },
  ])

function marked(rows: readonly ChatRow[]) {
  return rows.flatMap((item) =>
    item.type === 'message' && item.replyActions ? [`${item.message.id}:${item.replyActions}`] : [],
  )
}

describe('markTurnReplies', () => {
  it("marks only each turn's last assistant message, not its steps between tool calls", () => {
    const rows = [
      user('u1'),
      reply('a1-interim'),
      toolStep('a1-tools'),
      reply('a1-final'),
      user('u2'),
      reply('a2'),
    ]

    expect(marked(markTurnReplies(rows, { isLoading: false }))).toEqual([
      'a1-final:reply',
      'a2:latest',
    ])
  })

  it('gives a turn that ended on a tool call no reply', () => {
    const rows = [user('u1'), reply('a1-interim'), toolStep('a1-tools'), user('u2'), reply('a2')]

    expect(marked(markTurnReplies(rows, { isLoading: false }))).toEqual(['a2:latest'])
  })

  it('leaves the running turn without a reply while settled turns keep theirs', () => {
    const rows = [user('u1'), reply('a1'), user('u2'), reply('a2-streaming')]

    expect(marked(markTurnReplies(rows, { isLoading: true }))).toEqual(['a1:latest'])
  })
})
