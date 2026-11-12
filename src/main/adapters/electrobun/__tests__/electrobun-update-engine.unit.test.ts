import { describe, expect, it } from 'vitest'
import { prepareElectrobunShell } from './contracts/electrobun-shell'

async function engine(installedVersion?: string) {
  const { electrobun } = await prepareElectrobunShell()
  const { updater } = electrobun
  if (installedVersion !== undefined) updater.localInfo.version = installedVersion
  const module = await import('../electrobun-update-engine')
  return { updater, subject: module.electrobunUpdateEngine, module }
}

describe('Electrobun UpdateEngine', () => {
  it("installs after the desktop app's quit protocol, whose native quit veto cancelled it", async () => {
    const { updater, subject } = await engine('1.0.0')
    const { electrobunAppLifecycle: lifecycle } = await import('../electrobun-app-lifecycle')
    // The desktop app routes Electrobun's own quit requests through the port's protocol.
    await lifecycle.whenReady()
    let shutdownDone = false
    lifecycle.onBeforeQuit((event) => {
      // OpenWaggle holds the first quit for its async shutdown, then quits again.
      if (!shutdownDone) event.preventDefault()
    })
    const order: string[] = []
    lifecycle.onWillQuit(() => order.push('will-quit'))
    subject.quitAndInstall({ silent: true, relaunch: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(updater.state.installs).toBe(0)
    shutdownDone = true
    lifecycle.quit()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['will-quit'])
    expect(updater.state.installs).toBe(1)
  })

  it('checks the release OpenWaggle selected, or the feed baked into the build before that', async () => {
    const { updater, subject } = await engine()
    await subject.checkForUpdates()
    const selected = 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v1.1.0-beta.2/'
    subject.setFeed({ releaseUrl: selected })
    await subject.checkForUpdates()
    expect(updater.state.checkedUrls).toEqual([
      'https://github.com/OpenWaggle/OpenWaggle/releases/latest/download',
      selected,
    ])
  })

  it('names the manifest Electrobun reads, whatever the OpenWaggle channel', async () => {
    const { subject } = await engine()
    const names = [
      { feedChannel: 'latest', platform: 'darwin', arch: 'arm64' },
      { feedChannel: 'beta', platform: 'win32', arch: 'x64' },
      { feedChannel: 'alpha', platform: 'linux', arch: 'arm64' },
    ] as const
    expect(names.map((target) => subject.metadataAssetName(target))).toEqual([
      'stable-macos-arm64-update-v2.json',
      'stable-win-x64-update-v2.json',
      'stable-linux-arm64-update-v2.json',
    ])
    expect(() =>
      subject.metadataAssetName({ feedChannel: 'beta', platform: 'freebsd', arch: 'x64' }),
    ).toThrow(/freebsd/u)
  })

  it.each([
    { offered: '0.9.0', allowPrerelease: true, offers: false },
    { offered: '1.0.0-rc.3', allowPrerelease: true, offers: false },
    { offered: '1.1.0-beta.1', allowPrerelease: false, offers: false },
    { offered: '1.1.0-beta.1', allowPrerelease: true, offers: true },
    { offered: '1.0.1', allowPrerelease: false, offers: true },
  ])(
    'offers $offered to 1.0.0 with prereleases $allowPrerelease: $offers',
    async ({ offered, allowPrerelease, offers }) => {
      const { updater, subject } = await engine('1.0.0')
      const seen: string[] = []
      subject.onUpdateAvailable((version) => seen.push(`available ${version}`))
      subject.onUpdateNotAvailable(() => seen.push('not available'))
      subject.configure({ feedChannel: 'beta', allowPrerelease })
      updater.offer(offered)
      const check = await subject.checkForUpdates()
      expect(check?.version ?? null).toBe(offers ? offered : null)
      expect(seen).toEqual([offers ? `available ${offered}` : 'not available'])
    },
  )

  it('downloads an offered update and never reports one whose check was cancelled', async () => {
    const { updater, subject } = await engine('1.0.0')
    const downloaded: string[] = []
    subject.onUpdateDownloaded((version) => downloaded.push(version))
    updater.offer('1.0.1')
    await (
      await subject.checkForUpdates()
    )?.download
    expect(downloaded).toEqual(['1.0.1'])

    updater.offer('1.0.2')
    updater.state.holdDownloads = true
    const check = await subject.checkForUpdates()
    await new Promise((resolve) => setTimeout(resolve, 0))
    check?.cancelDownload()
    updater.finishDownloads()
    await check?.download
    expect(updater.state.downloadsStarted).toBe(2)
    expect(downloaded).toEqual(['1.0.1'])
  })

  it('fails the check when Electrobun no longer reads the feed it was given', async () => {
    const { updater, subject } = await engine()
    updater.Updater.getLocalInfo = async () => ({ ...updater.localInfo })
    subject.setFeed({
      releaseUrl: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v1.0.1/',
    })
    await expect(subject.checkForUpdates()).rejects.toThrow(/not the selected feed/u)
    expect(updater.state.checkedUrls).toEqual([])
  })

  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.0-rc.1', '1.0.0', -1],
    ['1.0.0-beta.10', '1.0.0-beta.9', 1],
    ['1.0.0-beta.1', '1.0.0-rc.1', -1],
    ['1.0.0-rc.1', '1.0.0-rc.1.1', -1],
    ['v2.0.0', '1.9.9', 1],
    ['1.0', '1.0.0', null],
  ])('orders %s against %s', async (left, right, expected) => {
    const { module } = await engine()
    const order = module.compareSemanticVersions(left, right)
    expect(order === null ? null : Math.sign(order)).toBe(expected)
  })
})
