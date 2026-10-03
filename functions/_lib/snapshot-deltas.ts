/**
 * Delta computation for the daily snapshot. GitHub reports cumulative download counts and
 * npm and GitHub traffic report per-day totals that can still grow; the endpoint remembers
 * what it already forwarded in `STATS_KV` and forwards only the increase, so every download
 * and visit is counted once however often the job runs.
 */
import { isRecord, parseJsonText } from './http'
import {
  ANONYMOUS_DISTINCT_ID,
  middayTimestamp,
  type PostHogEvent,
  type PostHogPropertyValue,
  personlessProperties,
} from './posthog'
import { classifyReleaseAsset, type ReleaseAssetClass, releaseChannel } from './release-assets'
import {
  GITHUB_TRAFFIC_WINDOW_DAYS,
  isSnapshotDay,
  type SnapshotDailyCount,
  type SnapshotNpmPackage,
  type SnapshotPopularEntry,
  type SnapshotRelease,
  type UsageStatsSnapshot,
} from './snapshot-contract'
import { utcDay, utcDayOffset } from './time'

export const SNAPSHOT_STATE_VERSION = 1
/** Daily totals older than this are forgotten; no source reports more than 30 days back. */
const STATE_RETENTION_DAYS = 62
const MIDPOINT_DIVISOR = 2

export interface DailyCounts {
  readonly count: number
  readonly uniques: number
}

export interface SnapshotState {
  readonly version: typeof SNAPSHOT_STATE_VERSION
  /** Last forwarded cumulative download count, by GitHub asset id. */
  readonly assets: Readonly<Record<string, number>>
  readonly views: Readonly<Record<string, DailyCounts>>
  readonly clones: Readonly<Record<string, DailyCounts>>
  /** Forwarded downloads per day, by npm package. */
  readonly npm: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** UTC day the 14-day popular referrers and paths were last forwarded. */
  readonly popularDay: string | null
  /** When the last forwarded snapshot ran, in milliseconds; `null` before the first. */
  readonly lastSnapshotAt: number | null
}

