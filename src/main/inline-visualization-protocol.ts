import { createHash } from 'node:crypto'
import {
  INLINE_VISUALIZATION_PROTOCOL,
  MAX_INLINE_VISUALIZATION_PATH_LENGTH,
} from '@shared/constants/inline-visualization'
import { SessionId } from '@shared/types/brand'
import type {
  InlineVisualizationFrameRegisterInput,
  InlineVisualizationFrameRegisterResult,
  InlineVisualizationFrameUnregisterInput,
  InlineVisualizationReadResult,
} from '@shared/types/inline-visualization'
import { inlineVisualizationFrameUrl } from '@shared/utils/inline-visualization'
import { protocol } from 'electron'
import lucideRuntime from 'lucide/dist/umd/lucide.min.js?raw'
import { readInlineVisualizationSource } from './application/inline-visualization-source-service'
import baseStyles from './inline-visualization-assets/base.css.raw?raw'
import hostStyles from './inline-visualization-assets/host.css.raw?raw'
import hostRuntime from './inline-visualization-assets/host-runtime.js.raw?raw'

const TEXT_HTML_CONTENT_TYPE = 'text/html; charset=utf-8'
const JAVASCRIPT_CONTENT_TYPE = 'text/javascript; charset=utf-8'
const CSS_CONTENT_TYPE = 'text/css; charset=utf-8'
const HTTP_NOT_FOUND_STATUS = 404
const MAX_SESSION_ID_LENGTH = 256
const FRAME_HOST_PATTERN =
  /^frame-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const FRAME_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const STATIC_ASSET_HOST = 'assets'
const LUCIDE_RUNTIME_DIGEST = createHash('sha256').update(lucideRuntime).digest('hex').slice(0, 16)
const LUCIDE_RUNTIME_PATH = `/lucide-${LUCIDE_RUNTIME_DIGEST}.js`
const LUCIDE_RUNTIME_URL = `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}://${STATIC_ASSET_HOST}${LUCIDE_RUNTIME_PATH}`
const CDN_SOURCES = [
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://esm.sh',
  'https://fonts.bunny.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://unpkg.com',
] as const
const LOCAL_RESOURCE_SOURCES = ['blob:', 'data:'] as const
const SCRIPT_SOURCES = [
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'wasm-unsafe-eval'",
  `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}:`,
  ...LOCAL_RESOURCE_SOURCES,
  ...CDN_SOURCES,
] as const
const STYLE_SOURCES = [
  "'unsafe-inline'",
  `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}:`,
  ...LOCAL_RESOURCE_SOURCES,
  ...CDN_SOURCES,
] as const
const IMAGE_SOURCES = ['data:', 'blob:', ...CDN_SOURCES] as const

export const VISUALIZATION_CONTENT_SECURITY_POLICY = [
  `default-src 'none'`,
  `script-src ${SCRIPT_SOURCES.join(' ')}`,
  `script-src-elem ${SCRIPT_SOURCES.join(' ')}`,
  `style-src ${STYLE_SOURCES.join(' ')}`,
  `img-src ${IMAGE_SOURCES.join(' ')}`,
  `font-src ${LOCAL_RESOURCE_SOURCES.join(' ')} ${CDN_SOURCES.join(' ')}`,
  `media-src data: blob: ${CDN_SOURCES.join(' ')}`,
  'connect-src blob: data:',
  `worker-src 'none'`,
  `child-src 'none'`,
  `frame-src 'none'`,
  `object-src 'none'`,
  `base-uri 'none'`,
  `form-action 'none'`,
].join('; ')

const HOST_RUNTIME = `<script>${hostRuntime.replace('__OPENWAGGLE_LUCIDE_ASSET_URL__', LUCIDE_RUNTIME_URL)}</script>`
const HOST_STYLES = `<style>${hostStyles}</style>`

interface InlineVisualizationProtocolDependencies {
  readonly readSource?: (input: {
    readonly sessionId: SessionId
    readonly sourcePath: string
  }) => Promise<InlineVisualizationReadResult>
}

let inlineVisualizationProtocolRegistered = false
let registrationSequence = 0

interface RegisteredInlineVisualizationFrame {
  readonly registrationId: string
  readonly ownerId: number
  readonly reducedMotion: boolean
  readonly sessionId: SessionId
  readonly sourcePath: string
}

const registeredFrames = new Map<string, RegisteredInlineVisualizationFrame>()

export function registerInlineVisualizationFrame(
  input: InlineVisualizationFrameRegisterInput,
  ownerId: number,
): InlineVisualizationFrameRegisterResult {
  if (!FRAME_ID_PATTERN.test(input.frameId)) throw new Error('Invalid visualization frame id')
  if (!input.sessionId || String(input.sessionId).length > MAX_SESSION_ID_LENGTH) {
    throw new Error('Invalid visualization session id')
  }
  if (!input.sourcePath || input.sourcePath.length > MAX_INLINE_VISUALIZATION_PATH_LENGTH) {
    throw new Error('Invalid visualization source path')
  }
  registrationSequence += 1
  const frameHost = `${INLINE_VISUALIZATION_PROTOCOL.FRAME_HOST_PREFIX}${input.frameId}`
  if (registeredFrames.has(frameHost)) {
    throw new Error('Visualization frame id is already registered')
  }
  const registrationId = `visualization-frame-registration-${String(registrationSequence)}`
  registeredFrames.set(frameHost, {
    registrationId,
    ownerId,
    reducedMotion: input.reducedMotion,
    sessionId: SessionId(input.sessionId),
    sourcePath: input.sourcePath,
  })
  return {
    frameUrl: inlineVisualizationFrameUrl(input.frameId),
    registrationId,
  }
}

