import { describe, expect, it } from 'vitest'
import { readPackageSmokeEnvironment } from '../package-smoke-env'

describe('readPackageSmokeEnvironment', () => {
  it('enables browser QA only for the explicit opt-in value', () => {
    expect(readPackageSmokeEnvironment({ OPENWAGGLE_PACKAGE_BROWSER_SMOKE: '1' })).toEqual({
      browserExecutablePath: undefined,
      browserSmokeEnabled: true,
    })
    expect(readPackageSmokeEnvironment({ OPENWAGGLE_PACKAGE_BROWSER_SMOKE: 'true' })).toEqual({
      browserExecutablePath: undefined,
      browserSmokeEnabled: false,
    })
  })

  it('normalizes an optional browser executable path', () => {
    expect(
      readPackageSmokeEnvironment({
        OPENWAGGLE_PACKAGE_BROWSER_EXECUTABLE: '  /Applications/Chromium.app  ',
      }),
    ).toEqual({
      browserExecutablePath: '/Applications/Chromium.app',
      browserSmokeEnabled: false,
    })
  })
})
