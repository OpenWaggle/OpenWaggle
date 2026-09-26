// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  loadReadingPositions,
  readingPositionKey,
  rememberReadingPosition,
  saveReadingPositions,
} from '../transcript-reading-positions'

describe('transcript reading positions', () => {
  afterEach(() => localStorage.clear())

  it('keeps separate positions per Session and branch', () => {
    expect(readingPositionKey('s1', 'b1')).not.toBe(readingPositionKey('s1', 'b2'))
    expect(readingPositionKey('s1', null)).toBe('s1:main')
  })

  it('round-trips row anchors and live-end markers', () => {
    const positions = new Map()
    rememberReadingPosition(positions, 's1:main', { key: 'message:m1', top: 42 })
    rememberReadingPosition(positions, 's2:main', null)
    saveReadingPositions(positions)

    expect([...loadReadingPositions()]).toEqual([
      ['s1:main', { key: 'message:m1', top: 42 }],
      ['s2:main', null],
    ])
  })

  it('drops malformed entries rather than failing', () => {
    localStorage.setItem(
      'openwaggle:transcript-reading-positions:v2',
      JSON.stringify([['ok', { key: 'k', top: 1 }], ['bad', { key: 3 }], 'junk']),
    )
    expect([...loadReadingPositions()]).toEqual([['ok', { key: 'k', top: 1 }]])
  })

  it('evicts the least recently used positions beyond the cap', () => {
    const positions = new Map()
    for (let index = 0; index < 105; index += 1) {
      rememberReadingPosition(positions, `s${String(index)}:main`, null)
    }
    rememberReadingPosition(positions, 's0:main', { key: 'k', top: 0 })
    saveReadingPositions(positions)
    const loaded = loadReadingPositions()
    expect(loaded.size).toBe(100)
    expect(loaded.has('s0:main')).toBe(true)
    expect(loaded.has('s1:main')).toBe(false)
  })
})