export function unregisterInlineVisualizationFrame(
  input: InlineVisualizationFrameUnregisterInput,
  ownerId: number,
) {
  const frameHost = `${INLINE_VISUALIZATION_PROTOCOL.FRAME_HOST_PREFIX}${input.frameId}`
  const registration = registeredFrames.get(frameHost)
  if (registration?.registrationId === input.registrationId && registration.ownerId === ownerId) {
    registeredFrames.delete(frameHost)
  }
}

export function unregisterInlineVisualizationFramesForOwner(ownerId: number) {
  for (const [frameHost, registration] of registeredFrames) {
    if (registration.ownerId === ownerId) registeredFrames.delete(frameHost)
  }
}

function parseVisualizationRequest(requestUrl: string) {
  const url = new URL(requestUrl)
  if (
    url.protocol !== `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}:` ||
    !FRAME_HOST_PATTERN.test(url.host) ||
    url.pathname !== INLINE_VISUALIZATION_PROTOCOL.DOCUMENT_PATH ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return null
  }
  return { frameHost: url.host }
}

function isLucideRuntimeRequest(requestUrl: string) {
  const url = new URL(requestUrl)
  return (
    url.protocol === `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}:` &&
    url.host === STATIC_ASSET_HOST &&
    url.pathname === LUCIDE_RUNTIME_PATH &&
    url.search.length === 0
  )
}

function isRegisteredAssetRequest(requestUrl: string) {
  return registeredFrames.has(new URL(requestUrl).host)
}

function isBaseStyleRequest(requestUrl: string) {
  const url = new URL(requestUrl)
  return (
    url.protocol === `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}:` &&
    FRAME_HOST_PATTERN.test(url.host) &&
    url.pathname === INLINE_VISUALIZATION_PROTOCOL.BASE_STYLE_PATH &&
    url.search.length === 0
  )
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function visualizationDocument(
  frameHost: string,
  contents: string,
  reducedMotion: boolean,
  errorReason?: string,
) {
  const frameOrigin = `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}://${frameHost}`
  const baseStyleUrl = `${frameOrigin}${INLINE_VISUALIZATION_PROTOCOL.BASE_STYLE_PATH}`
  const errorMetadata = errorReason
    ? `<meta name="openwaggle-visualization-error" content="${escapeHtmlAttribute(errorReason)}">`
    : ''
  const motionAttribute = reducedMotion ? ' data-motion="reduced"' : ''
  return `<!doctype html><html${motionAttribute}><head><meta charset="utf-8">${errorMetadata}<link rel="stylesheet" href="${baseStyleUrl}">${HOST_STYLES}${HOST_RUNTIME}</head><body>${contents}</body></html>`
}

function visualizationResponse(document: string) {
  return new Response(document, {
    headers: {
      'content-type': TEXT_HTML_CONTENT_TYPE,
      'content-security-policy': VISUALIZATION_CONTENT_SECURITY_POLICY,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-dns-prefetch-control': 'off',
      'permissions-policy':
        'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), serial=(), hid=(), clipboard-read=(), clipboard-write=()',
      'cache-control': 'no-store',
    },
  })
}

function notFoundResponse() {
  return new Response(null, { status: HTTP_NOT_FOUND_STATUS })
}

async function defaultReadSource(input: {
  readonly sessionId: SessionId
  readonly sourcePath: string
}) {
  const { runAppEffect } = await import('./runtime')
  return runAppEffect(readInlineVisualizationSource(input))
}

export function inlineVisualizationUrl(frameId: string) {
  return inlineVisualizationFrameUrl(frameId)
}

export function registerInlineVisualizationProtocolOnce(
  dependencies: InlineVisualizationProtocolDependencies = {},
) {
  if (inlineVisualizationProtocolRegistered) return
  inlineVisualizationProtocolRegistered = true
  const readSource = dependencies.readSource ?? defaultReadSource

  protocol.handle(INLINE_VISUALIZATION_PROTOCOL.SCHEME, async (request) => {
    try {
      if (isLucideRuntimeRequest(request.url)) {
        return new Response(lucideRuntime, {
          headers: {
            'content-type': JAVASCRIPT_CONTENT_TYPE,
            'cache-control': 'public, max-age=31536000, immutable',
            'x-content-type-options': 'nosniff',
          },
        })
      }
      if (isBaseStyleRequest(request.url)) {
        if (!isRegisteredAssetRequest(request.url)) return notFoundResponse()
        return new Response(baseStyles, {
          headers: {
            'content-type': CSS_CONTENT_TYPE,
            'cache-control': 'public, max-age=31536000, immutable',
            'x-content-type-options': 'nosniff',
          },
        })
      }
      const input = parseVisualizationRequest(request.url)
      if (!input) return notFoundResponse()
      const registration = registeredFrames.get(input.frameHost)
      if (!registration) return notFoundResponse()
      const result = await readSource({
        sessionId: registration.sessionId,
        sourcePath: registration.sourcePath,
      })
      if (result.status !== 'loaded') {
        return visualizationResponse(
          visualizationDocument(
            input.frameHost,
            '<div class="card" role="alert">This visualization is unavailable.</div>',
            registration.reducedMotion,
            result.reason,
          ),
        )
      }
      return visualizationResponse(
        visualizationDocument(input.frameHost, result.contents, registration.reducedMotion),
      )
    } catch {
      return notFoundResponse()
    }
  })
}
