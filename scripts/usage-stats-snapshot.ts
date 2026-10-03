/**
 * Daily GitHub and npm snapshot for Usage statistics (ADR 0045). It collects cumulative release
 * download counts, repository traffic and npm downloads, and posts them to the statistics
 * endpoint, which forwards to PostHog only what grew since the snapshot before. It then calls
 * the endpoint's flush until no buffered app statistics are left to send.
 *
 * Environment:
 * - `STATS_SNAPSHOT_TOKEN`: bearer token the endpoint expects. Without it the job does nothing
 *   and exits successfully, so forks and unconfigured repositories stay green.
 * - `GITHUB_TOKEN`: the workflow token, for release reads.
 * - `STATS_GITHUB_TOKEN`: optional token with Administration: read, used only for repository
 *   traffic. Without it, or when GitHub refuses it, the snapshot carries no traffic.
 * - `STATS_SNAPSHOT_URL`: optional endpoint override, for local testing; the flush is called on
 *   the same origin.
 *
 * Usage: `pnpm exec tsx scripts/usage-stats-snapshot.ts [--dry-run]`
 */
import { pathToFileURL } from 'node:url'
import { isMatching, P } from '@diegogbrisa/ts-match'
import {
  type SnapshotDailyCount,
  type SnapshotNpmPackage,
  type SnapshotPopularEntry,
  type SnapshotRelease,
  type SnapshotTraffic,
  USAGE_STATS_SNAPSHOT_SCHEMA_VERSION,
  type UsageStatsSnapshot,
} from '../functions/_lib/snapshot-contract'
import {
  configured,
  endpointUrls,
  flushBufferedStatistics,
  postToEndpoint,
  REQUEST_TIMEOUT_MS,
  SNAPSHOT_USER_AGENT,
  type SnapshotJobOptions,
} from './usage-stats-snapshot-endpoint'

export const SNAPSHOT_REPOSITORY = 'OpenWaggle/OpenWaggle'
export const SNAPSHOT_NPM_PACKAGES = [
  '@openwaggle/extension-sdk',
  '@openwaggle/extension-react',
  '@openwaggle/waggle-core',
  '@openwaggle/pi-waggle',
] as const

const GITHUB_API = 'https://api.github.com'
const NPM_DOWNLOADS_API = 'https://api.npmjs.org/downloads/range/last-month'
const RELEASES_PER_PAGE = 100
const MAX_RELEASE_PAGES = 50
const ISO_DAY_LENGTH = 10
const JSON_INDENT = 2
const NEXT_PAGE_LINK = /<(?<url>[^>]+)>\s*;\s*rel="next"/u

const isReleasePage = isMatching(
  P.array({
    tag_name: P.string,
    draft: P.boolean,
    assets: P.array({ id: P.number, name: P.string, download_count: P.number }),
  }),
)
const DAILY_COUNT = { timestamp: P.string, count: P.number, uniques: P.number }
const isViews = isMatching({ views: P.array(DAILY_COUNT) })
const isClones = isMatching({ clones: P.array(DAILY_COUNT) })
const isReferrers = isMatching(P.array({ referrer: P.string, count: P.number, uniques: P.number }))
const isPaths = isMatching(P.array({ path: P.string, count: P.number, uniques: P.number }))
const isNpmRange = isMatching({ downloads: P.array({ day: P.string, downloads: P.number }) })

function githubHeaders(token: string | undefined): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': SNAPSHOT_USER_AGENT,
    ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
  }
}

async function getJson(options: SnapshotJobOptions, url: string, headers: Record<string, string>) {
  const response = await options.fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body: unknown = response.ok ? await response.json() : undefined
  if (!response.ok) await response.body?.cancel()
  return { response, body }
}

function nextPage(link: string | null) {
  for (const part of link?.split(',') ?? []) {
    const url = NEXT_PAGE_LINK.exec(part)?.groups?.url
    if (url !== undefined) return url
  }
  return undefined
}

/**
 * Every published release with the assets that were downloaded at least once, read with the
 * workflow's own token: the traffic token is never needed for public data, so an expired one
 * cannot stop the snapshot.
 */
export async function collectReleases(options: SnapshotJobOptions): Promise<SnapshotRelease[]> {
  const token = configured(options.env.GITHUB_TOKEN)
  const releases: SnapshotRelease[] = []
  let url: string | undefined =
    `${GITHUB_API}/repos/${SNAPSHOT_REPOSITORY}/releases?per_page=${String(RELEASES_PER_PAGE)}`
  for (let page = 0; url !== undefined && page < MAX_RELEASE_PAGES; page += 1) {
    const { response, body } = await getJson(options, url, githubHeaders(token))
    if (!response.ok) throw new Error(`GitHub releases answered ${String(response.status)}.`)
    if (!isReleasePage(body)) throw new Error('GitHub releases returned an unexpected shape.')
    for (const release of body.filter((candidate) => !candidate.draft)) {
      releases.push({
        tag: release.tag_name,
        assets: release.assets
          .filter((asset) => asset.download_count > 0)
          .map(({ id, name, download_count }) => ({ id, name, download_count })),
      })
    }
    url = nextPage(response.headers.get('Link'))
  }
  if (url !== undefined) {
    options.log(`::warning::Stopped reading GitHub releases after ${String(MAX_RELEASE_PAGES)} pages.`)
  }
  return releases
}

function dailyCounts(days: readonly { timestamp: string; count: number; uniques: number }[]) {
  return days.map(
    (day): SnapshotDailyCount => ({
      day: day.timestamp.slice(0, ISO_DAY_LENGTH),
      count: day.count,
      uniques: day.uniques,
    }),
  )
}

