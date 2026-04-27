import { describe, expect, it } from 'vitest'
import { buildDeterministicTitle, deduplicateConsecutiveWords } from '../title-generator'

describe('deduplicateConsecutiveWords', () => {
  it('removes concatenated duplicate fragments: "HelloHello" → "Hello"', () => {
    expect(deduplicateConsecutiveWords('HelloHello World Function')).toBe('Hello World Function')
  })

  it('removes space-separated duplicate words: "the the" → "the"', () => {
    expect(deduplicateConsecutiveWords('the the cat')).toBe('the cat')
  })

  it('removes concatenated duplicate at end: "TestTest" → "Test"', () => {
    expect(deduplicateConsecutiveWords('TestTest')).toBe('Test')
  })

  it('preserves normal titles without duplicates', () => {
    expect(deduplicateConsecutiveWords('Hello World')).toBe('Hello World')
    expect(deduplicateConsecutiveWords('A Normal Title')).toBe('A Normal Title')
  })

  it('handles case-insensitive duplicates', () => {
    expect(deduplicateConsecutiveWords('hello Hello world')).toBe('hello world')
  })

  it('handles empty string', () => {
    expect(deduplicateConsecutiveWords('')).toBe('')
  })

  it('handles single word', () => {
    expect(deduplicateConsecutiveWords('Hello')).toBe('Hello')
  })

  it('does not remove non-consecutive duplicates', () => {
    expect(deduplicateConsecutiveWords('Hello World Hello')).toBe('Hello World Hello')
  })

  it('preserves legitimate short-repeat words like CoCo, Papa, MaMa', () => {
    expect(deduplicateConsecutiveWords('CoCo Butter')).toBe('CoCo Butter')
    expect(deduplicateConsecutiveWords('Papa John')).toBe('Papa John')
    expect(deduplicateConsecutiveWords('MaMa')).toBe('MaMa')
  })

  it('deduplicates longer concatenated repeats like FunctionFunction', () => {
    expect(deduplicateConsecutiveWords('FunctionFunction')).toBe('Function')
    expect(deduplicateConsecutiveWords('WorldWorld')).toBe('World')
  })
})

describe('buildDeterministicTitle', () => {
  it('uses the first message content directly when already short', () => {
    expect(buildDeterministicTitle('Fix Electron tray menu state')).toBe(
      'Fix Electron tray menu state',
    )
  })

  it('collapses multiline whitespace into a clean single-line title', () => {
    expect(buildDeterministicTitle('  Investigate bug\n\n in session restore   flow ')).toBe(
      'Investigate bug in session restore flow',
    )
  })

  it('truncates long titles at a word boundary when possible', () => {
    expect(
      buildDeterministicTitle(
        'Implement a complete session projection rebuild around the Pi SDK agent kernel',
      ),
    ).toBe('Implement a complete session projection rebuild around the...')
  })

  it('falls back to New session for empty input', () => {
    expect(buildDeterministicTitle('   ')).toBe('New session')
  })
})
