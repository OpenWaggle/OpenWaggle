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
  it('checks the release OpenWaggle selected, or the newest Stable release before that', async () => {
    const { updater, subject } = await engine()
    await subject.checkForUpdates()
    subject.setFeed({
      provider: 'github',
      owner: 'OpenWaggle',
      repo: 'OpenWaggle',
      channel: 'beta',
    })
    await subject.checkForUpdates()
    const selected = 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v1.1.0-beta.2/'
    subject.setFeed({
      provider: 'generic',
      url: selected,
      channel: 'beta',
      useMultipleRangeRequest: false,
    })
    await subject.checkForUpdates()
    expect(updater.state.checkedUrls).toEqual([
      'https://github.com/OpenWaggle/OpenWaggle/releases/latest/download',
      'https://github.com/OpenWaggle/OpenWaggle/releases/latest/download',
      selected,
    ])
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
      provider: 'generic',
      url: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v1.0.1/',
      channel: 'latest',
      useMultipleRangeRequest: false,
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
