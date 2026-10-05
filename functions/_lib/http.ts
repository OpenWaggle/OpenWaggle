/** Response, body and JSON helpers shared by every route of the statistics endpoint. */

export const HTTP_STATUS = {
  ok: 200,
  accepted: 202,
  noContent: 204,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  methodNotAllowed: 405,
  conflict: 409,
  payloadTooLarge: 413,
  unsupportedMediaType: 415,
  tooManyRequests: 429,
  internalServerError: 500,
  badGateway: 502,
  serviceUnavailable: 503,
} as const

const API_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...API_HEADERS, 'Content-Type': JSON_CONTENT_TYPE, ...headers },
  })
}

export function emptyResponse(
  status: number,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(null, { status, headers: { ...API_HEADERS, ...headers } })
}

export type BodyReadResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: 'too large' | 'unreadable' }

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function cancelQuietly(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel()
  } catch {
    // The stream is abandoned either way; a failed cancel leaves nothing to clean up.
    return
  }
}

/**
 * Reads a body stream, stopping as soon as it exceeds `maxBytes`, so an oversized or endless
 * body costs at most `maxBytes` of memory. Content-Length is never trusted.
 */
export async function readLimitedBody(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<BodyReadResult> {
  if (stream === null) return { ok: true, bytes: new Uint8Array() }
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await cancelQuietly(reader)
        return { ok: false, reason: 'too large' }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  return { ok: true, bytes: concatBytes(chunks) }
}

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
const UTF8_ENCODER = new TextEncoder()

/** Decodes strict UTF-8, or returns `undefined` for invalid byte sequences. */
export function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return UTF8_DECODER.decode(bytes)
  } catch {
    return undefined
  }
}

export function encodeUtf8(text: string) {
  return UTF8_ENCODER.encode(text)
}

export type JsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false }

/** Parses a UTF-8 JSON document without ever echoing its content in an error. */
export function parseJsonText(text: string | undefined): JsonParseResult {
  if (text === undefined) return { ok: false }
  try {
    const value: unknown = JSON.parse(text)
    return { ok: true, value }
  } catch {
    return { ok: false }
  }
}

export function parseJsonBytes(bytes: Uint8Array): JsonParseResult {
  return parseJsonText(decodeUtf8(bytes))
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Returns the first key of `record` that `allowed` rejects. */
export function firstUnexpectedKey(
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): string | undefined {
  return Object.keys(record).find((key) => !allowed.has(key))
}

const WEB_PAGE_ORIGIN = /^https?:\/\//iu
const OPAQUE_ORIGIN = 'null'

function originOf(request: Request) {
  return request.headers.get('Origin')?.trim() ?? ''
}

/** Whether the request carries the `Origin` of a web page, `http://` or `https://`. */
export function carriesWebPageOrigin(request: Request) {
  return WEB_PAGE_ORIGIN.test(originOf(request))
}

/**
 * Whether the request carries an `Origin` a browser sends: a web page's, or `null`, which a
 * browser sends for sandboxed and opaque documents. The app, the snapshot job and other scripts
 * send none, so routes meant only for them refuse it. A missing Origin and `file://` or `app://`
 * origins are allowed, so a desktop client that adds one still gets through.
 */
export function carriesBrowserOrigin(request: Request) {
  return carriesWebPageOrigin(request) || originOf(request).toLowerCase() === OPAQUE_ORIGIN
}

/** Whether `Content-Type` names `mediaType`, ignoring parameters such as `charset`. */
export function hasMediaType(request: Request, mediaType: string) {
  const value = request.headers.get('Content-Type')
  return value?.split(';', 1)[0]?.trim().toLowerCase() === mediaType
}

/** Drains a response body so the runtime can reuse the connection. */
export async function discardBody(response: Response) {
  try {
    await response.body?.cancel()
  } catch {
    // A body that cannot be cancelled is released when the response is collected.
    return
  }
}
