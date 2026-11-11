import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  TrustedOriginDomain,
  TrustedOriginHandler,
} from '../../ports/desktop-shell/trusted-origins'
import { TRUSTED_ORIGIN_SCHEMES } from '../../trusted-origin-schemes'
import { placeContentSecurityPolicy } from './electrobun-document-policy'

/**
 * The request side of Electrobun's loopback trusted origins (`electrobun-trusted-origins.ts`):
 * the host capability every request must start with, the translation of a loopback request into
 * the `<scheme>://<host>/path` request a domain handler expects, and the headers the shell adds.
 */
const CAPABILITY_LENGTH = 32
const HTTP_NOT_FOUND = 404
const HTTP_UNAVAILABLE = 503
const CLEAR_STORAGE = '"storage"'
const HTML_CONTENT_TYPE = /^\s*text\/html\b/iu
const HTML_UTF8 = 'text/html; charset=utf-8'

/** One served host, as the gateway needs it. */
export interface GatewayHost {
  readonly domain: TrustedOriginDomain
  readonly host: string
  readonly capability: string
  /** The next HTML document tells the engine to clear this origin's storage. */
  clearStorageOnNextDocument: boolean
}

/** What every HTML document of a domain gets, unless its handler set it. */
export interface DocumentPolicy {
  readonly headers?: HeadersInit
  /** Placed by `placeContentSecurityPolicy`, so CEF's injected preload still runs. */
  readonly contentSecurityPolicy?: string
}

export interface GatewayContext {
  readonly handler: TrustedOriginHandler | undefined
  readonly documentPolicy: DocumentPolicy
  /** A URL in `<scheme>://<host>` form, as pages address it. */
  readonly pageUrlOf: (logicalUrl: string) => string
}

/** The capability of `host` in `domain`: 192 bits of HMAC over both, keyed by the launch secret. */
export function capabilityFor(secret: Uint8Array, domain: TrustedOriginDomain, host: string) {
  return createHmac('sha256', secret)
    .update(`${domain}\n${host}`)
    .digest('base64url')
    .slice(0, CAPABILITY_LENGTH)
}

/** Whether `pathname` starts with the capability segment, compared in constant time. */
export function hasCapability(pathname: string, capability: string) {
  const segment = pathname.slice(1, 1 + CAPABILITY_LENGTH)
  const rest = pathname.slice(1 + CAPABILITY_LENGTH)
  if (segment.length !== CAPABILITY_LENGTH || (rest.length > 0 && !rest.startsWith('/'))) {
    return false
  }
  return timingSafeEqual(Buffer.from(segment), Buffer.from(capability))
}

/** The handler's view of a loopback URL: Electron's scheme URL for the same resource. */
export function logicalUrlOf(host: GatewayHost, url: URL) {
  const path = url.pathname.slice(1 + CAPABILITY_LENGTH) || '/'
  return `${TRUSTED_ORIGIN_SCHEMES[host.domain]}://${host.host}${path}${url.search}${url.hash}`
}

function isDomain(value: string): value is TrustedOriginDomain {
  return Object.hasOwn(TRUSTED_ORIGIN_SCHEMES, value)
}

export function domainOfScheme(scheme: string): TrustedOriginDomain | null {
  for (const [domain, candidate] of Object.entries(TRUSTED_ORIGIN_SCHEMES)) {
    if (candidate === scheme && isDomain(domain)) return domain
  }
  return null
}

export function notFound() {
  return new Response(null, { status: HTTP_NOT_FOUND })
}

/** The document with its policy placed; Bun encodes the rewritten text as UTF-8. */
async function withDocumentPolicy(headers: Headers, response: Response, policy: string) {
  const placed = placeContentSecurityPolicy(await response.text(), policy)
  headers.set('content-security-policy', placed.header)
  headers.set('content-type', HTML_UTF8)
  headers.delete('content-length')
  return placed.html
}

async function withShellHeaders(host: GatewayHost, context: GatewayContext, response: Response) {
  const headers = new Headers(response.headers)
  let body: BodyInit | null = response.body
  const location = headers.get('location')
  if (location) headers.set('location', context.pageUrlOf(location))
  if (!headers.has('x-content-type-options')) headers.set('x-content-type-options', 'nosniff')
  // Pages of other sites (a browser tab) cannot embed these responses, even without CORS.
  if (!headers.has('cross-origin-resource-policy')) {
    headers.set('cross-origin-resource-policy', 'same-site')
  }
  if (HTML_CONTENT_TYPE.test(headers.get('content-type') ?? '')) {
    const { contentSecurityPolicy } = context.documentPolicy
    if (contentSecurityPolicy !== undefined && !headers.has('content-security-policy')) {
      body = await withDocumentPolicy(headers, response, contentSecurityPolicy)
    }
    for (const [name, value] of new Headers(context.documentPolicy.headers)) {
      if (!headers.has(name)) headers.set(name, value)
    }
    if (host.clearStorageOnNextDocument) {
      headers.set('clear-site-data', CLEAR_STORAGE)
      host.clearStorageOnNextDocument = false
    }
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Answers one loopback request for `host`: an empty 404 without its capability, otherwise what
 * the domain handler answers for the same request in scheme form, with the shell headers.
 */
export async function answerTrustedRequest(
  host: GatewayHost,
  request: Request,
  context: GatewayContext,
) {
  const url = new URL(request.url)
  if (!hasCapability(url.pathname, host.capability)) return notFound()
  if (!context.handler) return new Response(null, { status: HTTP_UNAVAILABLE })
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const logical = new Request(logicalUrlOf(host, url), {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
    ...(hasBody ? { body: await request.arrayBuffer() } : {}),
  })
  try {
    return await withShellHeaders(host, context, await context.handler(logical))
  } catch {
    // The handler's own failure stays inside the main process, as it does on Electron.
    return notFound()
  }
}
