import { describe, expect, it } from 'vitest'
import { createTerminalHistorySanitizer } from '../terminal-history-sanitizer'

describe('split OSC query residue', () => {
  it('holds an OSC query split before its ST terminator', () => {
    const sanitizer = createTerminalHistorySanitizer()
    const first = sanitizer.feed('plain\x1b]11;?')
    const second = sanitizer.feed('\x1b\\after')
    expect(first + second).toBe('plainafter')
  })

  it('holds a kitty keyboard query split before its final byte', () => {
    const sanitizer = createTerminalHistorySanitizer()
    const first = sanitizer.feed('a\x1b[?')
    const second = sanitizer.feed('uafter')
    expect(first + second).toBe('aafter')
  })

  it('holds a DECRQM query split before its final byte', () => {
    const sanitizer = createTerminalHistorySanitizer()
    const first = sanitizer.feed('a\x1b[?2004$')
    const second = sanitizer.feed('pafter')
    expect(first + second).toBe('aafter')
  })

  it('still preserves complete non-query sequences split across chunks', () => {
    const sanitizer = createTerminalHistorySanitizer()
    const first = sanitizer.feed('x\x1b[38;5;19')
    const second = sanitizer.feed('6mY')
    expect(first + second).toBe('x\x1b[38;5;196mY')
  })
})

describe('oversized incomplete tails', () => {
  const longPayload = `cmd-${'x'.repeat(500)}`

  it('holds an incomplete shell-integration OSC longer than 64 bytes across chunks', () => {
    const sanitizer = createTerminalHistorySanitizer()
    // OSC 133 is shell integration, not a query: held while incomplete, then
    // preserved intact once the BEL terminator arrives.
    const first = sanitizer.feed(`\x1b]133;C;${longPayload}`)
    expect(first).toBe('')
    const second = sanitizer.feed('\x07tail')
    expect(second).toBe(`\x1b]133;C;${longPayload}\x07tail`)
  })

  it('strips an OSC color query longer than 64 bytes split across chunks', () => {
    const sanitizer = createTerminalHistorySanitizer()
    const first = sanitizer.feed(`\x1b]11;?;${'p'.repeat(300)}`)
    expect(first).toBe('')
    const second = sanitizer.feed('\x1b\\tail')
    expect(second).toBe('tail')
  })

  it('preserves a complete long non-query OSC split across chunks', () => {
    const sanitizer = createTerminalHistorySanitizer()
    const first = sanitizer.feed(`\x1b]2;${longPayload}`)
    const second = sanitizer.feed('\x07done')
    expect(first + second).toBe(`\x1b]2;${longPayload}\x07done`)
  })
})
