import { describe, expect, it } from 'vitest'
import { persistedSentKey, type SentTurn } from '../transcript-sent-turn'
import { rowIndex } from './transcript-viewport.fixtures'

const sent = (precedingKey: string | null): SentTurn => ({
  key: 'optimistic',
  top: 24,
  precedingKey,
})

describe('persistedSentKey', () => {
  it('pairs the user row right after the row that preceded the message', () => {
    const index = rowIndex(['u1', 'a1', 'persisted', 'a2', 'steer'], {
      users: ['u1', 'persisted', 'steer'],
    })
    expect(persistedSentKey(sent('a1'), index)).toBe('persisted')
  })

  it('pairs the first row for the first message of a Session', () => {
    expect(
      persistedSentKey(sent(null), rowIndex(['persisted', 'a1'], { users: ['persisted'] })),
    ).toBe('persisted')
  })

  it('finds nothing when the preceding row is gone, even if the first row is a user message', () => {
    const index = rowIndex(['u0', 'a0', 'persisted'], { users: ['u0', 'persisted'] })
    expect(persistedSentKey(sent('a1'), index)).toBeNull()
  })

  it('finds nothing when the row in the message slot is not a user message', () => {
    const index = rowIndex(['u1', 'a1', 'error'], { users: ['u1'] })
    expect(persistedSentKey(sent('a1'), index)).toBeNull()
  })
})
