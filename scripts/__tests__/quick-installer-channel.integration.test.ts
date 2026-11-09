import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DOWNLOADED_APPIMAGE,
  INSTALLED_VERSION,
  useInstallerHarness,
} from '../test-support/quick-installer-harness'

const harness = useInstallerHarness()

describe('quick installer update channel on a re-run', () => {
  it('keeps the channel the installed app has saved and writes no channel intent', async () => {
    // The default would be Stable, which already has 1.0.0; the saved Beta channel has a newer build.
    await harness.publish(['v1.0.1-beta.1', 'v1.0.0'])
    await harness.installLinuxApp('1.0.0')
    await harness.reportSavedChannel('beta')

    const result = await harness.runInstaller({})

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Update channel: beta, kept from the installed OpenWaggle')
    await expect(harness.installedVersion()).resolves.toBe('1.0.1-beta.1')
    await expect(harness.savedChannelIntent()).resolves.toBeNull()
    expect(await harness.calls()).toContain('appimage update --check --json')
  })

  it('refuses a downgrade on the kept channel', async () => {
    await harness.publish(['v1.0.0-rc.1', 'v1.0.0-beta.37'])
    await harness.installLinuxApp('1.0.0-rc.2')
    await harness.reportSavedChannel('beta')

    const result = await harness.runInstaller({})

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('OpenWaggle v1.0.0-rc.1 is older than the installed 1.0.0-rc.2.')
    await expect(harness.installedVersion()).resolves.toBe('1.0.0-rc.2')
    await expect(harness.savedChannelIntent()).resolves.toBeNull()
  })

  it('reports up to date and changes nothing when the kept channel has no release', async () => {
    await harness.publish(['v1.0.0-rc.2'])
    await harness.installLinuxApp(INSTALLED_VERSION)
    await harness.reportSavedChannel('stable')

    const result = await harness.runInstaller({})

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      'OpenWaggle is up to date on the stable channel: no release is available on it yet.',
    )
    await expect(harness.installedVersion()).resolves.toBe(INSTALLED_VERSION)
    await expect(harness.savedChannelIntent()).resolves.toBeNull()
    expect((await harness.calls()).filter((call) => call.includes(' -o '))).toEqual([])
  })

  it('trusts the AppImage over a version file an in-app update left behind', async () => {
    // The app updated the AppImage in place from 1.0.0-beta.37 to 1.0.0-rc.2.
    await harness.publish(['v1.0.0-rc.1'])
    await harness.installLinuxApp('1.0.0-beta.37')
    await fs.writeFile(path.join(harness.directory(), 'embedded-version'), '1.0.0-rc.2\n')
    await harness.reportSavedChannel('alpha')

    const result = await harness.runInstaller({})

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('OpenWaggle v1.0.0-rc.1 is older than the installed 1.0.0-rc.2.')
    // rc.2 can report its channel, so it was asked rather than treated as 1.0.0-beta.37.
    expect(await harness.calls()).toContain('appimage update --check --json')
    await expect(harness.savedChannelIntent()).resolves.toBeNull()
  })

  it('uses and saves OPENWAGGLE_CHANNEL without asking the installed app', async () => {
    await harness.publish(['v1.0.1-alpha.1', 'v1.0.0'])
    await harness.installLinuxApp('1.0.0')
    await harness.reportSavedChannel('beta')

    const result = await harness.runInstaller({ OPENWAGGLE_CHANNEL: 'alpha' })

    expect(result.exitCode).toBe(0)
    await expect(harness.installedVersion()).resolves.toBe('1.0.1-alpha.1')
    await expect(harness.savedChannelIntent()).resolves.toBe('alpha\n')
    expect(await harness.calls()).not.toContain('appimage update --check --json')
  })

  it('installs an exact version once without reading or saving a channel', async () => {
    await harness.publish(['v1.0.1-beta.1'])
    await harness.installLinuxApp('1.0.0')
    await harness.reportSavedChannel('stable')

    const result = await harness.runInstaller({ OPENWAGGLE_RELEASE_TAG: 'v1.0.1-beta.1' })

    expect(result.exitCode).toBe(0)
    await expect(harness.installedVersion()).resolves.toBe('1.0.1-beta.1')
    await expect(harness.savedChannelIntent()).resolves.toBeNull()
    expect(await harness.calls()).not.toContain('appimage update --check --json')
  })

  it('saves the default channel on a first install', async () => {
    await harness.publish(['v1.0.0-rc.1'])

    const result = await harness.runInstaller({})

    expect(result.exitCode).toBe(0)
    await expect(harness.installedVersion()).resolves.toBe('1.0.0-rc.1')
    await expect(harness.savedChannelIntent()).resolves.toBe('beta\n')
  })

  it('saves the default channel over a version too old to report its channel', async () => {
    await harness.publish(['v1.0.0-rc.1', 'v1.0.0-beta.37'])
    await harness.installLinuxApp('1.0.0-beta.37')
    await harness.reportSavedChannel('alpha')

    const result = await harness.runInstaller({})

    expect(result.exitCode).toBe(0)
    await expect(harness.installedVersion()).resolves.toBe('1.0.0-rc.1')
    await expect(harness.savedChannelIntent()).resolves.toBe('beta\n')
    expect(await harness.calls()).not.toContain('appimage update --check --json')
  })

  it('saves the default channel when the installed app cannot report one', async () => {
    await harness.publish(['v1.0.0-rc.2'])
    await harness.installLinuxApp(INSTALLED_VERSION)

    const result = await harness.runInstaller({})

    expect(result.exitCode).toBe(0)
    expect(await harness.calls()).toContain('appimage update --check --json')
    await expect(harness.installedVersion()).resolves.toBe('1.0.0-rc.2')
    await expect(harness.savedChannelIntent()).resolves.toBe('beta\n')
  })
})
