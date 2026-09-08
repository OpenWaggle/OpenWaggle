import { describe, expect, it } from 'vitest'
import {
  beginTerminalEventOwnerHandoff,
  terminalEventMatchesOwner,
} from '../terminal-event-owner-alias'

describe('terminal event owner handoff', () => {
  it('temporarily routes destination events to the pre-migration pane', () => {
    const release = beginTerminalEventOwnerHandoff('draft:/repo', 'session-1')

    expect(terminalEventMatchesOwner('draft:/repo', 'session-1')).toBe(true)
    expect(terminalEventMatchesOwner('session-1', 'session-1')).toBe(true)

    release()
    expect(terminalEventMatchesOwner('draft:/repo', 'session-1')).toBe(false)
  })

  it('reference-counts overlapping handoffs without leaking an alias', () => {
    const releaseFirst = beginTerminalEventOwnerHandoff('draft:/repo', 'session-1')
    const releaseSecond = beginTerminalEventOwnerHandoff('draft:/repo', 'session-1')

    releaseFirst()
    expect(terminalEventMatchesOwner('draft:/repo', 'session-1')).toBe(true)

    releaseSecond()
    expect(terminalEventMatchesOwner('draft:/repo', 'session-1')).toBe(false)
  })
})
