import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { applyTurnFolds } from '../turn-fold'
import type { ChatRow } from '../types-chat-row'

function row(id: string, role: UIMessage['role'], parts: UIMessage['parts']): ChatRow {
  return {
    type: 'message',
    message: { id, role, parts },
    isStreaming: false,
    isRunActive: false,
    showTurnDivider: false,
    turnDividerProps: undefined,
  }
}

describe('applyTurnFolds with hidden calls', () => {
  it('does not fold a turn whose only work was a hidden Worker wait', () => {
    const rows: ChatRow[] = [
      row('u1', 'user', [{ type: 'text', content: 'coordinate' }]),
      row('a1', 'assistant', [
        { type: 'text', content: 'Waiting for the Workers.' },
        {
          type: 'tool-call',
          id: 'w1',
          name: 'sessions',
          arguments: '{"action":"wait"}',
          state: 'input-complete',
        },
      ]),
      row('a2', 'assistant', [{ type: 'text', content: 'All done.' }]),
    ]

    const result = applyTurnFolds(rows, {
      isLoading: false,
      settledRunDurationMs: 12_000,
      turnDurationsByAnchorMessageId: new Map(),
      interrupted: false,
      expandedTurnKeys: new Set<string>(),
    })

    expect(result.some((item) => item.type === 'turn-fold')).toBe(false)
  })
})
