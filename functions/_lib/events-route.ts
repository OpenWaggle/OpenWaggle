import {
  USAGE_STATISTICS_CONTEXT_FIELDS,
  USAGE_STATISTICS_EVENT_FIELDS,
  USAGE_STATISTICS_EVENTS_PATH,
  USAGE_STATISTICS_MAX_EVENTS_PER_REQUEST,
  USAGE_STATISTICS_MAX_REQUEST_BYTES,
  USAGE_STATISTICS_SCHEMA_VERSION,
  type UsageStatisticsContext,
  type UsageStatisticsEvent,
} from '../../src/shared/usage-statistics/contract'
import {
  validateUsageStatisticsContext,
  validateUsageStatisticsEvent,
} from '../../src/shared/usage-statistics/validation'
import {
  addEventCounts,
  type BufferEntry,
  BufferEntryBuilder,
  bufferExpiration,
  bufferKey,
  COUNT_FIELD,
  serializeBufferEntry,
} from './buffer-entry'
import { withCatalogIdentifiers } from './catalog'
import type { KeyValueStore } from './cloudflare'
import { statisticsStore } from './environment'
import {
  carriesBrowserOrigin,
  firstUnexpectedKey,
  HTTP_STATUS,
  hasMediaType,
  isRecord,
  jsonResponse,
  parseJsonBytes,
  readLimitedBody,
} from './http'
import { requestCountry } from './request-country'
import {
  BUFFERED_REQUESTS_EVENT_NAME,
  latencyBucket,
  type RequestSummary,
  type RouteResult,
} from './request-log'
import { checkRequestShape } from './request-shape'
import { elapsed, type RouteContext } from './route-context'
import { epochDay } from './time'

const JSON_MEDIA_TYPE = 'application/json'
const REQUEST_KEYS: ReadonlySet<string> = new Set(['schema', 'context', 'events'])
const STRUCTURAL_FIELDS = [
  'origin',
  'content_type',
  'body',
  'request',
  ...REQUEST_KEYS,
  'event',
  'name',
  'day',
  'properties',
]

/** Field names the endpoint may log: published names only, never a key a client made up. */
const PUBLISHED_FIELD_NAMES: ReadonlySet<string> = new Set([
  ...STRUCTURAL_FIELDS,
  ...Object.keys(USAGE_STATISTICS_CONTEXT_FIELDS),
  ...Object.values(USAGE_STATISTICS_EVENT_FIELDS).flatMap((fields) => Object.keys(fields)),
])

export const UNPUBLISHED_FIELD = '(unpublished)'

/** A rejected field's name when it is on the published list, otherwise a placeholder. */
export function publishedFieldName(field: string) {
  return PUBLISHED_FIELD_NAMES.has(field) ? field : UNPUBLISHED_FIELD
}

interface AcceptedBatch {
  readonly context: UsageStatisticsContext
  readonly events: readonly UsageStatisticsEvent[]
  readonly rejected: number
  /** Published name of the first rejected event's offending field. */
  readonly rejectedField?: string
}

interface BatchRejection {
  readonly ok: false
  readonly status: number
  readonly field: string
  readonly reason: string
  readonly rejected: number
}

type BatchCheck = { readonly ok: true; readonly batch: AcceptedBatch } | BatchRejection

function rejection(status: number, field: string, reason: string, rejected = 0): BatchRejection {
  return { ok: false, status, field: publishedFieldName(field), reason, rejected }
}

function rejectedResult(status: number, field: string, reason: string, rejected = 0): RouteResult {
  const loggedField = publishedFieldName(field)
  return {
    response: jsonResponse(status, { accepted: 0, rejected, error: reason, field: loggedField }),
    outcome: 'rejected',
    field: loggedField,
    accepted: 0,
    rejected,
  }
}

function validateEvents(candidates: readonly unknown[], todayEpochDay: number) {
  const events: UsageStatisticsEvent[] = []
  let rejectedField: string | undefined
  for (const candidate of candidates) {
    const result = validateUsageStatisticsEvent(candidate, todayEpochDay)
    if (result.ok) events.push(result.value)
    else rejectedField ??= publishedFieldName(result.field)
  }
  return { events, rejected: candidates.length - events.length, rejectedField }
}

/** Checks a parsed request: its fields, the context, every event and the request's shape. */
function checkBatch(payload: Readonly<Record<string, unknown>>, todayEpochDay: number): BatchCheck {
  if (firstUnexpectedKey(payload, REQUEST_KEYS) !== undefined) {
    return rejection(HTTP_STATUS.badRequest, 'request', 'unknown field')
  }
  if (payload.schema !== USAGE_STATISTICS_SCHEMA_VERSION) {
    return rejection(HTTP_STATUS.badRequest, 'schema', 'unsupported schema version')
  }
  const list: unknown = payload.events
  if (!Array.isArray(list)) return rejection(HTTP_STATUS.badRequest, 'events', 'expected a list')
  const candidates: readonly unknown[] = list
  if (candidates.length > USAGE_STATISTICS_MAX_EVENTS_PER_REQUEST) {
    return rejection(HTTP_STATUS.payloadTooLarge, 'events', 'too many events', candidates.length)
  }
  const context = validateUsageStatisticsContext(payload.context)
  if (!context.ok) {
    return rejection(HTTP_STATUS.badRequest, context.field, context.reason, candidates.length)
  }
  const { events, rejected, rejectedField } = validateEvents(candidates, todayEpochDay)
  const shape = checkRequestShape(events)
  if (!shape.ok) {
    return rejection(HTTP_STATUS.badRequest, shape.field, shape.reason, candidates.length)
  }
  const batch = { context: context.value, events, rejected }
  return { ok: true, batch: rejectedField === undefined ? batch : { ...batch, rejectedField } }
}

