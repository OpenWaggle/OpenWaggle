import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { type UpdateChannel, updaterFeedChannel } from '@shared/types/update-channel'

const RELEASES_PER_PAGE = 100
const MAX_RELEASE_PAGES = 100
const RELEASE_TAG_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/u
const CHANNEL_RANK = { alpha: 0, beta: 1, rc: 2, stable: 3 } as const
const releaseListSchema = Schema.Array(Schema.Struct({ tag_name: Schema.String }))

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

function compareReleaseVersions(left: ParsedReleaseVersion, right: ParsedReleaseVersion) {
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
  if (releaseChannel === 'rc' || updateChannel === 'stable') return false
  return updateChannel === 'alpha' || releaseChannel === 'beta'
}

export function isVersionEligibleForChannel(version: string, channel: UpdateChannel) {
  const parsed = parseReleaseVersion(version)
  return parsed !== undefined && isEligibleReleaseChannel(parsed.channel, channel)
}

function newestEligibleRelease(tags: readonly string[], channel: UpdateChannel) {
  let selected: ParsedReleaseVersion | undefined
  for (const tag of tags) {
    const parsed = parseReleaseVersion(tag)
    if (!parsed || !isEligibleReleaseChannel(parsed.channel, channel)) continue
    if (!selected || compareReleaseVersions(parsed, selected) > 0) selected = parsed
  }
  if (!selected) throw new Error(`No ${channel}-eligible OpenWaggle release is available.`)
  return selected.tag
}

async function fetchAllReleaseTags(fetchReleases: UpdateReleaseFetcher) {
  const tags: string[] = []
  for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
    const response = await fetchReleases(
      `https://api.github.com/repos/OpenWaggle/OpenWaggle/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`,
      { headers: { accept: 'application/vnd.github+json' } },
    )
    if (!response.ok) {
      throw new Error(`OpenWaggle could not list releases (HTTP ${response.status}).`)
    }
    const releases = decodeUnknownOrThrow(releaseListSchema, await response.json())
    tags.push(...releases.map((release) => release.tag_name))
    if (releases.length < RELEASES_PER_PAGE) return tags
  }
  throw new Error(`OpenWaggle release history exceeds ${MAX_RELEASE_PAGES} pages.`)
}

const fetchReleaseList: UpdateReleaseFetcher = (url, init) => fetch(url, init)

export function configureUpdaterFeed(
  updater: UpdateFeedTarget,
  channel: UpdateChannel,
  fetchReleases: UpdateReleaseFetcher = fetchReleaseList,
) {
  updater.setFeedURL({
    provider: 'github',
    owner: 'OpenWaggle',
    repo: 'OpenWaggle',
    channel: updaterFeedChannel(channel),
  })
  return fetchAllReleaseTags(fetchReleases).then((tags) => {
    const tag = newestEligibleRelease(tags, channel)
    updater.setFeedURL({
      provider: 'generic',
      url: `https://github.com/OpenWaggle/OpenWaggle/releases/download/${encodeURIComponent(tag)}/`,
      channel: updaterFeedChannel(channel),
    })
  })
}
