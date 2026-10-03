import { EndpointError } from './exception-report'
import { HTTP_STATUS, jsonResponse, parseJsonBytes, readLimitedBody } from './http'
import { admitJobRequest } from './job-request'
import { sendPostHogEvents } from './posthog'
import type { RouteResult } from './request-log'
import { pendingRequestEvent, type RouteContext } from './route-context'
import { SNAPSHOT_MAX_BYTES, validateUsageStatsSnapshot } from './snapshot-contract'
import { computeSnapshotDeltas, parseSnapshotState } from './snapshot-deltas'

/** KV key of what the snapshot already forwarded. */
export const SNAPSHOT_STATE_KEY = 'snapshot-state:v1'

async function readSnapshot(request: Request) {
  const body = await readLimitedBody(request.body, SNAPSHOT_MAX_BYTES)
  if (!body.ok) {
    return { ok: false, field: 'snapshot', reason: `snapshot is ${body.reason}` } as const
  }
  const parsed = parseJsonBytes(body.bytes)
  return validateUsageStatsSnapshot(parsed.ok ? parsed.value : undefined)
}

/**
 * `POST /api/v1/snapshot`: the daily GitHub and npm snapshot. It forwards only what grew since
 * the last forwarded snapshot, with its `endpoint.request` event, in one PostHog batch, and
 * stores the new totals only after PostHog accepted it, so a failed run is retried in full by
 * the next one and never partly counted twice.
 */
export async function handleSnapshotRequest(context: RouteContext): Promise<RouteResult> {
  const admission = await admitJobRequest(context)
  if (!admission.ok) return admission.result
  const { store, target } = admission
  const snapshot = await readSnapshot(context.request)
  if (!snapshot.ok) {
    const response = jsonResponse(HTTP_STATUS.badRequest, { error: snapshot.reason })
    return { response, outcome: 'rejected', field: snapshot.field }
  }
  const stored = parseSnapshotState(await store.get(SNAPSHOT_STATE_KEY))
  if (!stored.ok) throw new EndpointError(`${SNAPSHOT_STATE_KEY} in STATS_KV is unreadable`)
  const deltas = computeSnapshotDeltas(stored.state, snapshot.value, context.dependencies.now())
  const events = deltas.events.length
  const summary = { outcome: 'accepted', accepted: events } as const
  const batch =
    events === 0
      ? []
      : [
          ...deltas.events,
          pendingRequestEvent(context, { ...summary, status: HTTP_STATUS.accepted }),
        ]
  const forwarded = await sendPostHogEvents(batch, target, context.dependencies.fetch)
  if (!forwarded.ok) {
    const response = jsonResponse(HTTP_STATUS.badGateway, { error: forwarded.reason })
    return { response, outcome: 'forward_failed', accounted: true }
  }
  await store.put(SNAPSHOT_STATE_KEY, JSON.stringify(deltas.state))
  const response = jsonResponse(HTTP_STATUS.accepted, { events })
  return { ...summary, response, accounted: batch.length > 0 }
}
