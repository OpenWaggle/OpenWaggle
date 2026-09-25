import { describe, expect, it } from 'vitest'
import { chatRowKeys } from '../transcript-row-keys'
import type { ChatRow } from '../types-chat-row'

const custom = (timestamp: number, name: string): ChatRow => ({
  type: 'agent-loop-custom-message',
  event: { type: 'custom', name, timestamp, data: null },
})

describe('chatRowKeys', () => {
  it('gives every row a unique key, suffixing repeats by occurrence', () => {
    // Two custom events in the same millisecond used to share a key, leaving the second
    // unreachable by the key-based window and scroll anchor.
    const rows = [custom(1, 'note'), custom(1, 'note'), custom(2, 'note')]
    expect(chatRowKeys(rows)).toEqual(['custom:1:note', 'custom:1:note#2', 'custom:2:note'])
  })
})
