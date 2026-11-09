import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatBytes,
  formatDuration,
  formatElapsed,
  formatRelativeTime,
  projectName,
  truncate,
} from '../format'

describe('formatElapsed', () => {
  it('formats seconds under 60', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(3_000)).toBe('3s')
    expect(formatElapsed(11_500)).toBe('11s')
    expect(formatElapsed(59_999)).toBe('59s')
  })

  it('formats minutes and seconds at 60+', () => {
    expect(formatElapsed(60_000)).toBe('1m 0s')
    expect(formatElapsed(83_000)).toBe('1m 23s')
    expect(formatElapsed(125_000)).toBe('2m 5s')
    expect(formatElapsed(3_599_999)).toBe('59m 59s')
  })

  it('rolls minutes over into hours at 60m+', () => {
    expect(formatElapsed(3_600_000)).toBe('1h 0m 0s')
    expect(formatElapsed(3_723_000)).toBe('1h 2m 3s')
    expect(formatElapsed(5_400_000)).toBe('1h 30m 0s')
    expect(formatElapsed(90_061_000)).toBe('25h 1m 1s')
  })

  it('clamps negative durations to zero', () => {
    expect(formatElapsed(-1_000)).toBe('0s')
  })
})

describe('formatDuration', () => {
  it('formats milliseconds and seconds correctly', () => {
    expect(formatDuration(120)).toBe('120ms')
    expect(formatDuration(1_500)).toBe('1.5s')
    expect(formatDuration(59_999)).toBe('60.0s')
  })

  it('formats minute ranges correctly', () => {
    expect(formatDuration(60_000)).toBe('1m 0s')
    expect(formatDuration(125_000)).toBe('2m 5s')
    expect(formatDuration(3_599_999)).toBe('59m 59s')
  })

  it('rolls minutes over into hours at 60m+', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m 0s')
    expect(formatDuration(3_723_000)).toBe('1h 2m 3s')
  })

  it('clamps negative durations to zero', () => {
    expect(formatDuration(-5)).toBe('0ms')
    expect(formatDuration(-5_000)).toBe('0ms')
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
  it('handles null, POSIX, and Windows paths', () => {
    expect(projectName(null)).toBe('No project')
    expect(projectName('/Users/diego/OpenWaggle')).toBe('OpenWaggle')
    expect(projectName('C:\\Users\\runner\\OpenWaggle')).toBe('OpenWaggle')
    expect(projectName('C:\\Users\\runner\\OpenWaggle\\')).toBe('OpenWaggle')
  })
})

describe('formatBytes', () => {
  it('reads like disk space: 1024-based, one decimal below ten units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
    expect(formatBytes(312 * 1024 * 1024)).toBe('312 MB')
    expect(formatBytes(3 * 1024 ** 5)).toBe('3072 TB')
  })
})
