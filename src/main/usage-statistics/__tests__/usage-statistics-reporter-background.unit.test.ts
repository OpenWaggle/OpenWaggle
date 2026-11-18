import { validateUsageStatisticsContext } from '@shared/usage-statistics/validation'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@shared/build-identity-runtime', () => ({
  BUILD_CHANNEL: 'beta',
  PRODUCT_NAME: 'OpenWaggle',
}))

import { usageStatisticsProcessContext } from '../usage-statistics-reporter-background'

describe('Usage statistics request context', () => {
  it('describes this released build with published values only', () => {
    const context = usageStatisticsProcessContext({
      appVersion: '1.0.0-beta.4',
      updateChannel: 'beta',
    })

    expect(context).toEqual({
      version: '1.0.0-beta.4',
      build_channel: 'beta',
      update_channel: 'beta',
      os: process.platform,
      arch: process.arch,
    })
    expect(validateUsageStatisticsContext(context).ok).toBe(true)
  })

  it('cannot describe a build whose version is not a release version', () => {
    for (const appVersion of ['1.0.0+local build', '1.0.0-dev', '0.0.0-test', '1.0.0-beta']) {
      expect(usageStatisticsProcessContext({ appVersion, updateChannel: 'stable' })).toBeUndefined()
    }
    expect(
      usageStatisticsProcessContext({ appVersion: '1.0.0-rc.2', updateChannel: 'beta' }),
    ).toMatchObject({ version: '1.0.0-rc.2' })
  })
})
