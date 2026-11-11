import { describe, expect, it, vi } from 'vitest'
import { electrobunMetadataAssetName } from '../adapters/electrobun/electrobun-update-engine'
import {
  compareReleaseVersions,
  configureUpdaterFeed,
  isVersionEligibleForChannel,
  type UpdateFeedRuntime,
} from '../update-feed'

const MAC_ARM64: UpdateFeedRuntime = { platform: 'darwin', arch: 'arm64' }
const ALL_METADATA = ['macos-arm64', 'macos-x64', 'win-x64', 'linux-x64', 'linux-arm64'].map(
  (target) => ({ name: `stable-${target}-update-v2.json` }),
)

/** The feed's view of the bound engine: Electrobun's manifest names, and a recorded feed. */
function feedEngine() {
  return { metadataAssetName: electrobunMetadataAssetName, setFeed: vi.fn() }
}

interface ReleaseFixture {
  readonly tag_name: string
  readonly assets?: readonly { readonly name: string }[]
}

function response(releases: readonly ReleaseFixture[]) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(releases.map((release) => ({ assets: ALL_METADATA, ...release }))),
  }
}

describe('update feed selection', () => {
  it('selects Stable semantically when a newer prerelease is mislabelled', async () => {
    const engine = feedEngine()
    const fetchReleases = vi
      .fn()
      .mockResolvedValue(
        response([
          { tag_name: 'v0.5.0-alpha.2' },
          { tag_name: 'v0.4.1' },
          { tag_name: 'v0.5.0-beta.1' },
        ]),
      )

    await configureUpdaterFeed(engine, 'stable', fetchReleases)

    expect(fetchReleases).toHaveBeenCalledOnce()
    expect(engine.setFeed).toHaveBeenLastCalledWith({
      releaseUrl: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.4.1/',
    })
  })

  it('finds an eligible Beta feed beyond the GitHub Atom window', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      tag_name: `v0.5.0-alpha.${100 - index}`,
    }))
    const fetchReleases = vi
      .fn()
      .mockResolvedValueOnce(response(firstPage))
      .mockResolvedValueOnce(response([{ tag_name: 'v0.4.0' }]))
    const engine = feedEngine()

    await configureUpdaterFeed(engine, 'beta', fetchReleases)

    expect(fetchReleases).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/OpenWaggle/OpenWaggle/releases?per_page=100&page=1',
      expect.objectContaining({ headers: expect.any(Object) }),
    )
    expect(fetchReleases).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/OpenWaggle/OpenWaggle/releases?per_page=100&page=2',
      expect.objectContaining({ headers: expect.any(Object) }),
    )
    expect(engine.setFeed).toHaveBeenLastCalledWith({
      releaseUrl: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.4.0/',
    })
  })

  it('finds an eligible Alpha feed beyond the GitHub Atom window', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      tag_name: `extension-sdk-v0.1.${100 - index}`,
    }))
    const fetchReleases = vi
      .fn()
      .mockResolvedValueOnce(response(firstPage))
      .mockResolvedValueOnce(response([{ tag_name: 'v0.5.0-alpha.9' }]))
    const engine = feedEngine()

    await configureUpdaterFeed(engine, 'alpha', fetchReleases)

    expect(fetchReleases).toHaveBeenCalledTimes(2)
    expect(engine.setFeed).toHaveBeenLastCalledWith({
      releaseUrl: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.5.0-alpha.9/',
    })
  })

  it('selects the highest Beta-eligible semantic version, including RC and excluding Alpha', async () => {
    const fetchReleases = vi
      .fn()
      .mockResolvedValue(
        response([
          { tag_name: 'v0.6.0-alpha.9' },
          { tag_name: 'v0.5.0-rc.1' },
          { tag_name: 'v0.4.1' },
          { tag_name: 'v0.5.0-beta.2' },
          { tag_name: 'v0.5.0-beta.10' },
        ]),
      )
    const engine = feedEngine()

    await configureUpdaterFeed(engine, 'beta', fetchReleases)

    expect(engine.setFeed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        releaseUrl: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.5.0-rc.1/',
      }),
    )
  })

  it('selects the highest Alpha-eligible semantic version, including RC', async () => {
    const fetchReleases = vi
      .fn()
      .mockResolvedValue(
        response([
          { tag_name: 'v0.6.0-rc.2' },
          { tag_name: 'v0.5.0-alpha.8' },
          { tag_name: 'v0.5.0-beta.2' },
          { tag_name: 'v0.4.1' },
        ]),
      )
    const engine = feedEngine()

    await configureUpdaterFeed(engine, 'alpha', fetchReleases)

    expect(engine.setFeed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        releaseUrl: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.6.0-rc.2/',
      }),
    )
  })

  it('keeps release candidates off the Stable channel', async () => {
    const fetchReleases = vi
      .fn()
      .mockResolvedValue(response([{ tag_name: 'v1.0.0-rc.3' }, { tag_name: 'v0.9.0' }]))
    const engine = feedEngine()

    await configureUpdaterFeed(engine, 'stable', fetchReleases)

    expect(engine.setFeed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        releaseUrl: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.9.0/',
      }),
    )
  })

  it('reports no release, not an error, when Stable has no release yet', async () => {
    const fetchReleases = vi
      .fn()
      .mockResolvedValue(response([{ tag_name: 'v1.0.0-rc.1' }, { tag_name: 'v1.0.0-beta.25' }]))
    const engine = feedEngine()

    await expect(configureUpdaterFeed(engine, 'stable', fetchReleases, MAC_ARM64)).resolves.toEqual(
      { type: 'no-release' },
    )
    expect(engine.setFeed).not.toHaveBeenCalled()
  })

  it('skips a newer release whose channel metadata is not uploaded yet', async () => {
    const fetchReleases = vi.fn().mockResolvedValue(
      response([
        // Published moments ago: the archives are still uploading, so the macOS manifest is missing.
        {
          tag_name: 'v1.0.0-beta.26',
          assets: [
            { name: 'openwaggle-1.0.0-beta.26-arm64.dmg' },
            { name: 'stable-linux-x64-update-v2.json' },
          ],
        },
        { tag_name: 'v1.0.0-beta.25' },
      ]),
    )
    const engine = feedEngine()

    await expect(configureUpdaterFeed(engine, 'beta', fetchReleases, MAC_ARM64)).resolves.toEqual({
      type: 'release',
      tag: 'v1.0.0-beta.25',
    })
    expect(engine.setFeed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        releaseUrl: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v1.0.0-beta.25/',
      }),
    )
  })

  it('reports no release when no eligible release has its channel metadata yet', async () => {
    const fetchReleases = vi
      .fn()
      .mockResolvedValue(response([{ tag_name: 'v1.0.0-beta.1', assets: [] }]))

    await expect(
      configureUpdaterFeed(feedEngine(), 'beta', fetchReleases, MAC_ARM64),
    ).resolves.toEqual({ type: 'no-release' })
  })

  it("looks for the engine's manifest for this platform and channel", async () => {
    const engine = { metadataAssetName: vi.fn(() => 'feed-manifest.json'), setFeed: vi.fn() }
    const fetchReleases = vi.fn().mockResolvedValue(
      response([
        { tag_name: 'v1.0.0-beta.2', assets: [{ name: 'stable-macos-arm64-update-v2.json' }] },
        { tag_name: 'v1.0.0-beta.1', assets: [{ name: 'feed-manifest.json' }] },
      ]),
    )

    await expect(
      configureUpdaterFeed(engine, 'beta', fetchReleases, { platform: 'linux', arch: 'arm64' }),
    ).resolves.toEqual({ type: 'release', tag: 'v1.0.0-beta.1' })
    expect(engine.metadataAssetName).toHaveBeenCalledWith({
      feedChannel: 'beta',
      platform: 'linux',
      arch: 'arm64',
    })
  })

  it('orders versions semantically and rejects tags it cannot parse', () => {
    expect(compareReleaseVersions('v1.0.0-beta.20', '1.0.0-beta.25')).toBeLessThan(0)
    expect(compareReleaseVersions('1.0.0-rc.1', '1.0.0-beta.25')).toBeGreaterThan(0)
    expect(compareReleaseVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareReleaseVersions('nightly', '1.0.0')).toBeUndefined()
  })

  it('never offers an older Beta to a Beta user on a newer RC', () => {
    expect(isVersionEligibleForChannel('1.0.0-rc.2', 'beta')).toBe(true)
    expect(isVersionEligibleForChannel('1.0.0-rc.2', 'stable')).toBe(false)
    expect(isVersionEligibleForChannel('1.0.0-alpha.2', 'beta')).toBe(false)
  })
})
