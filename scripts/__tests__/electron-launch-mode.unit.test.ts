import { afterEach, describe, expect, it, vi } from 'vitest'
import { shouldUseHiddenElectron } from '../electron-launch-mode'
import { buildPlaywrightElectronEnvironment } from '../playwright-electron-launcher'
import { buildSafeElectronEnvironment } from '../safe-electron-environment'

describe('Playwright Electron launch mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

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

  it('keeps an explicitly isolated Pi fixture directory without enabling extensions', () => {
    expect(
      buildPlaywrightElectronEnvironment({
        userDataDir: '/tmp/compaction',
        hidden: true,
        piAgentDir: '/tmp/compaction/pi-agent',
      }),
    ).toMatchObject({
      OPENWAGGLE_AUTOMATION: '1',
      PI_CODING_AGENT_DIR: '/tmp/compaction/pi-agent',
    })
  })

  it('allows shell fixtures without yielding automation or storage authority', () => {
    expect(
      buildPlaywrightElectronEnvironment({
        userDataDir: '/tmp/hidden',
        hidden: true,
        environment: {
          OPENWAGGLE_AUTOMATION: '0',
          OPENWAGGLE_USER_DATA_DIR: '/tmp/wrong',
          SHELL: '/bin/test-shell',
          ZDOTDIR: '/tmp/test-zdotdir',
        },
      }),
    ).toMatchObject({
      OPENWAGGLE_AUTOMATION: '1',
      OPENWAGGLE_USER_DATA_DIR: '/tmp/hidden',
      SHELL: '/bin/test-shell',
      ZDOTDIR: '/tmp/test-zdotdir',
    })
  })

  it('does not forward unrelated parent secrets', () => {
    vi.stubEnv('OPENWAGGLE_QA_TEST_SECRET', 'must-not-leak')
    expect(buildSafeElectronEnvironment({ REQUIRED: 'value' })).toEqual(
      expect.not.objectContaining({ OPENWAGGLE_QA_TEST_SECRET: 'must-not-leak' }),
    )
  })

  it('forwards a caller-chosen compile cache directory past a throwaway HOME', () => {
    vi.stubEnv('OPENWAGGLE_COMPILE_CACHE_DIR', '/tmp/perf/compile-cache')
    expect(buildSafeElectronEnvironment({ HOME: '/tmp/qa-scratch/home' })).toMatchObject({
      HOME: '/tmp/qa-scratch/home',
      OPENWAGGLE_COMPILE_CACHE_DIR: '/tmp/perf/compile-cache',
    })
  })

  it('forwards the desktop session bus, as a launch from the desktop inherits it', () => {
    vi.stubEnv('DBUS_SESSION_BUS_ADDRESS', 'unix:path=/run/user/1000/bus')
    expect(buildSafeElectronEnvironment({})).toMatchObject({
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
    })
  })

  it('forwards the caller Pi agent directory so a scratch one reaches the app', () => {
    vi.stubEnv('PI_CODING_AGENT_DIR', '/tmp/qa-scratch/pi-agent')
    expect(buildSafeElectronEnvironment({})).toMatchObject({
      PI_CODING_AGENT_DIR: '/tmp/qa-scratch/pi-agent',
    })
  })

  it('lets a launcher override an inherited location', () => {
    vi.stubEnv('HOME', '/Users/maintainer')
    expect(buildSafeElectronEnvironment({ HOME: '/tmp/qa-profile/qa-home' })).toMatchObject({
      HOME: '/tmp/qa-profile/qa-home',
    })
  })

  it('forwards the Host temp directory so a QA app leaves the agent scratch directory', () => {
    vi.stubEnv('OPENWAGGLE_HOST_TMPDIR', '/var/folders/host/T')
    expect(buildSafeElectronEnvironment({})).toMatchObject({
      OPENWAGGLE_HOST_TMPDIR: '/var/folders/host/T',
    })
  })

  it('forwards the display and X authority required by a Linux virtual display', () => {
    vi.stubEnv('DISPLAY', ':99')
    vi.stubEnv('XAUTHORITY', '/tmp/xvfb-authority')
    expect(buildSafeElectronEnvironment({})).toMatchObject({
      DISPLAY: ':99',
      XAUTHORITY: '/tmp/xvfb-authority',
    })
  })
})
