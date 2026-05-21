import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDuration, formatRelativeTime, projectName, truncate } from '../format'

describe('formatDuration', () => {
  it('formats milliseconds and seconds correctly', () => {
    expect(formatDuration(120)).toBe('120ms')
    expect(formatDuration(1_500)).toBe('1.5s')
    expect(formatDuration(59_999)).toBe('60.0s')
  })

  it('formats minute ranges correctly', () => {
    expect(formatDuration(60_000)).toBe('1m 0s')
    expect(formatDuration(125_000)).toBe('2m 5s')
  })
})

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders expected buckets', () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000)
    expect(formatRelativeTime(9_500)).toBe('just now')
    expect(formatRelativeTime(9_000)).toBe('just now')
    expect(formatRelativeTime(7_000)).toBe('just now')
    expect(formatRelativeTime(10_000 - 70_000)).toBe('1m ago')
    expect(formatRelativeTime(10_000 - 4 * 60 * 60 * 1000)).toBe('4h ago')
    expect(formatRelativeTime(10_000 - 2 * 24 * 60 * 60 * 1000)).toBe('2d ago')
  })
})

describe('truncate', () => {
  it('returns full string when within max length', () => {
    expect(truncate('OpenWaggle', 20)).toBe('OpenWaggle')
  })

  it('adds ellipsis when input exceeds max length', () => {
    expect(truncate('OpenWaggleDesktop', 10)).toBe('OpenWag...')
  })
})

describe('projectName', () => {
  it('handles null and slash-delimited paths', () => {
    expect(projectName(null)).toBe('No project')
    expect(projectName('/Users/diego/OpenWaggle')).toBe('OpenWaggle')
  })
})
