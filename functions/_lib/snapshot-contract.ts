/**
 * The body the daily snapshot job (scripts/usage-stats-snapshot.ts) posts to
 * `/api/v1/snapshot`: cumulative GitHub release download counts, repository traffic and npm
 * downloads. Every figure is public or repository-level; none describes a person.
 */
import {
  type UsageStatisticsValidation,
  usageStatisticsEpochDay,
} from '../../src/shared/usage-statistics/validation'
import { isRecord } from './http'

export const USAGE_STATS_SNAPSHOT_SCHEMA_VERSION = 1
export const SNAPSHOT_MAX_BYTES = 4_194_304
/**
 * The flush the snapshot job calls after each snapshot, again while it reports entries left; it
 * forwards the buffered Usage statistics (see functions/_lib/flush-route.ts).
 */
export const USAGE_STATS_FLUSH_PATH = '/api/v1/flush'
/** GitHub's traffic API reports the last 14 days. */
export const GITHUB_TRAFFIC_WINDOW_DAYS = 14

const MAX_RELEASES = 5000
const MAX_ASSETS_PER_RELEASE = 200
const MAX_TRAFFIC_DAYS = 31
const MAX_POPULAR_ENTRIES = 50
const MAX_NPM_PACKAGES = 20
const MAX_NPM_DAYS = 400
const MAX_NAME_LENGTH = 512
const NPM_PACKAGE_NAME = /^@openwaggle\/[a-z0-9][a-z0-9-]*$/u

export interface SnapshotAsset {
  readonly id: number
  readonly name: string
  readonly download_count: number
}

export interface SnapshotRelease {
  readonly tag: string
  readonly assets: readonly SnapshotAsset[]
}

export interface SnapshotDailyCount {
  readonly day: string
  readonly count: number
  readonly uniques: number
}

/** A referrer or path from GitHub's 14-day popular lists. */
export interface SnapshotPopularEntry {
  readonly name: string
  readonly count: number
  readonly uniques: number
}

export interface SnapshotTraffic {
  readonly views: readonly SnapshotDailyCount[]
  readonly clones: readonly SnapshotDailyCount[]
  readonly referrers: readonly SnapshotPopularEntry[]
  readonly paths: readonly SnapshotPopularEntry[]
}

export interface SnapshotNpmDay {
  readonly day: string
  readonly downloads: number
}

export interface SnapshotNpmPackage {
  readonly name: string
  readonly days: readonly SnapshotNpmDay[]
}

export interface UsageStatsSnapshot {
  readonly schema: typeof USAGE_STATS_SNAPSHOT_SCHEMA_VERSION
  readonly releases: readonly SnapshotRelease[]
  /** `null` when the job has no token that may read repository traffic. */
  readonly traffic: SnapshotTraffic | null
  readonly npm: readonly SnapshotNpmPackage[]
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= MAX_NAME_LENGTH
}

export function isSnapshotDay(value: unknown): value is string {
  return typeof value === 'string' && usageStatisticsEpochDay(value) !== undefined
}

function mapped<T>(value: unknown, max: number, parse: (item: unknown) => T | undefined) {
  if (!Array.isArray(value) || value.length > max) return undefined
  const items: readonly unknown[] = value
  const parsed: T[] = []
  for (const item of items) {
    const result = parse(item)
    if (result === undefined) return undefined
    parsed.push(result)
  }
  return parsed
}

function asset(value: unknown) {
  if (!isRecord(value)) return undefined
  const { id, name, download_count } = value
  if (!isCount(id) || !isName(name) || !isCount(download_count)) return undefined
  const result: SnapshotAsset | undefined = { id, name, download_count }
  return result
}

function release(value: unknown) {
  if (!isRecord(value)) return undefined
  const { tag, assets: assetList } = value
  if (!isName(tag)) return undefined
  const assets = mapped(assetList, MAX_ASSETS_PER_RELEASE, asset)
  const result: SnapshotRelease | undefined = assets === undefined ? undefined : { tag, assets }
  return result
}

function dailyCount(value: unknown) {
  if (!isRecord(value)) return undefined
  const { day, count, uniques } = value
  const result: SnapshotDailyCount | undefined =
    isSnapshotDay(day) && isCount(count) && isCount(uniques) ? { day, count, uniques } : undefined
  return result
}

function popularEntry(value: unknown) {
  if (!isRecord(value)) return undefined
  const { name, count, uniques } = value
  const entry: SnapshotPopularEntry | undefined =
    isName(name) && isCount(count) && isCount(uniques) ? { name, count, uniques } : undefined
  return entry
}

function traffic(value: unknown) {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  const { views: viewList, clones: cloneList, referrers: referrerList, paths: pathList } = value
  const views = mapped(viewList, MAX_TRAFFIC_DAYS, dailyCount)
  const clones = mapped(cloneList, MAX_TRAFFIC_DAYS, dailyCount)
  const referrers = mapped(referrerList, MAX_POPULAR_ENTRIES, popularEntry)
  const paths = mapped(pathList, MAX_POPULAR_ENTRIES, popularEntry)
  if (!views || !clones || !referrers || !paths) return undefined
  const result: SnapshotTraffic | null | undefined = { views, clones, referrers, paths }
  return result
}

function npmDay(value: unknown) {
  if (!isRecord(value)) return undefined
  const { day, downloads } = value
  const result: SnapshotNpmDay | undefined =
    isSnapshotDay(day) && isCount(downloads) ? { day, downloads } : undefined
  return result
}

function npmPackage(value: unknown) {
  if (!isRecord(value)) return undefined
  const { name, days: dayList } = value
  if (typeof name !== 'string' || !NPM_PACKAGE_NAME.test(name)) return undefined
  const days = mapped(dayList, MAX_NPM_DAYS, npmDay)
  const result: SnapshotNpmPackage | undefined = days === undefined ? undefined : { name, days }
  return result
}

function failure(field: string, reason: string) {
  return { ok: false, field, reason } as const
}

/** Validates a snapshot body, rebuilding it from known fields only. */
export function validateUsageStatsSnapshot(value: unknown) {
  if (!isRecord(value)) {
    const validation: UsageStatisticsValidation<UsageStatsSnapshot> = failure(
      'snapshot',
      'expected an object',
    )
    return validation
  }
  const { schema, releases: releaseList, traffic: trafficValue, npm: npmList } = value
  if (schema !== USAGE_STATS_SNAPSHOT_SCHEMA_VERSION) {
    const validation: UsageStatisticsValidation<UsageStatsSnapshot> = failure(
      'schema',
      'unsupported schema version',
    )
    return validation
  }
  const releases = mapped(releaseList, MAX_RELEASES, release)
  if (releases === undefined) {
    const validation: UsageStatisticsValidation<UsageStatsSnapshot> = failure(
      'releases',
      'expected GitHub releases',
    )
    return validation
  }
  const repositoryTraffic = traffic(trafficValue)
  if (repositoryTraffic === undefined) {
    const validation: UsageStatisticsValidation<UsageStatsSnapshot> = failure(
      'traffic',
      'expected repository traffic',
    )
    return validation
  }
  const npm = mapped(npmList, MAX_NPM_PACKAGES, npmPackage)
  if (npm === undefined) {
    const validation: UsageStatisticsValidation<UsageStatsSnapshot> = failure(
      'npm',
      'expected npm downloads',
    )
    return validation
  }
  const validation: UsageStatisticsValidation<UsageStatsSnapshot> = {
    ok: true,
    value: {
      schema: USAGE_STATS_SNAPSHOT_SCHEMA_VERSION,
      releases,
      traffic: repositoryTraffic,
      npm,
    },
  }
  return validation
}
