import { describe, expect, it } from 'vitest'
import { splitAtIncompleteTail, stripTerminalQuerySequences } from '../terminal-escape-sequences'

const ESC = '\x1b'
const BEL = '\x07'
const ST = `${ESC}\\`

describe('terminal query sequences', () => {
  it('strips Pi TUI palette probes for colours 0-15 and keeps the text around them', () => {
    const probe = Array.from({ length: 16 }, (_, index) => `${ESC}]4;${index};?${ST}`).join('')
    expect(stripTerminalQuerySequences(`before${probe}after`)).toBe('beforeafter')
  })

  it('strips an OSC 4 that sets one colour and queries another, since xterm would answer it', () => {
    expect(stripTerminalQuerySequences(`${ESC}]4;1;rgb:cc/00/00;2;?${BEL}`)).toBe('')
  })

  it('keeps colour sets, resets, and answers that only change what renders', () => {
    const kept = [
      `${ESC}]4;1;rgb:cc/00/00${ST}`,
      `${ESC}]11;rgb:00/00/00${BEL}`,
      `${ESC}]104${ST}`,
      `${ESC}]110${BEL}`,
      `${ESC}P1$r0m${ST}`,
      `${ESC}[8;24;80t`,
    ].join('')
    expect(stripTerminalQuerySequences(kept)).toBe(kept)
  })

  it('does not treat other OSC commands with a question mark as queries', () => {
    const kept = `${ESC}]0;what?${BEL}${ESC}]8;;https://example.com/?q=1${ST}`
    expect(stripTerminalQuerySequences(kept)).toBe(kept)
  })

  it('keeps an incomplete trailing sequence for live output to complete', () => {
    expect(stripTerminalQuerySequences(`text${ESC}[6n${ESC}]4;3;`)).toBe(`text${ESC}]4;3;`)
    expect(splitAtIncompleteTail(`text${ESC}]4;3;`)).toEqual({
      complete: 'text',
      incomplete: `${ESC}]4;3;`,
    })
  })
})
