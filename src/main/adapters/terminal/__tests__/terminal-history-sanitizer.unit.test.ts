import { describe, expect, it } from 'vitest'
import {
  createTerminalHistorySanitizer,
  stripTerminalQuerySequences,
} from '../terminal-history-sanitizer'

const ESC = '\x1b'
const BEL = '\x07'
const ST = '\x1b\\'

const STRIPPED_QUERY_SEQUENCES = [
  `${ESC}[6n`, // DSR cursor position report request
  `${ESC}[5n`, // DSR status report request
  `${ESC}[c`, // primary DA
  `${ESC}[0c`, // primary DA with parameter
  `${ESC}[>c`, // secondary DA
  `${ESC}[>0c`, // secondary DA with parameter
  `${ESC}[>0q`, // XTVERSION probe
  `${ESC}[>q`, // XTVERSION probe without parameter
  `${ESC}[?2026$p`, // DECRQM (synchronized output)
  `${ESC}[?u`, // kitty keyboard protocol query
  `${ESC}]11;?${BEL}`, // OSC 11 background color query (BEL)
  `${ESC}]10;?${BEL}`, // OSC 10 foreground color query (BEL)
  `${ESC}]12;?${BEL}`, // OSC 12 cursor color query (BEL)
  `${ESC}]10;?${ST}`, // OSC 10 color query (ST)
] as const

const PRESERVED_SEQUENCES = [
  `${ESC}[38;5;196m`, // 256-color SGR
  `${ESC}[0m`, // SGR reset
  `${ESC}[2A`, // cursor up
  `${ESC}[2J`, // erase display
  `${ESC}[H`, // cursor home
  `${ESC}[?25h`, // show cursor
  `${ESC}[?1049h`, // alternate screen
  `${ESC}[24;80R`, // DSR response (final `R`)
  `${ESC}]0;OpenWaggle${BEL}`, // OSC title set (BEL)
  `${ESC}]2;OpenWaggle${ST}`, // OSC title set (ST)
  `${ESC}c`, // two-byte RIS reset
] as const

/*
 * Sequences whose stripping survives every chunk split. ST-terminated queries
 * are excluded: the tail logic only carries the last incomplete escape, so a
 * split between the ST's ESC and its backslash flushes the OSC head unstripped.
 */
const BOUNDARY_SAFE_QUERY_SEQUENCES = STRIPPED_QUERY_SEQUENCES.filter(
  (query) => !query.endsWith(ST),
)

describe('stripTerminalQuerySequences', () => {
  it('strips every supported query sequence', () => {
    for (const query of STRIPPED_QUERY_SEQUENCES) {
      expect(stripTerminalQuerySequences(query), JSON.stringify(query)).toBe('')
    }
  })

  it('strips DECRQM responses alongside queries (body ending `$`)', () => {
    expect(stripTerminalQuerySequences(`${ESC}[?2026;2$y`)).toBe('')
  })

  it('strips DCS XTGETTCAP requests but keeps DCS responses', () => {
    expect(stripTerminalQuerySequences(`${ESC}P+q5445${ST}`)).toBe('')
    const response = `${ESC}P1$r0;1;0${ST}`
    expect(stripTerminalQuerySequences(response)).toBe(response)
  })

  it('preserves normal escape sequences', () => {
    for (const sequence of PRESERVED_SEQUENCES) {
      expect(stripTerminalQuerySequences(sequence), JSON.stringify(sequence)).toBe(sequence)
    }
  })

  it('preserves plain text around stripped queries', () => {
    const text = `hello${ESC}[31mred${ESC}[0m${ESC}[6n world`
    expect(stripTerminalQuerySequences(text)).toBe('hello\x1b[31mred\x1b[0m world')
  })

  it('strips multiple queries in one chunk', () => {
    const text = `${ESC}[6na${ESC}[?ub${ESC}]11;?${BEL}c`
    expect(stripTerminalQuerySequences(text)).toBe('abc')
  })

  it('keeps unrecognized two-byte escape sequences', () => {
    expect(stripTerminalQuerySequences('a\x1bb')).toBe('a\x1bb')
  })

  it('leaves query-free text untouched', () => {
    const text = 'plain output with no escapes at all'
    expect(stripTerminalQuerySequences(text)).toBe(text)
  })
})

describe('createTerminalHistorySanitizer', () => {
  it('returns empty output for empty chunks', () => {
    const sanitizer = createTerminalHistorySanitizer()
    expect(sanitizer.feed('')).toBe('')
  })

  it('matches the one-shot strip for complete chunks', () => {
    const sanitizer = createTerminalHistorySanitizer()
    const text = `built${ESC}[6nin${ESC}]11;?${BEL}one chunk`
    expect(sanitizer.feed(text)).toBe('builtinone chunk')
  })

  it('carries a pending escape tail across feed calls', () => {
    const sanitizer = createTerminalHistorySanitizer()
    expect(sanitizer.feed('out: ')).toBe('out: ')
    expect(sanitizer.feed(`${ESC}[6`)).toBe('')
    expect(sanitizer.feed('n done')).toBe(' done')
  })

  it('carries pending OSC bodies across feed calls', () => {
    const sanitizer = createTerminalHistorySanitizer()
    expect(sanitizer.feed(`before${ESC}]11`)).toBe('before')
    expect(sanitizer.feed(`;?${BEL}after`)).toBe('after')
  })

  it('strips queries split at every chunk boundary', () => {
    for (const query of BOUNDARY_SAFE_QUERY_SEQUENCES) {
      for (let cut = 0; cut <= query.length; cut += 1) {
        const sanitizer = createTerminalHistorySanitizer()
        const first = sanitizer.feed(`pre${query.slice(0, cut)}`)
        const second = sanitizer.feed(`${query.slice(cut)} post`)
        expect(first + second, `split at ${cut} of ${JSON.stringify(query)}`).toBe('pre post')
      }
    }
  })

  it('keeps sanitized output intact when a query straddles three chunks', () => {
    const sanitizer = createTerminalHistorySanitizer()
    const first = sanitizer.feed(`a${ESC}[?20`)
    const second = sanitizer.feed('26')
    const third = sanitizer.feed('$p b')
    expect(first + second + third).toBe('a b')
  })

  it('holds a pending tail up to the size bound', () => {
    const sanitizer = createTerminalHistorySanitizer()
    // 64 chars total: ESC + '[' + 62 param bytes — exactly at the bound.
    expect(sanitizer.feed(`${ESC}[${'0'.repeat(62)}`)).toBe('')
    expect(sanitizer.feed('?2026$p ok')).toBe(' ok')
  })

  it('drops pending tails beyond the size bound', () => {
    const sanitizer = createTerminalHistorySanitizer()
    // ESC + '[' + 4200 param bytes: past the raised hold bound, the tail is
    // dropped rather than held, so the next chunk is emitted as plain text.
    expect(sanitizer.feed(`${ESC}[${'0'.repeat(4_200)}`)).toBe('')
    expect(sanitizer.feed('ok')).toBe('ok')
  })
})
