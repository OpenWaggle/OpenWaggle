/**
 * Classification of GitHub release assets for download statistics. Update metadata names
 * encode the feed channel and platform (`alpha-mac.yml`, `latest.yml`, `beta-linux.yml`);
 * installers and archives encode platform and architecture. Blockmaps, which electron-updater
 * fetches for differential downloads, and `builder-debug.yml` are not downloads and are ignored.
 */

export const RELEASE_ASSET_KINDS = [
  'dmg',
  'exe',
  'appimage',
  'mac_zip',
  'sha256sums',
  'update_check',
  'other',
] as const
export type ReleaseAssetKind = (typeof RELEASE_ASSET_KINDS)[number]

/** Platforms use the app's `os` values so downloads line up with install statistics. */
export type ReleaseAssetPlatform = 'darwin' | 'win32' | 'linux' | 'none'
export type ReleaseAssetArch = 'arm64' | 'x64' | 'universal' | 'none'
export type ReleaseChannel = 'stable' | 'rc' | 'beta' | 'alpha'

export interface ReleaseAssetClass {
  readonly kind: ReleaseAssetKind
  readonly platform: ReleaseAssetPlatform
  readonly arch: ReleaseAssetArch
  /** Channel of the update feed an `update_check` asset serves. */
  readonly feedChannel?: ReleaseChannel
}

const IGNORED_ASSETS: readonly RegExp[] = [/\.blockmap$/iu, /^builder-debug\.yml$/iu]
const UPDATE_FEED =
  /^(?<feed>latest|stable|rc|beta|alpha)(?:-(?<platform>mac|linux))?(?:-(?<arch>arm64|x64))?\.yml$/iu
const CHECKSUMS = /^sha256sums(?:\.txt)?$/iu
/** electron-builder's macOS update payload; zips naming another platform are not. */
const ZIP_ARCHIVE = /\.zip$/iu
const NON_MAC_ARCHIVE = /(?:^|[-_.])(?:win|windows|linux)(?:[-_.]|$)/iu
const PRERELEASE_CHANNEL = /-(?<channel>alpha|beta|rc)(?:[.\d-]|$)/iu

const ARCH_PATTERNS: readonly (readonly [ReleaseAssetArch, RegExp])[] = [
  ['arm64', /(?:^|[-_.])(?:arm64|aarch64)(?:[-_.]|$)/iu],
  ['x64', /(?:^|[-_.])(?:x64|x86_64|amd64)(?:[-_.]|$)/iu],
  ['universal', /(?:^|[-_.])universal(?:[-_.]|$)/iu],
]

/** Update feeds name only macOS and Linux; Windows feeds have no platform suffix. */
const FEED_PLATFORMS: ReadonlyMap<string, ReleaseAssetPlatform> = new Map([
  ['mac', 'darwin'],
  ['linux', 'linux'],
])

const INSTALLER_KINDS: readonly (readonly [RegExp, ReleaseAssetKind, ReleaseAssetPlatform])[] = [
  [/\.dmg$/iu, 'dmg', 'darwin'],
  [/\.exe$/iu, 'exe', 'win32'],
  [/\.appimage$/iu, 'appimage', 'linux'],
]

function assetArch(name: string): ReleaseAssetArch {
  return ARCH_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0] ?? 'none'
}

function channelName(name: string): ReleaseChannel {
  const lowered = name.toLowerCase()
  if (lowered === 'rc' || lowered === 'beta' || lowered === 'alpha') return lowered
  return 'stable'
}

/** The build channel of a release from its tag: `v1.0.0-beta.4` is `beta`, `v1.0.0` `stable`. */
export function releaseChannel(tag: string): ReleaseChannel {
  return channelName(PRERELEASE_CHANNEL.exec(tag)?.groups?.channel ?? '')
}

function updateFeedClass(groups: Readonly<Record<string, string | undefined>>): ReleaseAssetClass {
  const platform = groups.platform?.toLowerCase()
  return {
    kind: 'update_check',
    platform: platform === undefined ? 'win32' : (FEED_PLATFORMS.get(platform) ?? 'none'),
    arch: assetArch(groups.arch ?? ''),
    feedChannel: channelName(groups.feed ?? ''),
  }
}

/** Classifies an asset by name, or returns `undefined` for assets that are not downloads. */
export function classifyReleaseAsset(name: string): ReleaseAssetClass | undefined {
  if (IGNORED_ASSETS.some((pattern) => pattern.test(name))) return undefined
  const feed = UPDATE_FEED.exec(name)?.groups
  if (feed !== undefined) return updateFeedClass(feed)
  if (CHECKSUMS.test(name)) return { kind: 'sha256sums', platform: 'none', arch: 'none' }
  const installer = INSTALLER_KINDS.find(([pattern]) => pattern.test(name))
  if (installer !== undefined) {
    const [, kind, platform] = installer
    return { kind, platform, arch: assetArch(name) }
  }
  if (ZIP_ARCHIVE.test(name) && !NON_MAC_ARCHIVE.test(name)) {
    return { kind: 'mac_zip', platform: 'darwin', arch: assetArch(name) }
  }
  return { kind: 'other', platform: 'none', arch: assetArch(name) }
}
