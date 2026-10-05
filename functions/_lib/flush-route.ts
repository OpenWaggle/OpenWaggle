import type { BufferEntry } from './buffer-entry'
import type { KeyValueStore } from './cloudflare'
import { aggregatedEvents } from './flush-aggregate'
import {
  attempt,
  budgetedStore,
  CLEANUP_MAX_KEYS,
  FLUSH_KV_OPERATIONS,
  inKvBatches,
  OperationBudget,
  PUBLISH_RESERVE,
} from './flush-budget'
import {
  leaseState,
  retireEntries,
  SAME_KEY_WRITE_INTERVAL_MS,
  takeFlushLease,
} from './flush-finish'
import {
  FLUSH_MANIFEST_KEY,
  type FlushManifest,
  readFlushManifest,
  readManifestEntries,
  writeFlushManifest,
} from './flush-manifest'
import {
  type BufferListing,
  type FlushSelection,
  listBufferKeys,
  readFlushCursor,
  selectEntries,
} from './flush-selection'
import { addUpEntries } from './flush-totals'
import { HTTP_STATUS, jsonResponse } from './http'
import { admitJobRequest } from './job-request'
import { type PostHogTarget, sendPostHogEvents } from './posthog'
import type { RouteResult } from './request-log'
import { pendingRequestEvent, type RouteContext } from './route-context'
import { epochDay } from './time'

interface FlushCall {
  readonly context: RouteContext
  readonly store: KeyValueStore
  readonly target: PostHogTarget
  readonly nonce: string
  /** When this call last wrote the manifest key, which KV allows once a second. */
  manifestWrittenAt?: number
}

interface FlushCounts {
  readonly remaining: number
  readonly held: number
  readonly discarded: number
  /** Entries already published or unreadable that this call deleted. */
  readonly cleaned: number
  readonly undeleted: number
  readonly cursor?: string
}

function answer(status: number, body: object, outcome: RouteResult['outcome']): RouteResult {
  return { response: jsonResponse(status, body), outcome }
}

/**
 * The lease is no longer this call's: 409 when another flush took it over, so this one
 * publishes nothing, and 503 when it cannot be read, which is a failure, not a takeover.
 */
function leaseRefusal(state: 'lost' | 'unknown') {
  if (state === 'lost') {
    return answer(HTTP_STATUS.conflict, { skipped: 'another flush took over' }, 'skipped')
  }
  const error = 'the flush lease could not be read'
  return answer(HTTP_STATUS.serviceUnavailable, { error }, 'forward_failed')
}

/** Writes the manifest key at least `SAME_KEY_WRITE_INTERVAL_MS` after this call last did. */
async function writeManifestKey(call: FlushCall, write: () => Promise<boolean>) {
  const { now, sleep } = call.context.dependencies
  if (call.manifestWrittenAt !== undefined) {
    const wait = call.manifestWrittenAt + SAME_KEY_WRITE_INTERVAL_MS - now()
    if (wait > 0) await sleep(wait)
  }
  const written = await write()
  call.manifestWrittenAt = now()
  return written
}

/**
 * Retires a published set, then its manifest, but only once every entry is deleted or
 * tombstoned. `undeleted` counts entries left in KV; whether a manifest left behind counts too
 * is up to the caller.
 */
async function finishManifest(call: FlushCall, manifest: FlushManifest, keys: readonly string[]) {
  const retired = await retireEntries(call.store, manifest.day, keys)
  const manifestDeleted =
    retired.unretired === 0 &&
    (await writeManifestKey(call, () => attempt(() => call.store.delete(FLUSH_MANIFEST_KEY))))
  return { undeleted: retired.undeleted, finished: manifestDeleted }
}

/** Sends one recorded set in a single batch, under UUIDs derived from it, and retires it. */
async function publish(
  call: FlushCall,
  manifest: FlushManifest,
  entries: readonly BufferEntry[],
  counts: FlushCounts,
): Promise<RouteResult> {
  const summary = { outcome: 'accepted', accepted: entries.length } as const
  const events = [
    ...(await aggregatedEvents(addUpEntries(manifest.day, entries), manifest.keys)),
    pendingRequestEvent(call.context, { ...summary, status: HTTP_STATUS.ok }),
  ]
  const forwarded = await sendPostHogEvents(events, call.target, call.context.dependencies.fetch)
  if (!forwarded.ok) {
    const response = jsonResponse(HTTP_STATUS.badGateway, { error: forwarded.reason })
    return { response, outcome: 'forward_failed', accepted: 0, accounted: true }
  }
  const finished = await finishManifest(call, manifest, manifest.keys)
  const body = {
    processed: entries.length,
    ...counts,
    undeleted: counts.undeleted + finished.undeleted,
  }
  return { ...summary, response: jsonResponse(HTTP_STATUS.ok, body), accounted: true }
}

