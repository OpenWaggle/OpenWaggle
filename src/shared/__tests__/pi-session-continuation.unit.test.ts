import { describe, expect, it } from 'vitest'
import { isPiSessionContinuationChoice, piSessionContinueCommand } from '../pi-session-continuation'

describe('Pi continuation choice', () => {
  it('quotes the session file for the shell the terminal runs', () => {
    expect(piSessionContinueCommand("/Users/me/it's here/s.jsonl", 'posix')).toBe(
      `pi --session '/Users/me/it'\\''s here/s.jsonl'`,
    )
    expect(piSessionContinueCommand("C:\\Users\\me\\it's\\s.jsonl", 'powershell')).toBe(
      "pi --session 'C:\\Users\\me\\it''s\\s.jsonl'",
    )
  })

  it('knows the two choices', () => {
    expect(isPiSessionContinuationChoice('openwaggle')).toBe(true)
    expect(isPiSessionContinuationChoice('pi')).toBe(true)
    expect(isPiSessionContinuationChoice('ask')).toBe(false)
  })
})
