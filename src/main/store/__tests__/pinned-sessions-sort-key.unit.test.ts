import { describe, expect, it } from 'vitest'
import { keyAtEnd, keyBetween } from '../pinned-sessions-sort-key'

/**
 * Manual order of Pinned sessions is carried by fractional string keys (ADR 0019).
 * The property that matters is that any gap can be split, forever, without touching
 * neighbouring rows — that is what keeps a reorder to a single row write.
 */
describe('pinned session sort keys', () => {
  it('opens a sequence with room on both sides', () => {
    const first = keyBetween(null, null)
    expect(keyBetween(null, first) < first).toBe(true)
    expect(first < keyBetween(first, null)).toBe(true)
  })

  it('appends after the last key', () => {
    const first = keyBetween(null, null)
    const second = keyBetween(first, null)
    const third = keyBetween(second, null)
    expect([first, second, third]).toStrictEqual([first, second, third].slice().sort())
  })

  it('prepends before the first key', () => {
    const first = keyBetween(null, null)
    const earlier = keyBetween(null, first)
    const earliest = keyBetween(null, earlier)
    expect(earliest < earlier).toBe(true)
    expect(earlier < first).toBe(true)
  })

  it('inserts strictly between two adjacent keys', () => {
    const left = keyBetween(null, null)
    const right = keyBetween(left, null)
    const middle = keyBetween(left, right)
    expect(left < middle).toBe(true)
    expect(middle < right).toBe(true)
  })

  it('keeps splitting the same gap without renumbering neighbours', () => {
    const left = keyBetween(null, null)
    const right = keyBetween(left, null)
    let previous = right
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const inserted = keyBetween(left, previous)
      expect(left < inserted).toBe(true)
      expect(inserted < previous).toBe(true)
      previous = inserted
    }
  })

  it('never emits a key that cannot be split again', () => {
    let key = keyBetween(null, null)
    const keys = [key]
    for (let iteration = 0; iteration < 40; iteration += 1) {
      key = keyBetween(key, null)
      keys.push(key)
    }
    for (const emitted of keys) {
      expect(emitted).not.toBe('')
      expect(emitted.endsWith('0')).toBe(false)
      expect(() => keyBetween(emitted, null)).not.toThrow()
      expect(() => keyBetween(null, emitted)).not.toThrow()
    }
  })

  it('sorts a long appended run in insertion order under plain lexicographic compare', () => {
    const generated: string[] = []
    for (let iteration = 0; iteration < 200; iteration += 1) {
      generated.push(keyAtEnd(generated))
    }
    expect(generated).toStrictEqual([...generated].sort())
    expect(new Set(generated).size).toBe(generated.length)
  })

  it('keyAtEnd on an empty sequence opens the sequence', () => {
    expect(keyAtEnd([])).toBe(keyBetween(null, null))
  })

  it('rejects reversed bounds', () => {
    const left = keyBetween(null, null)
    const right = keyBetween(left, null)
    expect(() => keyBetween(right, left)).toThrow(/out of order/)
    expect(() => keyBetween(left, left)).toThrow(/out of order/)
  })

  it('rejects keys outside the alphabet', () => {
    expect(() => keyBetween('A', null)).toThrow(/Invalid sort-key digit/)
    expect(() => keyBetween(null, '!')).toThrow(/Invalid sort-key digit/)
  })

  it('rejects an unsplittable key ending in the lowest digit', () => {
    expect(() => keyBetween('a0', null)).toThrow(/must not end with/)
    expect(() => keyBetween(null, 'a0')).toThrow(/must not end with/)
  })
})
