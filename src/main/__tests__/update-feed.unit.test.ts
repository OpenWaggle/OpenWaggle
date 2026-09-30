import { describe, expect, it, vi } from 'vitest'
import { configureUpdaterFeed, isVersionEligibleForChannel } from '../update-feed'

function response(releases: readonly { readonly tag_name: string }[]) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(releases),
  }
}

describe('update feed selection', () => {
  it('selects Stable semantically when a newer prerelease is mislabelled', async () => {
    const setFeedURL = vi.fn()
    const fetchReleases = vi
      .fn()
      .mockResolvedValue(
        response([
          { tag_name: 'v0.5.0-alpha.2' },
          { tag_name: 'v0.4.1' },
          { tag_name: 'v0.5.0-beta.1' },
        ]),
      )

    await configureUpdaterFeed({ setFeedURL }, 'stable', fetchReleases)

    expect(fetchReleases).toHaveBeenCalledOnce()
    expect(setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.4.1/',
      channel: 'latest',
      useMultipleRangeRequest: false,
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
    const setFeedURL = vi.fn()

    await configureUpdaterFeed({ setFeedURL }, 'beta', fetchReleases)

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
    expect(setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.4.0/',
      channel: 'beta',
      useMultipleRangeRequest: false,
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
    const setFeedURL = vi.fn()

    await configureUpdaterFeed({ setFeedURL }, 'alpha', fetchReleases)

    expect(fetchReleases).toHaveBeenCalledTimes(2)
    expect(setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.5.0-alpha.9/',
      channel: 'alpha',
      useMultipleRangeRequest: false,
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
    const setFeedURL = vi.fn()

    await configureUpdaterFeed({ setFeedURL }, 'beta', fetchReleases)

    expect(setFeedURL).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.5.0-rc.1/',
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
    const setFeedURL = vi.fn()

    await configureUpdaterFeed({ setFeedURL }, 'alpha', fetchReleases)

    expect(setFeedURL).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.6.0-rc.2/',
      }),
    )
  })

  it('keeps release candidates off the Stable channel', async () => {
    const fetchReleases = vi
      .fn()
      .mockResolvedValue(response([{ tag_name: 'v1.0.0-rc.3' }, { tag_name: 'v0.9.0' }]))
    const setFeedURL = vi.fn()

    await configureUpdaterFeed({ setFeedURL }, 'stable', fetchReleases)

    expect(setFeedURL).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.9.0/',
      }),
    )
  })

  it('never offers an older Beta to a Beta user on a newer RC', () => {
    expect(isVersionEligibleForChannel('1.0.0-rc.2', 'beta')).toBe(true)
    expect(isVersionEligibleForChannel('1.0.0-rc.2', 'stable')).toBe(false)
    expect(isVersionEligibleForChannel('1.0.0-alpha.2', 'beta')).toBe(false)
  })
})