/**
 * Counts of this request for `endpoint.requests`, filed with its statistics under their day, so
 * the flush publishes them as per-day totals like everything else in the entry.
 */
function addRequestCounts(
  builder: BufferEntryBuilder,
  summary: RequestSummary & { readonly status: number },
  latencyMs: number,
) {
  const event = BUFFERED_REQUESTS_EVENT_NAME
  builder.count(event, COUNT_FIELD, '1')
  builder.count(event, 'path', USAGE_STATISTICS_EVENTS_PATH)
  builder.count(event, 'outcome', summary.outcome)
  builder.count(event, 'status', String(summary.status))
  builder.count(event, 'latency', latencyBucket(latencyMs))
  if (summary.field !== undefined) builder.count(event, 'field', summary.field)
  builder.sum(event, 'accepted', summary.accepted ?? 0)
  builder.sum(event, 'rejected', summary.rejected ?? 0)
}

async function storeEntry(store: KeyValueStore, entry: BufferEntry, uuid: string) {
  try {
    await store.put(bufferKey(entry.day, uuid), serializeBufferEntry(entry), {
      expiration: bufferExpiration(entry.day),
    })
    return true
  } catch {
    return false
  }
}

async function readPayload(request: Request) {
  const body = await readLimitedBody(request.body, USAGE_STATISTICS_MAX_REQUEST_BYTES)
  if (!body.ok) {
    const result =
      body.reason === 'too large'
        ? rejectedResult(HTTP_STATUS.payloadTooLarge, 'body', 'body is too large')
        : rejectedResult(HTTP_STATUS.badRequest, 'body', 'body is unreadable')
    return { ok: false, result } as const
  }
  const parsed = parseJsonBytes(body.bytes)
  if (parsed.ok && isRecord(parsed.value)) return { ok: true, value: parsed.value } as const
  const result = rejectedResult(HTTP_STATUS.badRequest, 'body', 'expected a JSON object')
  return { ok: false, result } as const
}

/**
 * `POST /api/v1/events`: validates a Usage statistics request against the published contract
 * and stores it as one buffer entry of counts; the flush later adds the day's entries up and
 * forwards only those totals (ADR 0044, ADR 0045). Invalid events are dropped and counted,
 * non-catalog identifiers become `custom`, and storing the entry is the last step, so a 202
 * means the request is stored and any failure before it stores nothing. A request without one
 * accepted event stores nothing at all; its rejection shows only in the log line. Of the request
 * it reads only the Origin and Content-Type headers, which turn browsers away, and Cloudflare's
 * country.
 */
export async function handleEventsRequest(context: RouteContext): Promise<RouteResult> {
  const { request } = context
  if (carriesBrowserOrigin(request)) {
    return rejectedResult(HTTP_STATUS.forbidden, 'origin', 'browser requests are not accepted')
  }
  if (!hasMediaType(request, JSON_MEDIA_TYPE)) {
    return rejectedResult(HTTP_STATUS.unsupportedMediaType, 'content_type', 'expected JSON')
  }
  const store = statisticsStore(context.environment)
  if (store === undefined) {
    const response = jsonResponse(HTTP_STATUS.serviceUnavailable, {
      error: 'STATS_KV is not bound',
    })
    return { response, outcome: 'skipped' }
  }
  const payload = await readPayload(request)
  if (!payload.ok) return payload.result
  const check = checkBatch(payload.value, epochDay(context.dependencies.now()))
  if (!check.ok) return rejectedResult(check.status, check.field, check.reason, check.rejected)
  const { batch } = check
  const [first] = batch.events
  const counts = { accepted: batch.events.length, rejected: batch.rejected }
  const field = batch.rejectedField === undefined ? {} : { field: batch.rejectedField }
  if (first === undefined) {
    const outcome = batch.rejected > 0 ? 'rejected' : 'skipped'
    return { response: jsonResponse(HTTP_STATUS.accepted, counts), outcome, ...field, ...counts }
  }
  const builder = new BufferEntryBuilder()
  const country = requestCountry(request)
  for (const event of batch.events) {
    addEventCounts(builder, withCatalogIdentifiers(event), batch.context, country)
  }
  const summary: RequestSummary = { outcome: 'accepted', ...field, ...counts }
  addRequestCounts(builder, { ...summary, status: HTTP_STATUS.accepted }, elapsed(context))
  const stored = await storeEntry(
    store,
    builder.build(first.day),
    context.dependencies.randomUuid(),
  )
  if (!stored) {
    const response = jsonResponse(HTTP_STATUS.serviceUnavailable, { error: 'storage failed' })
    return { response, outcome: 'forward_failed', accepted: 0, rejected: batch.rejected }
  }
  return { ...summary, response: jsonResponse(HTTP_STATUS.accepted, counts) }
}
