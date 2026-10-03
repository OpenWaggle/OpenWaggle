/**
 * The statistics endpoint as the daily snapshot job (./usage-stats-snapshot.ts) calls it: the
 * bearer-token POST, the snapshot and flush URLs, and the flush loop.
 */
import { isMatching, P } from '@diegogbrisa/ts-match'
import { USAGE_STATS_FLUSH_PATH } from '../functions/_lib/snapshot-contract'
import {
  USAGE_STATISTICS_ORIGIN,
  USAGE_STATISTICS_SNAPSHOT_PATH,
} from '../src/shared/usage-statistics/contract'

export const DEFAULT_SNAPSHOT_URL = `${USAGE_STATISTICS_ORIGIN}${USAGE_STATISTICS_SNAPSHOT_PATH}`
/**
 * Flush calls in one run at most, and the time they may take: the job's timeout is 20 minutes
 * (.github/workflows/usage-stats.yml), and a call takes a few seconds with its pause, so the
 * loop stops well within it and leaves the rest, which nothing loses, for the next run.
 */
export const MAX_FLUSH_CALLS = 200
export const FLUSH_TIME_LIMIT_MS = 720_000
/**
 * Pause between flush calls. Every call writes the flush lease, and KV refuses a second write
 * to one key within a second.
 */
export const FLUSH_CALL_INTERVAL_MS = 1100
export const SNAPSHOT_USER_AGENT = 'openwaggle-usage-stats-snapshot'
export const REQUEST_TIMEOUT_MS = 30_000
const ERROR_BODY_PREVIEW_LENGTH = 500

export type SnapshotFetch = (url: string, init: RequestInit) => Promise<Response>

export interface SnapshotJobEnvironment {
  readonly STATS_SNAPSHOT_TOKEN?: string
  readonly STATS_GITHUB_TOKEN?: string
  readonly GITHUB_TOKEN?: string
  readonly STATS_SNAPSHOT_URL?: string
}

export interface SnapshotJobOptions {
  readonly fetch: SnapshotFetch
  readonly env: SnapshotJobEnvironment
  readonly log: (line: string) => void
  /** Waits between flush calls; the real job sleeps, tests advance a clock. */
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly now?: () => number
}

function sleepFor(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

const isSkippedResponse = isMatching({ skipped: P.string })
const isFlushResponse = isMatching({
  processed: P.number,
  remaining: P.number,
  held: P.number,
  undeleted: P.number,
})
const hasCursor = isMatching({ cursor: P.string })
const hasCleaned = isMatching({ cleaned: P.number })

/** A trimmed setting, or `undefined` when it is unset or blank. */
export function configured(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

type EndpointAnswer =
  | { readonly skipped: string }
  | { readonly skipped?: undefined; readonly text: string; readonly body: unknown }

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Posts to the endpoint with the bearer token. A `skipped` answer means the endpoint is not
 * configured yet, which is reported rather than failed; any other refusal throws.
 */
export async function postToEndpoint(
  options: SnapshotJobOptions,
  url: string,
  token: string,
  body?: unknown,
): Promise<EndpointAnswer> {
  const response = await options.fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': SNAPSHOT_USER_AGENT,
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  const parsed = parsedJson(text)
  if (isSkippedResponse(parsed)) return { skipped: parsed.skipped }
  if (!response.ok) {
    throw new Error(
      `Endpoint ${new URL(url).pathname} answered ${String(response.status)}: ${text.slice(0, ERROR_BODY_PREVIEW_LENGTH)}`,
    )
  }
  return { text, body: parsed }
}

export function endpointUrls(env: SnapshotJobEnvironment) {
  const snapshot = configured(env.STATS_SNAPSHOT_URL) ?? DEFAULT_SNAPSHOT_URL
  return { snapshot, flush: new URL(USAGE_STATS_FLUSH_PATH, snapshot).toString() }
}

interface FlushAnswer {
  readonly processed: number
  readonly remaining: number
  readonly held: number
  readonly undeleted: number
  readonly cleaned: number
  readonly cursor?: string
}

/** A flush answer, or an error for one of another shape. */
function flushAnswer(body: unknown): FlushAnswer {
  const cursor = hasCursor(body) ? body.cursor : undefined
  const cleaned = hasCleaned(body) ? body.cleaned : 0
  if (!isFlushResponse(body)) throw new Error('The flush answered an unexpected shape.')
  return { ...body, cleaned, ...(cursor === undefined ? {} : { cursor }) }
}

/**
 * The last line of a flush loop that ended on its own. Entries still to send after a call that
 * made no progress are a warning, so a stalled flush shows on a green run.
 */
function logFlushEnd(options: SnapshotJobOptions, answer: FlushAnswer, flushed: number, calls: number) {
  const summary = `Flushed ${String(flushed)} buffered entries in ${String(calls)} calls`
  if (answer.remaining > 0) {
    options.log(
      `::warning::${summary}, then stopped: the last call made no progress with ${String(answer.remaining)} entries still to send. They wait for the next run.`,
    )
    return
  }
  options.log(`${summary}; ${String(answer.held)} wait for more entries of their day.`)
}

/** Whether another call can do more: entries remain, and this one sent, cleaned or moved on. */
function flushGoesOn(answer: FlushAnswer) {
  const progressed = answer.processed > 0 || answer.cleaned > 0 || answer.cursor !== undefined
  return answer.remaining > 0 && progressed
}

/**
 * Calls the flush until it reports nothing left, or nothing more it can send: a day with too
 * few entries waits in the buffer for the next run. A `cursor` in an answer is passed to the
 * next call, which lists on from there, so a long run of entries that must wait never hides
 * those behind it. It stops and fails as soon as a flush could not delete what it published, so
 * a KV problem never turns into the same entries sent again and again.
 */
export async function flushBufferedStatistics(options: SnapshotJobOptions, token: string) {
  const url = endpointUrls(options.env).flush
  const sleep = options.sleep ?? sleepFor
  const now = options.now ?? Date.now
  const deadline = now() + FLUSH_TIME_LIMIT_MS
  let flushed = 0
  let cursor: string | undefined
  for (let call = 1; call <= MAX_FLUSH_CALLS && now() < deadline; call += 1) {
    if (call > 1) await sleep(FLUSH_CALL_INTERVAL_MS)
    const posted = await postToEndpoint(options, url, token, cursor === undefined ? {} : { cursor })
    if (posted.skipped !== undefined) {
      options.log(`::warning::The endpoint flushed nothing: ${posted.skipped}.`)
      return
    }
    const answer = flushAnswer(posted.body)
    flushed += answer.processed
    if (answer.undeleted > 0) {
      throw new Error(
        `The flush published entries it could not delete (${String(answer.undeleted)}); stopped after ${String(flushed)} flushed entries. Check STATS_KV.`,
      )
    }
    cursor = answer.cursor
    if (!flushGoesOn(answer)) {
      logFlushEnd(options, answer, flushed, call)
      return
    }
  }
  options.log(
    `::warning::Stopped flushing after ${String(flushed)} entries at the run's call or time limit; the rest waits for the next run.`,
  )
}
