import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { applyTurnFolds } from '../turn-fold'
import type { ChatRow, MessageChatRow } from '../types-chat-row'

function row(
  id: string,
  role: UIMessage['role'],
  part: UIMessage['parts'][number],
): MessageChatRow {
  return {
    type: 'message',
    message: { id, role, parts: [part] },
    isStreaming: false,
    isRunActive: false,
    showTurnDivider: false,
  }
}

describe('applyTurnFolds during an active run', () => {
  it('keeps settled turns folded while leaving the active final turn open', () => {
    const rows: ChatRow[] = [
      row('u1', 'user', { type: 'text', content: 'First' }),
      row('a1', 'assistant', {
        type: 'tool-call',
        id: 'tool-1',
        name: 'edit',
        arguments: '{}',
        state: 'done',
      }),
      row('a2', 'assistant', { type: 'text', content: 'First done.' }),
      row('u2', 'user', { type: 'text', content: 'Second' }),
      row('a3', 'assistant', {
        type: 'tool-call',
        id: 'tool-2',
        name: 'edit',
        arguments: '{}',
        state: 'done',
      }),
    ]

    const result = applyTurnFolds(rows, {
      isLoading: true,
      settledRunDurationMs: null,
      turnDurationsByAnchorMessageId: new Map([['a2', 5_000]]),
      interrupted: false,
      expandedTurnKeys: new Set(),
    })

    expect(result[1]).toMatchObject({ type: 'turn-fold', label: 'Worked for 5s' })
    expect(result.at(-1)).toBe(rows.at(-1))
    expect(result.filter((candidate) => candidate.type === 'turn-fold')).toHaveLength(1)
  })
})
