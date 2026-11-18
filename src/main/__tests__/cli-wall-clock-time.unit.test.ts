import { describe, expect, it } from 'vitest'
import { cliWallClockTime } from '../cli-wall-clock-time'

describe('cliWallClockTime', () => {
  it('shows a moment on the wall clock of the given zone, with seconds and UTC offset', () => {
    const instant = Date.UTC(2026, 9, 22, 15, 0, 7)
    expect(cliWallClockTime(instant, 'Europe/Madrid')).toBe(
      '2026-10-22 17:00:07 +02:00 Europe/Madrid',
    )
    expect(cliWallClockTime(instant, 'America/New_York')).toBe(
      '2026-10-22 11:00:07 -04:00 America/New_York',
    )
  })

  it('tells the two occurrences of a repeated hour apart', () => {
    expect(cliWallClockTime(Date.UTC(2026, 9, 25, 0, 30), 'Europe/Madrid')).toBe(
      '2026-10-25 02:30:00 +02:00 Europe/Madrid',
    )
    expect(cliWallClockTime(Date.UTC(2026, 9, 25, 1, 30), 'Europe/Madrid')).toBe(
      '2026-10-25 02:30:00 +01:00 Europe/Madrid',
    )
  })
})
