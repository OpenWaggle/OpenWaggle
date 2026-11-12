import type { IncomingRequest } from './cloudflare'
import { configuredValue } from './environment'
import {
  carriesWebPageOrigin,
  emptyResponse,
  HTTP_STATUS,
  hasMediaType,
  isRecord,
  jsonResponse,
  parseJsonBytes,
  readLimitedBody,
} from './http'
import type { RouteResult } from './request-log'
import type { RouteContext } from './route-context'
import { parseSentryDsn } from './sentry-dsn'
import {
  type OutgoingEnvelopeItem,
  parseSentryEnvelope,
  type SentryEnvelope,
  serializeSentryEnvelope,
} from './sentry-envelope'
import { forwardSentryEnvelope } from './sentry-forward'
import { forwardedEnvelopeHeader, scrubSentryEvent } from './sentry-scrub'

/** Upper bound on an error report, compressed and decompressed alike. */
export const ERROR_REPORT_MAX_BYTES = 1_048_576
/** What the app's Sentry SDK sends: @sentry/electron's `net` transport sets this type. */
const ENVELOPE_MEDIA_TYPE = 'application/x-sentry-envelope'
const MAX_ENVELOPE_ITEMS = 32

/**
 * The only item type forwarded. Sessions, which carry a session id, attachments, minidumps,
 * replays, profiles, transactions and client reports are all dropped.
 */
const FORWARDED_ITEM_TYPE = 'event'

/** Sentry's back-off headers, relayed so the app's SDK slows down when Sentry asks it to. */
const RELAYED_RESPONSE_HEADERS = ['Retry-After', 'X-Sentry-Rate-Limits'] as const

const DECOMPRESSION_FORMATS: ReadonlyMap<string, CompressionFormat> = new Map([
  ['gzip', 'gzip'],
  ['x-gzip', 'gzip'],
  ['deflate', 'deflate'],
])

function rejectReport(status: number, reason: string, field = 'envelope'): RouteResult {
  return { response: jsonResponse(status, { error: reason }), outcome: 'rejected', field }
}

function skipReport(status: number, counts: { accepted?: number; rejected?: number } = {}) {
  const response =
    status === HTTP_STATUS.noContent ? emptyResponse(status) : jsonResponse(status, counts)
  return { response, outcome: 'skipped', ...counts } satisfies RouteResult
}

/** The request body, decompressed when the SDK gzipped it. `undefined` for other encodings. */
function decodedBody(request: IncomingRequest) {
  const encoding = request.headers.get('Content-Encoding')?.trim().toLowerCase()
  if (encoding === undefined || encoding === '' || encoding === 'identity') return request.body
  const format = DECOMPRESSION_FORMATS.get(encoding)
  if (format === undefined) return undefined
  return request.body?.pipeThrough(new DecompressionStream(format)) ?? null
}

function forwardedItems(envelope: SentryEnvelope) {
  const items: OutgoingEnvelopeItem[] = []
  for (const item of envelope.items) {
    if (item.header.type !== FORWARDED_ITEM_TYPE) continue
    const parsed = parseJsonBytes(item.payload)
    const payload = parsed.ok && isRecord(parsed.value) ? scrubSentryEvent(parsed.value) : undefined
    if (payload !== undefined) items.push({ type: FORWARDED_ITEM_TYPE, payload })
  }
  return items
}

async function relayResponse(
  upstream: Response,
  counts: { readonly accepted: number; readonly rejected: number },
): Promise<RouteResult> {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  for (const name of RELAYED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value !== null) headers[name] = value
  }
  const contentType = upstream.headers.get('Content-Type')
  if (contentType !== null) headers['Content-Type'] = contentType
  const response = new Response(await upstream.text(), { status: upstream.status, headers })
  if (upstream.ok) return { response, outcome: 'accepted', ...counts }
  return { response, outcome: 'forward_failed', accepted: 0, rejected: counts.rejected }
}

/**
 * `POST /api/v1/errors`: the tunnel for the app's Sentry SDK. It forwards only scrubbed `event`
 * items, under the real DSN, to that project's envelope endpoint. Browsers are turned away: a
 * request from a web page's Origin, or with another content type than the SDK's, is refused.
 * `Origin: null` is accepted, as Electron's `net` may send it; a browser sending it is stopped
 * anyway, since the envelope content type is not CORS-safelisted and its preflight is refused.
 * Status codes tell the cases apart in the request log: 204 when `SENTRY_DSN` is unset, 503
 * when it is not an EU Sentry DSN, 202 when nothing in the envelope may be forwarded, and
 * Sentry's own status otherwise.
 */
export async function handleErrorsRequest(context: RouteContext): Promise<RouteResult> {
  const { request, environment, dependencies } = context
  if (carriesWebPageOrigin(request)) {
    return rejectReport(HTTP_STATUS.forbidden, 'browser requests are not accepted', 'origin')
  }
  if (!hasMediaType(request, ENVELOPE_MEDIA_TYPE)) {
    return rejectReport(
      HTTP_STATUS.unsupportedMediaType,
      `expected ${ENVELOPE_MEDIA_TYPE}`,
      'content_type',
    )
  }
  const dsn = configuredValue(environment.SENTRY_DSN)
  if (dsn === undefined) return skipReport(HTTP_STATUS.noContent)
  const project = parseSentryDsn(dsn)
  if (project === undefined) return skipReport(HTTP_STATUS.serviceUnavailable)
  const stream = decodedBody(request)
  if (stream === undefined) {
    return rejectReport(HTTP_STATUS.unsupportedMediaType, 'unsupported content encoding')
  }
  const body = await readLimitedBody(stream, ERROR_REPORT_MAX_BYTES)
  if (!body.ok) {
    const status =
      body.reason === 'too large' ? HTTP_STATUS.payloadTooLarge : HTTP_STATUS.badRequest
    return rejectReport(status, `envelope is ${body.reason}`)
  }
  const envelope = parseSentryEnvelope(body.bytes, MAX_ENVELOPE_ITEMS)
  const header = envelope && forwardedEnvelopeHeader(envelope.header, project.dsn)
  if (envelope === undefined || header === undefined) {
    return rejectReport(HTTP_STATUS.badRequest, 'malformed envelope')
  }
  const items = forwardedItems(envelope)
  const counts = { accepted: items.length, rejected: envelope.items.length - items.length }
  if (items.length === 0) return skipReport(HTTP_STATUS.accepted, counts)
  const envelopeText = serializeSentryEnvelope(header, items)
  const upstream = await forwardSentryEnvelope(project, envelopeText, dependencies.fetch)
  if (upstream === undefined) {
    return {
      response: jsonResponse(HTTP_STATUS.badGateway, { error: 'Sentry is unreachable' }),
      outcome: 'forward_failed',
      accepted: 0,
      rejected: counts.rejected,
    }
  }
  return relayResponse(upstream, counts)
}
