import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { type UpdateChannel, updaterFeedChannel } from '@shared/types/update-channel'

const RELEASES_PER_PAGE = 100
const MAX_RELEASE_PAGES = 100
const RELEASE_TAG_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/u
const CHANNEL_RANK = { alpha: 0, beta: 1, rc: 2, stable: 3 } as const
const releaseListSchema = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    assets: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
)

type ListedRelease = (typeof releaseListSchema.Type)[number]

/** The platform and architecture whose update metadata a feed must offer. */
export interface UpdateFeedRuntime {
  readonly platform: NodeJS.Platform
  readonly arch: string
}

/**
 * Which release the updater now reads, or that no eligible release offers update metadata for this
 * platform yet: Stable before 1.0, or a release whose assets are still uploading.
 */
export type UpdateFeedSelection =
  | { readonly type: 'release'; readonly tag: string }
  | { readonly type: 'no-release' }

type FeedConfiguration =
  | {
      readonly provider: 'github'
      readonly owner: 'OpenWaggle'
      readonly repo: 'OpenWaggle'
      readonly channel: string
    }
  | {
      readonly provider: 'generic'
      readonly url: string
      readonly channel: ReturnType<typeof updaterFeedChannel>
      readonly useMultipleRangeRequest: false
    }

interface UpdateFeedTarget {
  readonly setFeedURL: (configuration: FeedConfiguration) => void
}

interface ReleaseListResponse {
  readonly ok: boolean
  readonly status: number
  readonly json: () => Promise<unknown>
}

export type UpdateReleaseFetcher = (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>> },
) => Promise<ReleaseListResponse>

interface ParsedReleaseVersion {
  readonly tag: string
  readonly core: readonly [number, number, number]
  readonly channel: keyof typeof CHANNEL_RANK
  readonly sequence: number
}

function parseReleaseVersion(tag: string): ParsedReleaseVersion | undefined {
  const match = RELEASE_TAG_PATTERN.exec(tag)
  if (!match) return
  const [, major, minor, patch, prerelease, sequence] = match
  const channel = prerelease ?? 'stable'
  if (channel !== 'alpha' && channel !== 'beta' && channel !== 'rc' && channel !== 'stable') {
    return
  }
  return {
    tag,
    core: [Number(major), Number(minor), Number(patch)],
    channel,
    sequence: sequence === undefined ? 0 : Number(sequence),
  }
}

function compareParsedVersions(left: ParsedReleaseVersion, right: ParsedReleaseVersion) {
  for (let index = 0; index < left.core.length; index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0)
    if (difference !== 0) return difference
  }
  const channelDifference = CHANNEL_RANK[left.channel] - CHANNEL_RANK[right.channel]
  return channelDifference === 0 ? left.sequence - right.sequence : channelDifference
}

function isEligibleReleaseChannel(
  releaseChannel: ParsedReleaseVersion['channel'],
  updateChannel: UpdateChannel,
) {
  if (releaseChannel === 'stable') return true
  if (updateChannel === 'stable') return false
  // Beta and Alpha both accept release candidates, so the RC validation window
  // reaches every prerelease user; only Alpha accepts Alpha builds.
  return releaseChannel !== 'alpha' || updateChannel === 'alpha'
}

export function isVersionEligibleForChannel(version: string, channel: UpdateChannel) {
  const parsed = parseReleaseVersion(version)
  return parsed !== undefined && isEligibleReleaseChannel(parsed.channel, channel)
}

/**
 * Orders two release versions (`v` optional): negative when `left` is older, 0 when equal, and
 * undefined when either is not a release version.
 */
export function compareReleaseVersions(left: string, right: string) {
  const parsedLeft = parseReleaseVersion(left)
  const parsedRight = parseReleaseVersion(right)
  if (!parsedLeft || !parsedRight) return undefined
  return compareParsedVersions(parsedLeft, parsedRight)
}

/** The channel metadata file electron-updater requests (its `Provider.getCustomChannelName`). */
export function updaterMetadataAssetName(channel: UpdateChannel, runtime: UpdateFeedRuntime) {
  const feed = updaterFeedChannel(channel)
  if (runtime.platform === 'darwin') return `${feed}-mac.yml`
  if (runtime.platform === 'linux') {
    return `${feed}-linux${runtime.arch === 'x64' ? '' : `-${runtime.arch}`}.yml`
  }
  return `${feed}.yml`
}

/**
 * The newest eligible release that already has this platform's channel metadata. A release is
 * listed as soon as it is published, before its assets finish uploading; reading its metadata then
 * would fail with HTTP 404, so such a release is skipped until a later check.
 */
function newestEligibleRelease(
  releases: readonly ListedRelease[],
  channel: UpdateChannel,
  runtime: UpdateFeedRuntime,
) {
  const metadataAsset = updaterMetadataAssetName(channel, runtime)
  let selected: ParsedReleaseVersion | undefined
  for (const release of releases) {
    const parsed = parseReleaseVersion(release.tag_name)
    if (!parsed || !isEligibleReleaseChannel(parsed.channel, channel)) continue
    if (!release.assets.some((asset) => asset.name === metadataAsset)) continue
    if (!selected || compareParsedVersions(parsed, selected) > 0) selected = parsed
  }
  return selected?.tag
}

async function fetchAllReleases(fetchReleases: UpdateReleaseFetcher) {
  const listed: ListedRelease[] = []
  for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
    const response = await fetchReleases(
      `https://api.github.com/repos/OpenWaggle/OpenWaggle/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`,
      { headers: { accept: 'application/vnd.github+json' } },
    )
    if (!response.ok) {
      throw new Error(`OpenWaggle could not list releases (HTTP ${response.status}).`)
    }
    const releases = decodeUnknownOrThrow(releaseListSchema, await response.json())
    listed.push(...releases)
    if (releases.length < RELEASES_PER_PAGE) return listed
  }
  throw new Error(`OpenWaggle release history exceeds ${MAX_RELEASE_PAGES} pages.`)
}

const fetchReleaseList: UpdateReleaseFetcher = (url, init) => fetch(url, init)

export function configureUpdaterFeed(
  updater: UpdateFeedTarget,
  channel: UpdateChannel,
  fetchReleases: UpdateReleaseFetcher = fetchReleaseList,
  runtime: UpdateFeedRuntime = process,
): Promise<UpdateFeedSelection> {
  updater.setFeedURL({
    provider: 'github',
    owner: 'OpenWaggle',
    repo: 'OpenWaggle',
    channel: updaterFeedChannel(channel),
  })
  return fetchAllReleases(fetchReleases).then((releases): UpdateFeedSelection => {
    const tag = newestEligibleRelease(releases, channel, runtime)
    if (tag === undefined) return { type: 'no-release' }
    updater.setFeedURL({
      provider: 'generic',
      url: `https://github.com/OpenWaggle/OpenWaggle/releases/download/${encodeURIComponent(tag)}/`,
      channel: updaterFeedChannel(channel),
      // GitHub release downloads answer multi-range requests with HTTP 501, so differential
      // (blockmap) downloads must use single ranges, as electron-updater's GitHub provider does.
      useMultipleRangeRequest: false,
    })
    return { type: 'release', tag }
  })
}
