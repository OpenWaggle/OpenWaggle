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

describe('markTurnReplies: what is a reply', () => {
  const textAndTool = (id: string) =>
    row(id, 'assistant', [
      { type: 'text', content: 'Let me check' },
      {
        type: 'tool-call',
        id: `${id}-call`,
        name: 'read',
        arguments: '{}',
        state: 'input-complete',
      },
    ])

  it('gives no reply to a step a steer cut short, so a copy never ends on a call', () => {
    const rows = [user('u1'), textAndTool('a1-step'), user('u2-steer'), reply('a2')]

    expect(marked(markTurnReplies(rows, { isLoading: false }))).toEqual(['a2:latest'])
  })

  it('gives no reply to an interrupted turn that ended on text and a call', () => {
    const rows = [user('u1'), reply('a1'), user('u2'), textAndTool('a2-step')]

    expect(marked(markTurnReplies(rows, { isLoading: false }))).toEqual(['a1:latest'])
  })

  it('gives no reply to a failed response', () => {
    const failed = row('a2-failed', 'assistant', [{ type: 'text', content: 'partial' }])
    const withError = { ...failed, message: { ...failed.message, metadata: { error: 'boom' } } }
    const rows = [user('u1'), reply('a1'), user('u2'), withError]

    expect(marked(markTurnReplies(rows, { isLoading: false }))).toEqual(['a1:latest'])
  })

  it('marks nothing while a Session with no user row runs', () => {
    expect(marked(markTurnReplies([reply('a1')], { isLoading: true }))).toEqual([])
  })

  it("marks each Waggle agent turn's reply, the last one latest", () => {
    const turn = (id: string, messages: MessageChatRow[]): ChatRow => ({
      type: 'waggle-turn',
      id,
      turnDividerProps: { turnNumber: 0, agentLabel: id, agentColor: 'blue' },
      agentColor: 'blue',
      messages,
    })
    const rows = [
      user('u1'),
      turn('w1', [toolStep('w1-tools'), reply('w1-reply')]),
      turn('w2', [reply('w2-reply')]),
    ]

    const result = markTurnReplies(rows, { isLoading: false })

    const marks = result.flatMap((item) =>
      item.type === 'waggle-turn'
        ? item.messages.flatMap((m) =>
            m.replyActions ? [`${m.message.id}:${m.replyActions}`] : [],
          )
        : [],
    )
    expect(marks).toEqual(['w1-reply:reply', 'w2-reply:latest'])
  })

  it('keeps a marked row the same object while its input row is unchanged', () => {
    const rows = [user('u1'), reply('a1'), user('u2'), reply('a2')]

    const first = markTurnReplies(rows, { isLoading: false })
    const second = markTurnReplies(rows, { isLoading: false })

    expect(second[1]).toBe(first[1])
    expect(second[3]).toBe(first[3])
  })
})

describe('markTurnReplies: the running turn', () => {
  it('keeps a turn steered while it streams from getting a reply before it settles', () => {
    const streaming = { ...reply('a2-streaming'), isStreaming: true }
    const steer = user('u3-steer')
    const pendingSteer = {
      ...steer,
      message: { ...steer.message, metadata: { steerDelivery: 'sending' as const } },
    }
    const rows = [user('u1'), reply('a1'), user('u2'), streaming, pendingSteer]

    expect(marked(markTurnReplies(rows, { isLoading: true }))).toEqual(['a1:latest'])
  })

  it('gives a plain message the Waggle turn answered after no reply', () => {
    const waggle: ChatRow = {
      type: 'waggle-turn',
      id: 'w1',
      turnDividerProps: { turnNumber: 0, agentLabel: 'w1', agentColor: 'blue' },
      agentColor: 'blue',
      messages: [reply('w1-reply')],
    }
    const result = markTurnReplies([user('u1'), reply('a0'), waggle], { isLoading: false })

    expect(marked(result)).toEqual([])
    const waggleRow = result[2]
    expect(waggleRow?.type === 'waggle-turn' ? waggleRow.messages[0]?.replyActions : null).toBe(
      'latest',
    )
  })
})
