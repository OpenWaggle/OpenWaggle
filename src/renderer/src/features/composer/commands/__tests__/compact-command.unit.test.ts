import { describe, expect, it } from 'vitest'
import { compactCommandText, parseCompactCommand } from '../compact-command'

describe('compact command parsing', () => {
  it('accepts the bare /compact command', () => {
    expect(parseCompactCommand('/compact')).toEqual({})
  })

  it('accepts custom compaction instructions after /compact', () => {
    expect(parseCompactCommand('/compact preserve the failing test context')).toEqual({
      customInstructions: 'preserve the failing test context',
    })
  })

  it('trims whitespace around the command and instructions', () => {
    expect(parseCompactCommand('  /compact   focus on provider auth  ')).toEqual({
      customInstructions: 'focus on provider auth',
    })
  })

  it('rejects lookalike commands', () => {
    expect(parseCompactCommand('/compactly')).toBeNull()
    expect(parseCompactCommand('please /compact')).toBeNull()
  })

  it('formats the command text with optional instructions', () => {
    expect(compactCommandText()).toBe('/compact')
    expect(compactCommandText(' keep migration findings ')).toBe('/compact keep migration findings')
  })
})
