import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { applyTurnFolds } from '../turn-fold'
import type { ChatRow } from '../types-chat-row'

function row(id: string, role: UIMessage['role'], parts: UIMessage['parts']) {
  const result: ChatRow = {
    type: 'message',
    message: { id, role, parts },
    isStreaming: false,
    isRunActive: false,
    showTurnDivider: false,
  }
  return result
}

function turn(index: number) {
  const result: ChatRow[] = [
    row(`u${index}`, 'user', [{ type: 'text', content: 'Keep going' }]),
    row(`a${index}-work`, 'assistant', [
      { type: 'tool-call', id: `t${index}`, name: 'edit', arguments: '{}', state: 'done' },
    ]),
    row(`a${index}`, 'assistant', [{ type: 'text', content: 'Done.' }]),
  ]
  return result
}

describe('applyTurnFolds duration labels', () => {
  it('rolls minutes over into hours for turns longer than an hour', () => {
    const result = applyTurnFolds([...turn(1), ...turn(2)], {
      isLoading: false,
      settledRunDurationMs: 7_384_000,
      turnDurationsByAnchorMessageId: new Map([['a1', 3_723_000]]),
      interrupted: true,
      expandedTurnKeys: new Set<string>(),
    })

    const labels = result
      .filter((item): item is Extract<ChatRow, { type: 'turn-fold' }> => item.type === 'turn-fold')
      .map((item) => item.label)
    expect(labels).toEqual(['Worked for 1h 2m 3s', 'You stopped after 2h 3m 4s'])
  })
})
