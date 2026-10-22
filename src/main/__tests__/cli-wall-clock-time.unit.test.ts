import { describe, expect, it } from 'vitest'
import { cliWallClockTime } from '../cli-wall-clock-time'

describe('cliWallClockTime', () => {
  it('shows a moment on the wall clock of the given zone', () => {
    const instant = Date.UTC(2026, 9, 22, 15, 0)
    expect(cliWallClockTime(instant, 'Europe/Madrid')).toBe('2026-10-22 17:00 Europe/Madrid')
    expect(cliWallClockTime(instant, 'America/New_York')).toBe('2026-10-22 11:00 America/New_York')
  })
})
