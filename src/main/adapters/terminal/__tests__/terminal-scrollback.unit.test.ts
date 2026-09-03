import { TERMINAL } from '@shared/constants/resource-limits'
import { describe, expect, it } from 'vitest'
import { createTerminalScrollback } from '../terminal-scrollback'

describe('createTerminalScrollback', () => {
  it('returns appended text verbatim', () => {
    const scrollback = createTerminalScrollback()
    scrollback.append('hello ')
    scrollback.append('world\n')
    expect(scrollback.toString()).toBe('hello world\n')
  })

  it('counts lines across appends', () => {
    const scrollback = createTerminalScrollback()
    expect(scrollback.lineCount).toBe(0)
    scrollback.append('a\nb\nc\n')
    expect(scrollback.lineCount).toBe(3)
    scrollback.append('d\n')
    expect(scrollback.lineCount).toBe(4)
  })

  it('joins partial lines across appends', () => {
    const scrollback = createTerminalScrollback()
    scrollback.append('first')
    expect(scrollback.lineCount).toBe(0)
    scrollback.append(' line\n')
    expect(scrollback.lineCount).toBe(1)
    expect(scrollback.toString()).toBe('first line\n')
  })

  it('ignores empty appends', () => {
    const scrollback = createTerminalScrollback()
    scrollback.append('')
    expect(scrollback.toString()).toBe('')
    expect(scrollback.lineCount).toBe(0)
  })

  it('trims to the newest maxLines when the cap is exceeded', () => {
    const scrollback = createTerminalScrollback(3)
    scrollback.append('a\nb\nc\nd\ne\n')
    expect(scrollback.lineCount).toBe(3)
    expect(scrollback.toString()).toBe('c\nd\ne\n')
  })

  it('keeps a partial leading line while trimming', () => {
    const scrollback = createTerminalScrollback(2)
    scrollback.append('a\nb')
    scrollback.append('c\nd\n')
    expect(scrollback.lineCount).toBe(2)
    expect(scrollback.toString()).toBe('bc\nd\n')
  })

  it('does not trim when the cap is met exactly', () => {
    const scrollback = createTerminalScrollback(3)
    scrollback.append('a\nb\nc\n')
    expect(scrollback.lineCount).toBe(3)
    expect(scrollback.toString()).toBe('a\nb\nc\n')
  })

  it('caps at the shared scrollback limit by default', () => {
    const scrollback = createTerminalScrollback()
    const lines = Array.from(
      { length: TERMINAL.MAX_SCROLLBACK_LINES + 100 },
      (_, index) => `line-${index}\n`,
    )
    scrollback.append(lines.join(''))
    expect(scrollback.lineCount).toBe(TERMINAL.MAX_SCROLLBACK_LINES)
    expect(scrollback.toString().slice(0, 9)).toBe('line-100\n')
  })

  it('reset clears text and line count', () => {
    const scrollback = createTerminalScrollback()
    scrollback.append('a\nb\n')
    scrollback.reset()
    expect(scrollback.toString()).toBe('')
    expect(scrollback.lineCount).toBe(0)
  })
})
