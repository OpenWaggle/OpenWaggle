import { describe, expect, it } from 'vitest'
import { shouldUseHiddenElectron } from '../electron-launch-mode'
import { buildPlaywrightElectronEnvironment } from '../playwright-electron-launcher'
import { buildSafeElectronEnvironment } from '../safe-electron-environment'

describe('Playwright Electron launch mode', () => {
  it('uses hidden automation unless headed mode is explicit', () => {
    expect(shouldUseHiddenElectron(true)).toBe(true)
    expect(shouldUseHiddenElectron(undefined)).toBe(true)
    expect(shouldUseHiddenElectron(false)).toBe(false)
  })

  it('translates headed intent into the Electron child environment', () => {
    expect(
      buildPlaywrightElectronEnvironment({ userDataDir: '/tmp/hidden', hidden: true }),
    ).toMatchObject({ OPENWAGGLE_AUTOMATION: '1' })
    expect(
      buildPlaywrightElectronEnvironment({ userDataDir: '/tmp/headed', hidden: false }),
    ).not.toHaveProperty('OPENWAGGLE_AUTOMATION')
  })

  it('does not forward unrelated parent secrets', () => {
    process.env.OPENWAGGLE_QA_TEST_SECRET = 'must-not-leak'
    try {
      expect(buildSafeElectronEnvironment({ REQUIRED: 'value' })).toEqual(
        expect.not.objectContaining({ OPENWAGGLE_QA_TEST_SECRET: 'must-not-leak' }),
      )
    } finally {
      delete process.env.OPENWAGGLE_QA_TEST_SECRET
    }
  })
})