const EMPTY_STATE: SnapshotState = {
  version: SNAPSHOT_STATE_VERSION,
  assets: {},
  views: {},
  clones: {},
  npm: {},
  popularDay: null,
  lastSnapshotAt: null,
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isDailyCounts(value: unknown): value is DailyCounts {
  return isRecord(value) && isCount(value.count) && isCount(value.uniques)
}

function recordOf<T>(
  value: unknown,
  isKey: (key: string) => boolean,
  isValue: (item: unknown) => item is T,
) {
  if (!isRecord(value)) return undefined
  const entries: [string, T][] = []
  for (const [key, item] of Object.entries(value)) {
    if (!isKey(key) || !isValue(item)) return undefined
    entries.push([key, item])
  }
  return Object.fromEntries(entries)
}

const ASSET_ID = /^\d+$/u

function isDayCountRecord(value: unknown): value is Readonly<Record<string, number>> {
  return recordOf(value, isSnapshotDay, isCount) !== undefined
}

function isOptionalTime(value: unknown): value is number | null {
  return value === null || isCount(value)
}

function parsedRecords(value: Readonly<Record<string, unknown>>) {
  const assets = recordOf(value.assets, (key) => ASSET_ID.test(key), isCount)
  const views = recordOf(value.views, isSnapshotDay, isDailyCounts)
  const clones = recordOf(value.clones, isSnapshotDay, isDailyCounts)
  const npm = recordOf(value.npm, (key) => key !== '', isDayCountRecord)
  return assets && views && clones && npm ? { assets, views, clones, npm } : undefined
}

/**
 * Reads the stored state. `state: null` means nothing was stored yet; `ok: false` means the
 * stored value is unreadable, which must stop the snapshot rather than count everything again.
 * A state stored before snapshots recorded their time reads with `lastSnapshotAt: null`.
 */
export function parseSnapshotState(
  text: string | null,
): { readonly ok: true; readonly state: SnapshotState | null } | { readonly ok: false } {
  if (text === null) return { ok: true, state: null }
  const parsed = parseJsonText(text)
  if (!parsed.ok || !isRecord(parsed.value)) return { ok: false }
  const { version, popularDay, lastSnapshotAt = null } = parsed.value
  const records = parsedRecords(parsed.value)
  const validPopularDay = popularDay === null || isSnapshotDay(popularDay)
  if (version !== SNAPSHOT_STATE_VERSION || records === undefined || !validPopularDay) {
    return { ok: false }
  }
  if (!isOptionalTime(lastSnapshotAt)) return { ok: false }
  return { ok: true, state: { version, ...records, popularDay, lastSnapshotAt } }
}

function snapshotEvent(
  event: string,
  timestamp: string,
  properties: Readonly<Record<string, PostHogPropertyValue>>,
): PostHogEvent {
  return {
    event,
    timestamp,
    properties: { ...personlessProperties(ANONYMOUS_DISTINCT_ID), ...properties },
  }
}

/**
 * `channel` is the update feed an update check reads, otherwise the release's channel;
 * `release_channel` is always the channel of the release the asset belongs to. They differ
 * for feeds such as `latest-mac.yml` published with an alpha release.
 */
function downloadProperties(release: SnapshotRelease, asset: string, kind: ReleaseAssetClass) {
  const releaseChannelName = releaseChannel(release.tag)
  return {
    release: release.tag,
    release_channel: releaseChannelName,
    asset,
    asset_kind: kind.kind,
    platform: kind.platform,
    arch: kind.arch,
    channel: kind.feedChannel ?? releaseChannelName,
  }
}

/**
 * `github.download` events for download count increases. While no asset count is stored yet,
 * every count is an increase from zero; those events carry `baseline: true` because the
 * downloads happened before the first snapshot, not since the last one.
 */
function downloadDeltas(
  prior: SnapshotState,
  snapshot: UsageStatsSnapshot,
  timestamp: string,
  baseline: boolean,
) {
  const sent = new Map(Object.entries(prior.assets))
  const events: PostHogEvent[] = []
  for (const release of snapshot.releases) {
    for (const asset of release.assets) {
      const kind = classifyReleaseAsset(asset.name)
      const key = String(asset.id)
      const previous = sent.get(key) ?? 0
      if (kind === undefined || asset.download_count <= previous) continue
      const count = asset.download_count - previous
      const properties = { ...downloadProperties(release, asset.name, kind), count }
      events.push(
        snapshotEvent(
          'github.download',
          timestamp,
          baseline ? { ...properties, baseline } : properties,
        ),
      )
      sent.set(key, asset.download_count)
    }
  }
  return { events, assets: Object.fromEntries(sent) }
}

function trafficDeltas(
  prior: Readonly<Record<string, DailyCounts>>,
  days: readonly SnapshotDailyCount[],
  kind: 'views' | 'clones',
  horizon: string,
) {
  const sent = new Map(Object.entries(prior).filter(([day]) => day >= horizon))
  const events: PostHogEvent[] = []
  for (const { day, count, uniques } of days) {
    if (day < horizon) continue
    const previous = sent.get(day) ?? { count: 0, uniques: 0 }
    const addedCount = Math.max(0, count - previous.count)
    const addedUniques = Math.max(0, uniques - previous.uniques)
    if (addedCount > 0 || addedUniques > 0) {
      const properties = { kind, count: addedCount, uniques: addedUniques }
      events.push(snapshotEvent('github.traffic', middayTimestamp(day), properties))
    }
    sent.set(day, {
      count: Math.max(count, previous.count),
      uniques: Math.max(uniques, previous.uniques),
    })
  }
  return { events, days: Object.fromEntries(sent) }
}

function npmDeltas(
  prior: SnapshotState['npm'],
  packages: readonly SnapshotNpmPackage[],
  horizon: string,
) {
  const events: PostHogEvent[] = []
  const state: Record<string, Readonly<Record<string, number>>> = {}
  for (const [name, days] of Object.entries(prior)) {
    state[name] = Object.fromEntries(Object.entries(days).filter(([day]) => day >= horizon))
  }
  for (const npmPackage of packages) {
    const sent = new Map(Object.entries(state[npmPackage.name] ?? {}))
    for (const { day, downloads } of npmPackage.days) {
      const previous = sent.get(day) ?? 0
      if (day < horizon || downloads <= previous) continue
      const properties = { package: npmPackage.name, count: downloads - previous }
      events.push(snapshotEvent('npm.downloads', middayTimestamp(day), properties))
      sent.set(day, downloads)
    }
    state[npmPackage.name] = Object.fromEntries(sent)
  }
  return { events, npm: state }
}

/** The 14-day popular lists are rolling totals, so they are forwarded as is, once a day. */
function popularEvents(
  entries: readonly SnapshotPopularEntry[],
  event: string,
  key: string,
  timestamp: string,
) {
  return entries.map((entry) =>
    snapshotEvent(event, timestamp, {
      [key]: entry.name,
      count: entry.count,
      uniques: entry.uniques,
      window_days: GITHUB_TRAFFIC_WINDOW_DAYS,
    }),
  )
}

export interface SnapshotDeltas {
  readonly events: readonly PostHogEvent[]
  readonly state: SnapshotState
}

/**
 * When the downloads counted since the last snapshot happened, as one time: the midpoint between
 * the two snapshots, so a run at 05:23 UTC files most of the previous day's downloads under
 * that day. A baseline, or a state from before this field, is filed at the run itself.
 */
function downloadTimestamp(prior: SnapshotState, now: number, baseline: boolean) {
  if (baseline || prior.lastSnapshotAt === null || prior.lastSnapshotAt > now) {
    return new Date(now).toISOString()
  }
  return new Date(Math.round((prior.lastSnapshotAt + now) / MIDPOINT_DIVISOR)).toISOString()
}

/** The events to forward for `snapshot` and the state to store once they are forwarded. */
export function computeSnapshotDeltas(
  previous: SnapshotState | null,
  snapshot: UsageStatsSnapshot,
  now: number,
): SnapshotDeltas {
  const prior = previous ?? EMPTY_STATE
  const timestamp = new Date(now).toISOString()
  const today = utcDay(now)
  const horizon = utcDayOffset(now, -STATE_RETENTION_DAYS)
  const traffic = snapshot.traffic
  const baseline = Object.keys(prior.assets).length === 0
  const downloads = downloadDeltas(
    prior,
    snapshot,
    downloadTimestamp(prior, now, baseline),
    baseline,
  )
  const views = trafficDeltas(prior.views, traffic?.views ?? [], 'views', horizon)
  const clones = trafficDeltas(prior.clones, traffic?.clones ?? [], 'clones', horizon)
  const npm = npmDeltas(prior.npm, snapshot.npm, horizon)
  const sendPopular = traffic !== null && prior.popularDay !== today
  const popular = sendPopular
    ? [
        ...popularEvents(traffic.referrers, 'github.referrer', 'referrer', timestamp),
        ...popularEvents(traffic.paths, 'github.popular_path', 'path', timestamp),
      ]
    : []
  return {
    events: [...downloads.events, ...views.events, ...clones.events, ...npm.events, ...popular],
    state: {
      version: SNAPSHOT_STATE_VERSION,
      assets: downloads.assets,
      views: views.days,
      clones: clones.days,
      npm: npm.npm,
      popularDay: sendPopular ? today : prior.popularDay,
      lastSnapshotAt: now,
    },
  }
}
