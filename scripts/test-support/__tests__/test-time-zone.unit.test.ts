import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TEST_TIME_ZONE, testTimeZone } from '../vitest-tier-options'

const JANUARY_FIRST = new Date(2026, 0, 1)

describe('the test time zone', () => {
  it('defaults to a zone far east of UTC, so local and UTC days differ for most of the day', () => {
    expect(DEFAULT_TEST_TIME_ZONE).toBe('Pacific/Kiritimati')
    expect(testTimeZone({})).toBe('Pacific/Kiritimati')
  })

  it('takes another zone from OPENWAGGLE_TEST_TIME_ZONE, as the nightly west-of-UTC run does', () => {
    expect(testTimeZone({ OPENWAGGLE_TEST_TIME_ZONE: 'America/Adak' })).toBe('America/Adak')
  })

  it('is the zone this test file runs in, whatever the machine zone is', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(testTimeZone())
    expect(process.env.TZ).toBe(testTimeZone())
  })

  it('lets one test choose its own zone', () => {
    vi.stubEnv('TZ', 'America/Adak')
    try {
      // Adak is UTC-10 in January.
      expect(JANUARY_FIRST.getTimezoneOffset()).toBe(600)
    } finally {
      vi.unstubAllEnvs()
    }
    expect(process.env.TZ).toBe(testTimeZone())
  })
})
