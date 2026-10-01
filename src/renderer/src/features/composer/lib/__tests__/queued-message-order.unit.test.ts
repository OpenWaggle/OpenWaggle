import { describe, expect, it } from 'vitest'
import { reorderedFollowUpIds } from '../queued-message-order'

const NONE: ReadonlySet<string> = new Set()

describe('reorderedFollowUpIds', () => {
  it('moves a message up and down among the visible messages', () => {
    expect(reorderedFollowUpIds(['a', 'b', 'c'], NONE, 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(reorderedFollowUpIds(['a', 'b', 'c'], NONE, 'a', 1)).toEqual(['b', 'a', 'c'])
  })

  it('keeps locked messages in their exact slots', () => {
    expect(reorderedFollowUpIds(['a', 'b', 'c', 'd'], new Set(['b']), 'd', 0)).toEqual([
      'd',
      'b',
      'a',
      'c',
    ])
  })

  it('returns null for a move that does nothing or cannot be made', () => {
    expect(reorderedFollowUpIds(['a', 'b'], NONE, 'a', 0)).toBeNull()
    expect(reorderedFollowUpIds(['a', 'b'], NONE, 'z', 0)).toBeNull()
    expect(reorderedFollowUpIds(['a', 'b'], NONE, 'a', 2)).toBeNull()
    expect(reorderedFollowUpIds(['a', 'b'], new Set(['b']), 'b', 0)).toBeNull()
  })
})
