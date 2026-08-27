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

  it('forwards the display and X authority required by a Linux virtual display', () => {
    const previousDisplay = process.env.DISPLAY
    const previousXAuthority = process.env.XAUTHORITY
    process.env.DISPLAY = ':99'
    process.env.XAUTHORITY = '/tmp/xvfb-authority'
    try {
      expect(buildSafeElectronEnvironment({})).toMatchObject({
        DISPLAY: ':99',
        XAUTHORITY: '/tmp/xvfb-authority',
      })
    } finally {
      if (previousDisplay === undefined) delete process.env.DISPLAY
      else process.env.DISPLAY = previousDisplay
      if (previousXAuthority === undefined) delete process.env.XAUTHORITY
      else process.env.XAUTHORITY = previousXAuthority
    }
  })
})
