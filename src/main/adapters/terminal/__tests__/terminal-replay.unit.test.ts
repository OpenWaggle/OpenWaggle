import { describe, expect, it } from 'vitest'
import {
  COLD_REPLAY_STATE_BOUNDARY,
  coldTerminalReplay,
  PREVIOUS_TERMINAL_SESSION_SEPARATOR,
} from '../terminal-replay'

const ESC = '\x1b'

describe('coldTerminalReplay', () => {
  it('places the inert historical body before a state boundary and session separator', () => {
    const replay = coldTerminalReplay('historical output')

    expect(replay).toBe(
      `historical output\r\n${COLD_REPLAY_STATE_BOUNDARY}${PREVIOUS_TERMINAL_SESSION_SEPARATOR}`,
    )
    expect(replay.indexOf('historical output')).toBeLessThan(
      replay.indexOf('Previous terminal session'),
    )
  })

  it('neutralizes dead TUI state before the new-session boundary', () => {
    const replay = coldTerminalReplay(
      `visible${ESC}[?1049h${ESC}[2J${ESC}[H${ESC}[3;12r${ESC}[31mred`,
    )

    expect(replay).toBe(
      `visible${ESC}[31mred\r\n${COLD_REPLAY_STATE_BOUNDARY}${PREVIOUS_TERMINAL_SESSION_SEPARATOR}`,
    )
    expect(replay).not.toContain(`${ESC}[?1049h`)
    expect(replay).not.toContain(`${ESC}[2J`)
    expect(replay).not.toContain(`${ESC}[3;12r`)
  })

  it('does not manufacture a previous-session marker for empty history', () => {
    expect(coldTerminalReplay('')).toBe('')
  })
})
