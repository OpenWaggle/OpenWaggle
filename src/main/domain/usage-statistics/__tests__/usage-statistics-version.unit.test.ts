import { describe, expect, it } from 'vitest'
import {
  compareUsageStatisticsVersions,
  isUsageStatisticsVersionUpgrade,
} from '../usage-statistics-version'

describe('Usage statistics version precedence', () => {
  it('orders release versions by semver precedence', () => {
    const ascending = [
      '0.9.9',
      '1.0.0-alpha.1',
      '1.0.0-alpha.9',
      '1.0.0-alpha.10',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0-alpha.1',
    ]

    for (let index = 1; index < ascending.length; index += 1) {
      const lower = ascending[index - 1] ?? ''
      const higher = ascending[index] ?? ''
      expect(compareUsageStatisticsVersions(lower, higher)).toBe(-1)
      expect(compareUsageStatisticsVersions(higher, lower)).toBe(1)
    }
    expect(compareUsageStatisticsVersions('1.0.0-beta.4', '1.0.0-beta.4')).toBe(0)
  })

  it('counts only a higher version as an installed update', () => {
    expect(isUsageStatisticsVersionUpgrade('1.0.0-beta.4', '1.0.0-beta.5')).toBe(true)
    expect(isUsageStatisticsVersionUpgrade('1.0.0-rc.2', '1.0.0')).toBe(true)
    // A downgrade, a reinstall, or a channel switch that installs an older build.
    expect(isUsageStatisticsVersionUpgrade('1.0.0', '1.0.0-rc.2')).toBe(false)
    expect(isUsageStatisticsVersionUpgrade('1.0.0-beta.4', '1.0.0-alpha.9')).toBe(false)
    expect(isUsageStatisticsVersionUpgrade('1.0.0-beta.4', '1.0.0-beta.4')).toBe(false)
  })

  it('compares nothing that is not a release version', () => {
    expect(compareUsageStatisticsVersions('1.0', '1.0.0')).toBeUndefined()
    expect(compareUsageStatisticsVersions('1.0.0+local', '1.0.0')).toBeUndefined()
    expect(isUsageStatisticsVersionUpgrade('dev', '1.0.0')).toBe(false)
  })
})
