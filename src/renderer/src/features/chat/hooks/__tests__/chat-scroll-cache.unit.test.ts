// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadScrollCache, saveScrollCache } from '../chat-scroll-cache'

const SCROLL_CACHE_KEY = 'openwaggle:scroll-positions'
const MAX_SCROLL_CACHE_ENTRIES = 100

describe('chat scroll cache', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns an empty cache when storage is missing or malformed', () => {
    expect(loadScrollCache()).toEqual(new Map())

    localStorage.setItem(SCROLL_CACHE_KEY, '{not-json')
    expect(loadScrollCache()).toEqual(new Map())

    localStorage.setItem(SCROLL_CACHE_KEY, JSON.stringify({ session: 10 }))
    expect(loadScrollCache()).toEqual(new Map())
  })

  it('loads only valid session scroll entries', () => {
    localStorage.setItem(
      SCROLL_CACHE_KEY,
      JSON.stringify([
        ['session-a', 120],
        ['session-b', Number.NaN],
        ['session-c', 'bad'],
        ['session-d', 0],
      ]),
    )

    expect(loadScrollCache()).toEqual(
      new Map([
        ['session-a', 120],
        ['session-d', 0],
      ]),
    )
  })

  it('persists cache entries in insertion order', () => {
    saveScrollCache(
      new Map([
        ['session-a', 120],
        ['session-b', 240],
      ]),
    )

    expect(JSON.parse(localStorage.getItem(SCROLL_CACHE_KEY) ?? '[]')).toEqual([
      ['session-a', 120],
      ['session-b', 240],
    ])
  })

  it('trims the oldest entries before saving when the cache exceeds the cap', () => {
    const entries = Array.from(
      { length: MAX_SCROLL_CACHE_ENTRIES + 1 },
      (_, index) => [`session-${String(index)}`, index] as const,
    )
    const cache = new Map(entries)

    saveScrollCache(cache)

    expect(cache.has('session-0')).toBe(false)
    expect(cache.size).toBe(MAX_SCROLL_CACHE_ENTRIES)
    expect(loadScrollCache().has('session-100')).toBe(true)
  })

  it('ignores localStorage write failures without mutating the cache beyond capacity enforcement', () => {
    const cache = new Map([['session-a', 120]])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    expect(() => saveScrollCache(cache)).not.toThrow()
    expect(cache).toEqual(new Map([['session-a', 120]]))
  })
})