/**
 * A manifest left by an earlier call. While every one of its entries is still there, untouched,
 * that batch's outcome is unknown, and exactly that set is sent again under the same UUIDs, so
 * PostHog drops the repeat. Otherwise the batch was accepted, and only its retiring is finished.
 */
async function resumeManifest(call: FlushCall, manifest: FlushManifest) {
  const read = await readManifestEntries(call.store, manifest)
  if (read.complete) {
    const lease = await leaseState(call.store, call.nonce)
    if (lease !== 'held') return { result: leaseRefusal(lease) }
    const entries = read.entries.map(({ entry }) => entry)
    const counts = { remaining: 1, held: 0, discarded: 0, cleaned: 0, undeleted: 0 }
    return { result: await publish(call, manifest, entries, counts) }
  }
  const finished = await finishManifest(call, manifest, read.present)
  if (finished.finished) return { result: undefined, undeleted: finished.undeleted }
  // Finishing the manifest was this call's only job, so a manifest it could not delete counts
  // as undeleted: the workflow then fails instead of stalling green behind it every run.
  const body = {
    processed: 0,
    remaining: 1,
    held: 0,
    discarded: 0,
    cleaned: 0,
    undeleted: finished.undeleted + 1,
  }
  return { result: answer(HTTP_STATUS.ok, body, 'skipped') }
}

/**
 * Deletes entries already published or unreadable, at most `CLEANUP_MAX_KEYS` per call. A call
 * about to publish keeps the reserve free; one that publishes nothing may use it.
 */
async function cleanUp(
  store: KeyValueStore,
  budget: OperationBudget,
  keys: readonly string[],
  publishing: boolean,
) {
  const fits = (count: number) => (publishing ? budget.allows(count) : budget.fits(count))
  const batch = keys.slice(0, CLEANUP_MAX_KEYS).filter((_key, index) => fits(index + 1))
  const deleted = await inKvBatches(batch, (key) => attempt(() => store.delete(key)))
  return { cleaned: deleted.filter(Boolean).length, failed: deleted.filter((done) => !done).length }
}

type OpenedCall =
  | {
      readonly ok: true
      readonly call: FlushCall
      readonly budget: OperationBudget
      readonly cursor?: string
    }
  | { readonly ok: false; readonly result: RouteResult }

/** Admits the job, reads its cursor, and takes the lease, counting every KV operation. */
async function openCall(context: RouteContext): Promise<OpenedCall> {
  const admission = await admitJobRequest(context)
  if (!admission.ok) return admission
  const start = await readFlushCursor(context.request)
  if (!start.ok) {
    const result = answer(
      HTTP_STATUS.badRequest,
      { error: 'expected {"cursor"?: string}' },
      'rejected',
    )
    return { ok: false, result }
  }
  const budget = new OperationBudget(FLUSH_KV_OPERATIONS, PUBLISH_RESERVE)
  const store = budgetedStore(admission.store, budget)
  const nonce = context.dependencies.randomUuid()
  const call: FlushCall = { context, store, target: admission.target, nonce }
  if (!(await takeFlushLease(store, nonce, context.dependencies.sleep))) {
    const result = answer(
      HTTP_STATUS.serviceUnavailable,
      { error: 'the flush lease could not be taken' },
      'forward_failed',
    )
    return { ok: false, result }
  }
  return { ok: true, call, budget, ...(start.cursor === undefined ? {} : { cursor: start.cursor }) }
}

/**
 * The counts of a call. Leftovers it had no room to delete count as remaining, so the workflow
 * keeps going, and the cursor moves on only once the listed pages hold nothing more to send or
 * delete.
 */