function popular(entries: readonly { name: string; count: number; uniques: number }[]) {
  return entries.map(({ name, count, uniques }): SnapshotPopularEntry => ({ name, count, uniques }))
}

/** Views, clones, referrers and popular paths, or `null` when they cannot be read. */
export async function collectTraffic(options: SnapshotJobOptions): Promise<SnapshotTraffic | null> {
  const token = configured(options.env.STATS_GITHUB_TOKEN)
  if (token === undefined) {
    options.log('STATS_GITHUB_TOKEN is not set; the snapshot carries no repository traffic.')
    return null
  }
  const base = `${GITHUB_API}/repos/${SNAPSHOT_REPOSITORY}/traffic`
  const headers = githubHeaders(token)
  const [views, clones, referrers, paths] = await Promise.all(
    ['views?per=day', 'clones?per=day', 'popular/referrers', 'popular/paths'].map((path) =>
      getJson(options, `${base}/${path}`, headers),
    ),
  )
  const failed = [views, clones, referrers, paths].find(({ response }) => !response.ok)
  if (failed !== undefined) {
    // 401 means an expired or revoked token, 403 one without Administration: read.
    options.log(
      `::warning::GitHub traffic answered ${String(failed.response.status)}; the snapshot carries no traffic. STATS_GITHUB_TOKEN needs Administration: read.`,
    )
    return null
  }
  if (!isViews(views.body) || !isClones(clones.body)) {
    throw new Error('GitHub traffic returned an unexpected shape.')
  }
  if (!isReferrers(referrers.body) || !isPaths(paths.body)) {
    throw new Error('GitHub popular lists returned an unexpected shape.')
  }
  return {
    views: dailyCounts(views.body.views),
    clones: dailyCounts(clones.body.clones),
    referrers: popular(referrers.body.map(({ referrer, ...counts }) => ({ name: referrer, ...counts }))),
    paths: popular(paths.body.map(({ path, ...counts }) => ({ name: path, ...counts }))),
  }
}

/** Last month's daily downloads of each published package; unpublished ones are skipped. */
export async function collectNpmDownloads(options: SnapshotJobOptions): Promise<SnapshotNpmPackage[]> {
  const packages: SnapshotNpmPackage[] = []
  for (const name of SNAPSHOT_NPM_PACKAGES) {
    const { response, body } = await getJson(options, `${NPM_DOWNLOADS_API}/${name}`, {
      'User-Agent': SNAPSHOT_USER_AGENT,
    })
    if (!response.ok || !isNpmRange(body)) {
      options.log(`::warning::npm downloads for ${name} answered ${String(response.status)}; skipped.`)
      continue
    }
    packages.push({ name, days: body.downloads.map(({ day, downloads }) => ({ day, downloads })) })
  }
  return packages
}

export async function collectUsageStatsSnapshot(options: SnapshotJobOptions): Promise<UsageStatsSnapshot> {
  const [releases, traffic, npm] = await Promise.all([
    collectReleases(options),
    collectTraffic(options),
    collectNpmDownloads(options),
  ])
  return { schema: USAGE_STATS_SNAPSHOT_SCHEMA_VERSION, releases, traffic, npm }
}

function summary(snapshot: UsageStatsSnapshot) {
  const assets = snapshot.releases.reduce((total, release) => total + release.assets.length, 0)
  const traffic = snapshot.traffic === null ? 'no traffic' : `${String(snapshot.traffic.views.length)} traffic days`
  return `Collected ${String(snapshot.releases.length)} releases with ${String(assets)} downloaded assets, ${traffic}, ${String(snapshot.npm.length)} npm packages.`
}

async function sendSnapshot(options: SnapshotJobOptions, token: string) {
  const snapshot = await collectUsageStatsSnapshot(options)
  options.log(summary(snapshot))
  const answer = await postToEndpoint(options, endpointUrls(options.env).snapshot, token, snapshot)
  if (answer.skipped !== undefined) {
    options.log(`::warning::The endpoint stored nothing: ${answer.skipped}.`)
    return
  }
  options.log(`Snapshot endpoint: ${answer.text}`)
}

function failureMessage(step: string, error: unknown) {
  return `${step} failed: ${error instanceof Error ? error.message : String(error)}`
}

/**
 * Sends the snapshot, then flushes the buffered app statistics whether or not the snapshot
 * succeeded, since they do not depend on it; fails when either step failed.
 */
export async function runUsageStatsSnapshot(options: SnapshotJobOptions & { readonly dryRun: boolean }) {
  const token = configured(options.env.STATS_SNAPSHOT_TOKEN)
  if (token === undefined && !options.dryRun) {
    options.log('::notice::STATS_SNAPSHOT_TOKEN is not set; skipping the usage statistics snapshot.')
    return
  }
  if (options.dryRun || token === undefined) {
    const snapshot = await collectUsageStatsSnapshot(options)
    options.log(summary(snapshot))
    options.log(JSON.stringify(snapshot, null, JSON_INDENT))
    return
  }
  const failures: string[] = []
  const steps = [
    ['The snapshot', () => sendSnapshot(options, token)],
    ['The flush', () => flushBufferedStatistics(options, token)],
  ] as const
  for (const [step, run] of steps) {
    try {
      await run()
    } catch (error) {
      failures.push(failureMessage(step, error))
      options.log(`::error::${failureMessage(step, error)}`)
    }
  }
  if (failures.length > 0) throw new Error(failures.join(' '))
}

async function main() {
  await runUsageStatsSnapshot({
    fetch: (url, init) => fetch(url, init),
    env: process.env,
    log: (line) => console.log(line),
    dryRun: process.argv.includes('--dry-run'),
  })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
