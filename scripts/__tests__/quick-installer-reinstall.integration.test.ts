import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DOWNLOADED_APPIMAGE,
  INSTALLED_VERSION,
  useInstallerHarness,
} from '../test-support/quick-installer-harness'

const harness = useInstallerHarness()

describe('quick installer downgrade refusal', () => {
  it('refuses an exact older version before it downloads or stops anything', async () => {
    await harness.publish(['v1.0.0-beta.37'])
    await harness.installLinuxApp(INSTALLED_VERSION)

    const result = await harness.runInstaller({ OPENWAGGLE_RELEASE_TAG: '1.0.0-beta.37' })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain(
      'OpenWaggle v1.0.0-beta.37 is older than the installed 1.0.0-rc.1. Downgrades are unsupported',
    )
    expect(result.stderr).toContain('OpenWaggle was not changed.')
    await harness.expectInstallUnchanged()
  })

  it('refuses when the chosen channel only has an older release', async () => {
    await harness.publish(['v1.0.0-beta.37', 'v0.4.0'])
    await harness.installLinuxApp(INSTALLED_VERSION)

    const result = await harness.runInstaller({ OPENWAGGLE_CHANNEL: 'stable' })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('OpenWaggle v0.4.0 is older than the installed 1.0.0-rc.1.')
    await harness.expectInstallUnchanged()
  })

  // PlistBuddy, which reads the installed version from Info.plist, exists only on macOS.
  it.runIf(process.platform === 'darwin')(
    'refuses an older version on macOS before it downloads or quits the app',
    async () => {
      const applications = path.join(harness.directory(), 'Applications')
      await harness.publish(['v1.0.0-beta.37'])
      await harness.installMacApp(applications, INSTALLED_VERSION)

      const result = await harness.runInstaller({
        FAKE_OS: 'Darwin',
        OPENWAGGLE_APPLICATIONS_DIR: applications,
        OPENWAGGLE_RELEASE_TAG: 'v1.0.0-beta.37',
      })

      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('is older than the installed 1.0.0-rc.1.')
      expect((await harness.calls()).filter((call) => call.includes(' -o '))).toEqual([])
      await expect(fs.readdir(applications)).resolves.toEqual(['OpenWaggle.app'])
    },
  )

  it('reinstalls the installed version', async () => {
    await harness.publish([`v${INSTALLED_VERSION}`])
    await harness.installLinuxApp(INSTALLED_VERSION)

    const result = await harness.runInstaller({ OPENWAGGLE_RELEASE_TAG: `v${INSTALLED_VERSION}` })

    expect(result.exitCode).toBe(0)
    await expect(
      fs.readFile(path.join(harness.appDirectory(), 'OpenWaggle.AppImage'), 'utf8'),
    ).resolves.toBe(DOWNLOADED_APPIMAGE)
    expect(await harness.calls()).toContain('appimage host --help')
  })

  it('upgrades to a newer version', async () => {
    await harness.publish(['v1.0.0-rc.2', 'v1.0.0-beta.37'])
    await harness.installLinuxApp(INSTALLED_VERSION)

    const result = await harness.runInstaller({ OPENWAGGLE_CHANNEL: 'beta' })

    expect(result.exitCode).toBe(0)
    await expect(fs.readFile(path.join(harness.appDirectory(), 'version'), 'utf8')).resolves.toBe(
      '1.0.0-rc.2\n',
    )
  })
})
