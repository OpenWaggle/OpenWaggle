import { describe, expect, it } from 'vitest'
import {
  compareReleaseAssets,
  type LocalReleaseAsset,
  type RemoteReleaseAsset,
  verifyRelease,
} from '../verify-release-assets'

const local: readonly LocalReleaseAsset[] = [
  { name: 'openwaggle-1.0.0-arm64.zip', size: 300, sha256: 'zip' },
  { name: 'latest-mac.yml', size: 10, sha256: 'yml' },
  { name: 'SHA256SUMS.txt', size: 20, sha256: 'sums' },
]

function remote(overrides: Partial<RemoteReleaseAsset> & { readonly name: string }): RemoteReleaseAsset {
  const match = local.find((asset) => asset.name === overrides.name)
  return { id: 1, size: match?.size ?? 0, state: 'uploaded', ...overrides }
}

describe('compareReleaseAssets', () => {
  it('accepts a release holding exactly the local assets', () => {
    expect(compareReleaseAssets(local, local.map((asset) => remote({ name: asset.name })))).toEqual([])
  })

  it('reports missing, extra, unfinished and resized assets', () => {
    expect(
      compareReleaseAssets(local, [
        remote({ name: 'openwaggle-1.0.0-arm64.zip', size: 299 }),
        remote({ name: 'latest-mac.yml', state: 'starter' }),
        remote({ name: 'stray.txt', size: 1 }),
      ]),
    ).toEqual([
      'openwaggle-1.0.0-arm64.zip is 299 bytes on the release, 300 bytes locally',
      'latest-mac.yml is starter on the release, not uploaded',
      'SHA256SUMS.txt is missing from the release',
      'stray.txt is on the release but was not built',
    ])
  })
})

describe('verifyRelease', () => {
  const release = {
    draft: true,
    assets: local.map((asset, index) => remote({ id: index + 1, name: asset.name })),
  }

  it('checks the update metadata and checksums byte for byte', async () => {
    const downloaded: string[] = []
    const problems = await verifyRelease({
      local,
      release,
      expectDraft: true,
      downloadSha256: async (asset) => {
        downloaded.push(asset.name)
        return asset.name === 'latest-mac.yml' ? 'tampered' : (local.find((item) => item.name === asset.name)?.sha256 ?? '')
      },
    })
    expect(downloaded).toEqual(['latest-mac.yml', 'SHA256SUMS.txt'])
    expect(problems).toEqual(['latest-mac.yml on the release does not match the local file'])
  })

  it('fails when the release is missing or has the wrong draft state', async () => {
    const downloadSha256 = async () => ''
    expect(await verifyRelease({ local, release: null, expectDraft: true, downloadSha256 })).toEqual([
      'the release does not exist',
    ])
    expect(await verifyRelease({ local, release, expectDraft: false, downloadSha256: async (asset) => local.find((item) => item.name === asset.name)?.sha256 ?? '' })).toEqual([
      'the release is a draft, expected published',
    ])
  })
})