function flushCounts(
  listing: BufferListing,
  selection: FlushSelection,
  cleanup: { readonly cleaned: number; readonly failed: number },
  carriedUndeleted: number,
): FlushCounts {
  const uncleaned =
    selection.published.length + selection.corrupt.length - cleanup.cleaned - cleanup.failed
  const listed = listing.complete ? selection.remaining : Math.max(selection.remaining, 1)
  const settled = selection.remaining === 0 && uncleaned === 0
  const cursor = !listing.complete && settled ? listing.cursor : undefined
  return {
    remaining: listed + uncleaned,
    held: selection.held,
    discarded: selection.corrupt.length,
    cleaned: cleanup.cleaned,
    undeleted: carriedUndeleted + cleanup.failed,
    ...(cursor === undefined ? {} : { cursor }),
  }
}

/** Records the selected set, checks the lease once more, and publishes it. */
async function publishSelection(
  call: FlushCall,
  selection: FlushSelection,
  counts: FlushCounts,
): Promise<RouteResult> {
  if (selection.day === undefined || selection.entries.length === 0) {
    return { ...answer(HTTP_STATUS.ok, { processed: 0, ...counts }, 'skipped'), accepted: 0 }
  }
  const lease = await leaseState(call.store, call.nonce)
  if (lease !== 'held') return leaseRefusal(lease)
  const manifest = { day: selection.day, keys: selection.entries.map(({ key }) => key) }
  if (!(await writeManifestKey(call, () => writeFlushManifest(call.store, manifest)))) {
    return answer(
      HTTP_STATUS.serviceUnavailable,
      { error: 'the flush manifest could not be stored' },
      'forward_failed',
    )
  }
  return publish(
    call,
    manifest,
    selection.entries.map(({ entry }) => entry),
    counts,
  )
}

/**
 * `POST /api/v1/flush`, meant to run only from the usage-stats workflow, whose concurrency group
 * runs one job at a time. Each call sends at most one PostHog batch, adding up the buffered
 * entries of one day, oldest first:
 *
 * - a recent day is sent once it has `FLUSH_MIN_DAY_ENTRIES` entries with accepted app events,
 *   and any day once it is `FLUSH_AGED_DAY_DAYS` old, whatever its count, never split so that
 *   fewer than `FLUSH_MIN_DAY_ENTRIES` entries are left for later when they could go together;
 * - small cells are suppressed (./flush-totals.ts), and every record carries a UUID derived from
 *   the exact set it adds up;
 * - the call takes a best-effort lease (`flush-lease:v1`) before selecting, retrying once a
 *   second later when KV refuses the write, and checks it before publishing; when another call
 *   took it over, it answers 409 and publishes nothing, and when it cannot be read, 503;
 * - the selected set is recorded in a manifest before the batch is sent; a later call finishes
 *   a manifest it finds before selecting anything new. KV allows one write per key a second,
 *   so the call spaces its writes to the manifest key that far apart. A call that published
 *   leaves a manifest it could not delete for the next call; a call that only had to finish it
 *   and could not reports it as undeleted;
 * - sent entries are deleted once PostHog accepted them; an entry whose delete fails gets a
 *   tombstone instead, and the manifest stays until every entry is deleted or tombstoned;
 * - every KV operation counts against one budget of `FLUSH_KV_OPERATIONS`.
 *
 * It answers `{processed, remaining, held, discarded, cleaned, undeleted, cursor?}`. The workflow
 * calls again while `remaining` is above zero and the call made progress, sending or cleaning up,
 * or returned a `cursor`, which it passes back to list on from there; it fails when `undeleted`
 * is above zero.
 */
export async function handleFlushRequest(context: RouteContext): Promise<RouteResult> {
  const opened = await openCall(context)
  if (!opened.ok) return opened.result
  const { call, budget } = opened
  const pending = await readFlushManifest(call.store)
  const resumed = pending === undefined ? undefined : await resumeManifest(call, pending)
  if (resumed?.result !== undefined) return resumed.result
  const listing = await listBufferKeys(call.store, budget, opened.cursor)
  const today = epochDay(context.dependencies.now())
  const selection = await selectEntries(call.store, listing.keys, today, budget)
  const publishing = selection.day !== undefined && selection.entries.length > 0
  const leftovers = [...selection.published, ...selection.corrupt]
  const cleanup = await cleanUp(call.store, budget, leftovers, publishing)
  const counts = flushCounts(listing, selection, cleanup, resumed?.undeleted ?? 0)
  return publishSelection(call, selection, counts)
}
