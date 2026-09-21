import { describe, expect, it, vi } from 'vitest'
import { configureUpdaterFeed } from '../update-feed'

function response(releases: readonly { readonly tag_name: string }[]) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(releases),
  }
}

describe('update feed selection', () => {
  it('keeps Stable on the native GitHub provider', async () => {
    const setFeedURL = vi.fn()
    const fetchReleases = vi.fn()

    await configureUpdaterFeed({ setFeedURL }, 'stable', fetchReleases)

    expect(fetchReleases).not.toHaveBeenCalled()
    expect(setFeedURL).toHaveBeenCalledWith({
      provider: 'github',
      owner: 'OpenWaggle',
      repo: 'OpenWaggle',
      channel: 'latest',
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
    })
  })

  it('finds an eligible Alpha feed beyond the GitHub Atom window', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      tag_name: `v0.5.0-rc.${100 - index}`,
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
    })
  })

  it('selects the highest Beta-eligible semantic version and excludes Alpha and RC', async () => {
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
        url: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.5.0-beta.10/',
      }),
    )
  })

  it('selects the highest Alpha-eligible semantic version and excludes RC', async () => {
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
        url: 'https://github.com/OpenWaggle/OpenWaggle/releases/download/v0.5.0-beta.2/',
      }),
    )
  })
})
