import { describe, expect, it } from 'vitest'
import { dropAnchor, moveQueuedMessage } from '../queued-message-order'

const NONE: ReadonlySet<string> = new Set()

describe('moveQueuedMessage', () => {
  it('places a message before or after a visible neighbour', () => {
    expect(
      moveQueuedMessage(['a', 'b', 'c'], NONE, 'c', { position: 'before', followUpId: 'a' }),
    ).toEqual({ order: ['c', 'a', 'b'], position: 1, count: 3 })
    expect(
      moveQueuedMessage(['a', 'b', 'c'], NONE, 'a', { position: 'after', followUpId: 'b' }),
    ).toEqual({ order: ['b', 'a', 'c'], position: 2, count: 3 })
  })

  it('keeps its meaning when the queue changed: the neighbour, not an index', () => {
    // Move "c" up past "b"; meanwhile "x" was queued at the front.
    expect(
      moveQueuedMessage(['x', 'a', 'b', 'c'], NONE, 'c', { position: 'before', followUpId: 'b' }),
    ).toEqual({ order: ['x', 'a', 'c', 'b'], position: 3, count: 4 })
  })

  it('keeps locked messages in their exact slots', () => {
    expect(
      moveQueuedMessage(['a', 'b', 'c', 'd'], new Set(['b']), 'd', {
        position: 'before',
        followUpId: 'a',
      })?.order,
    ).toEqual(['d', 'b', 'a', 'c'])
  })

  it('returns null for a move that does nothing or cannot be made', () => {
    const placedBefore = (followUpId: string) => ({ position: 'before' as const, followUpId })
    expect(moveQueuedMessage(['a', 'b'], NONE, 'a', placedBefore('b'))).toBeNull()
    expect(moveQueuedMessage(['a', 'b'], NONE, 'z', placedBefore('a'))).toBeNull()
    expect(moveQueuedMessage(['a', 'b'], NONE, 'b', placedBefore('z'))).toBeNull()
    expect(moveQueuedMessage(['a', 'b'], NONE, 'a', placedBefore('a'))).toBeNull()
    expect(moveQueuedMessage(['a', 'b'], new Set(['a']), 'b', placedBefore('a'))).toBeNull()
  })
})

describe('dropAnchor', () => {
  it('lands a message dragged down after the target and one dragged up before it', () => {
    expect(dropAnchor(['a', 'b', 'c'], 'a', 'c')).toEqual({ position: 'after', followUpId: 'c' })
    expect(dropAnchor(['a', 'b', 'c'], 'c', 'a')).toEqual({ position: 'before', followUpId: 'a' })
    expect(dropAnchor(['a', 'b', 'c'], 'b', 'b')).toBeNull()
  })
})
