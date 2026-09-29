import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { chatRowKeys } from '../transcript-row-keys'
import { turnHasWork } from '../transcript-rows'
import type { ChatRow } from '../types-chat-row'

function message(id: string, role: UIMessage['role'], toolCall = false): ChatRow {
  return {
    type: 'message',
    message: {
      id,
      role,
      parts: toolCall
        ? [{ type: 'tool-call', id: `${id}-tool`, name: 'read', arguments: '{}', state: 'done' }]
        : [{ type: 'text', content: id }],
    },
    isStreaming: false,
    isRunActive: true,
    showTurnDivider: false,
  }
}

function hasWork(rows: readonly ChatRow[], sentId: string) {
  return turnHasWork(rows, chatRowKeys(rows), `message:${sentId}`)
}

describe('turnHasWork', () => {
  it('is false for a turn that only answers', () => {
    expect(hasWork([message('u1', 'user'), message('a1', 'assistant')], 'u1')).toBe(false)
  })

  it('is true once the turn makes a tool call', () => {
    expect(hasWork([message('u1', 'user'), message('a1', 'assistant', true)], 'u1')).toBe(true)
  })

  it('counts a Waggle turn as work', () => {
    const waggle: ChatRow = {
      type: 'waggle-turn',
      id: 'waggle-1',
      turnDividerProps: { turnNumber: 1, agentLabel: 'A', agentColor: 'blue' },
      agentColor: 'blue',
      messages: [],
    }
    expect(hasWork([message('u1', 'user'), waggle], 'u1')).toBe(true)
  })

  it('judges the whole turn, including work before a steer inside it', () => {
    const rows = [message('u1', 'user'), message('a1', 'assistant', true), message('steer', 'user')]
    expect(hasWork(rows, 'u1')).toBe(true)
  })

  it('ignores work in earlier turns', () => {
    const rows = [message('u0', 'user'), message('a0', 'assistant', true), message('u1', 'user')]
    expect(hasWork(rows, 'u1')).toBe(false)
  })

  it('is false when the sent row is not in the list', () => {
    expect(hasWork([message('a1', 'assistant', true)], 'u1')).toBe(false)
  })
})
