import { describe, expect, it } from 'vitest'
import { zonedTimestamp } from '../zoned-time'

describe('zonedTimestamp', () => {
  it('keeps the seconds and names the UTC offset of the zone at that moment', () => {
    // 2026-10-26 08:58:59Z is 09:58:59 in Madrid, on winter time (+01:00) again.
    expect(zonedTimestamp(Date.UTC(2026, 9, 26, 8, 58, 59), 'Europe/Madrid')).toBe(
      '2026-10-26 09:58:59 +01:00',
    )
    expect(zonedTimestamp(Date.UTC(2026, 5, 1, 7, 0, 0), 'Europe/Madrid')).toBe(
      '2026-06-01 09:00:00 +02:00',
    )
    expect(zonedTimestamp(Date.UTC(2026, 5, 1, 7, 0, 0), 'America/St_Johns')).toBe(
      '2026-06-01 04:30:00 -02:30',
    )
    expect(zonedTimestamp(Date.UTC(2026, 5, 1, 7, 0, 0), 'UTC')).toBe('2026-06-01 07:00:00 +00:00')
  })

  it('tells the two occurrences of a repeated hour apart when clocks go back', () => {
    // Madrid repeats 02:00-03:00 on 2026-10-25: first at +02:00, then at +01:00.
    const first = zonedTimestamp(Date.UTC(2026, 9, 25, 0, 30), 'Europe/Madrid')
    const second = zonedTimestamp(Date.UTC(2026, 9, 25, 1, 30), 'Europe/Madrid')
    expect(first).toBe('2026-10-25 02:30:00 +02:00')
    expect(second).toBe('2026-10-25 02:30:00 +01:00')
  })
})
