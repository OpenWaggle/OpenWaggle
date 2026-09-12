import { describe, expect, it } from 'vitest'
import { createTerminalPromptReadinessDetector } from '../terminal-prompt-readiness'

const ESC = '\x1b'
const BEL = '\x07'
const ST = `${ESC}\\`

const ACCEPTED_MARKERS = [
  `${ESC}]133;B${BEL}`,
  `${ESC}]133;B${ST}`,
  `${ESC}]633;B${BEL}`,
  `${ESC}]633;B${ST}`,
]

const REJECTED_SEQUENCES = [
  'plain prompt output $ ',
  `${ESC}]133;A${BEL}`,
  `${ESC}]133;D${BEL}`,
  `${ESC}]633;P;Cwd=/tmp${BEL}`,
  `${ESC}]7;file://host/tmp${BEL}`,
  `${ESC}]0;window title${BEL}`,
  `${ESC}[?1034h`,
]

describe('createTerminalPromptReadinessDetector', () => {
  it.each(ACCEPTED_MARKERS)('accepts prompt-end marker %j', (marker) => {
    const detector = createTerminalPromptReadinessDetector()

    expect(detector.feed(`banner${marker}`)).toBe(1)
  })

  it.each(REJECTED_SEQUENCES)('rejects non-readiness sequence %j', (sequence) => {
    const detector = createTerminalPromptReadinessDetector()

    expect(detector.feed(sequence)).toBe(0)
  })

  it.each(ACCEPTED_MARKERS)('recognizes %j split at every byte boundary', (marker) => {
    for (let split = 1; split < marker.length; split += 1) {
      const detector = createTerminalPromptReadinessDetector()

      expect(detector.feed(marker.slice(0, split))).toBe(0)
      expect(detector.feed(marker.slice(split))).toBe(1)
    }
  })

  it('recognizes a marker delivered one byte at a time', () => {
    const detector = createTerminalPromptReadinessDetector()
    const marker = `${ESC}]633;B${ST}`

    const matches = [...marker].map((character) => detector.feed(character))

    expect(matches.filter(Boolean)).toHaveLength(1)
    expect(matches.at(-1)).toBe(1)
  })

  it('requires the configured nonce and rejects a stale marker', () => {
    const detector = createTerminalPromptReadinessDetector('fresh-generation')

    expect(detector.feed(`${ESC}]633;B;stale-generation${BEL}`)).toBe(0)
    expect(detector.feed(`${ESC}]633;B${BEL}`)).toBe(0)
    expect(detector.feed(`${ESC}]633;B;fresh-generation${BEL}`)).toBe(1)
  })

  it('does not carry a rejected OSC payload into a later valid marker', () => {
    const detector = createTerminalPromptReadinessDetector()

    expect(detector.feed(`${ESC}]0;title${BEL}${ESC}]133;`)).toBe(0)
    expect(detector.feed(`B${BEL}`)).toBe(1)
  })

  it('counts later prompts and multiple markers in one chunk', () => {
    const detector = createTerminalPromptReadinessDetector()
    const marker = `${ESC}]133;B${BEL}`

    expect(detector.feed(marker)).toBe(1)
    expect(detector.feed(`${marker}output${marker}`)).toBe(2)
  })
})
