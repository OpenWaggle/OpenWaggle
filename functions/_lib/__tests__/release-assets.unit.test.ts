import { describe, expect, it } from 'vitest'
import { classifyReleaseAsset, releaseChannel } from '../release-assets'

describe('release asset classification', () => {
  it.each([
    [
      'latest-mac.yml',
      { kind: 'update_check', platform: 'darwin', arch: 'none', feedChannel: 'stable' },
    ],
    [
      'latest.yml',
      { kind: 'update_check', platform: 'win32', arch: 'none', feedChannel: 'stable' },
    ],
    [
      'latest-linux.yml',
      { kind: 'update_check', platform: 'linux', arch: 'none', feedChannel: 'stable' },
    ],
    [
      'latest-linux-arm64.yml',
      { kind: 'update_check', platform: 'linux', arch: 'arm64', feedChannel: 'stable' },
    ],
    [
      'alpha-mac.yml',
      { kind: 'update_check', platform: 'darwin', arch: 'none', feedChannel: 'alpha' },
    ],
    ['alpha.yml', { kind: 'update_check', platform: 'win32', arch: 'none', feedChannel: 'alpha' }],
    [
      'beta-linux.yml',
      { kind: 'update_check', platform: 'linux', arch: 'none', feedChannel: 'beta' },
    ],
    ['rc-mac.yml', { kind: 'update_check', platform: 'darwin', arch: 'none', feedChannel: 'rc' }],
    ['openwaggle-1.0.0-beta.4-arm64.dmg', { kind: 'dmg', platform: 'darwin', arch: 'arm64' }],
    ['openwaggle-1.0.0-beta.4-x64.dmg', { kind: 'dmg', platform: 'darwin', arch: 'x64' }],
    ['openwaggle-1.0.0-beta.4-x64.exe', { kind: 'exe', platform: 'win32', arch: 'x64' }],
    [
      'openwaggle-1.0.0-beta.4-x86_64.AppImage',
      { kind: 'appimage', platform: 'linux', arch: 'x64' },
    ],
    ['openwaggle-1.0.0-beta.4-arm64.zip', { kind: 'mac_zip', platform: 'darwin', arch: 'arm64' }],
    ['openwaggle-1.0.0-beta.4-x64.zip', { kind: 'mac_zip', platform: 'darwin', arch: 'x64' }],
    ['SHA256SUMS.txt', { kind: 'sha256sums', platform: 'none', arch: 'none' }],
    ['SHA256SUMS', { kind: 'sha256sums', platform: 'none', arch: 'none' }],
    ['openwaggle-1.0.0-win-x64.zip', { kind: 'other', platform: 'none', arch: 'x64' }],
    ['openwaggle-waggle-core-0.1.1.tgz', { kind: 'other', platform: 'none', arch: 'none' }],
    ['release-artifacts.json', { kind: 'other', platform: 'none', arch: 'none' }],
    ['app-update.yml', { kind: 'other', platform: 'none', arch: 'none' }],
  ])('classifies %s', (name, expected) => {
    expect(classifyReleaseAsset(name)).toEqual(expected)
  })

  it.each([
    'builder-debug.yml',
    'openwaggle-1.0.0-beta.4-arm64.dmg.blockmap',
    'openwaggle-1.0.0-beta.4-x64.exe.blockmap',
    'openwaggle-1.0.0-beta.4-arm64.zip.blockmap',
  ])('ignores %s, which is not a download', (name) => {
    expect(classifyReleaseAsset(name)).toBeUndefined()
  })

  it.each([
    ['v1.0.0', 'stable'],
    ['v1.0.0-beta.4', 'beta'],
    ['v1.0.0-rc.1', 'rc'],
    ['v0.4.0-alpha.10', 'alpha'],
    ['waggle-core-v0.1.1', 'stable'],
  ])('reads the channel of release %s as %s', (tag, channel) => {
    expect(releaseChannel(tag)).toBe(channel)
  })
})
