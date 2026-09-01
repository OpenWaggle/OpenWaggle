import { INLINE_VISUALIZATION_PROTOCOL } from '@shared/constants/inline-visualization'
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
import hostRuntime from './inline-visualization-assets/host-runtime.js.raw?raw'

const TEXT_HTML_CONTENT_TYPE = 'text/html; charset=utf-8'
const JAVASCRIPT_CONTENT_TYPE = 'text/javascript; charset=utf-8'
const CSS_CONTENT_TYPE = 'text/css; charset=utf-8'
const HTTP_NOT_FOUND_STATUS = 404
const MAX_SESSION_ID_LENGTH = 256
const MAX_SOURCE_PATH_LENGTH = 32_768
const FRAME_HOST_PATTERN =
  /^frame-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const FRAME_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CDN_SOURCES = [
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://esm.sh',
  'https://fonts.bunny.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://unpkg.com',
] as const
const SCRIPT_SOURCES = [
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'wasm-unsafe-eval'",
  `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}:`,
  ...CDN_SOURCES,
] as const
const STYLE_SOURCES = [
  "'unsafe-inline'",
  `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}:`,
  ...CDN_SOURCES,
] as const
const IMAGE_SOURCES = ['data:', 'blob:', ...CDN_SOURCES] as const

export const VISUALIZATION_CONTENT_SECURITY_POLICY = [
  `default-src 'none'`,
  `script-src ${SCRIPT_SOURCES.join(' ')}`,
  `script-src-elem ${SCRIPT_SOURCES.join(' ')}`,
  `style-src ${STYLE_SOURCES.join(' ')}`,
  `img-src ${IMAGE_SOURCES.join(' ')}`,
  `font-src ${CDN_SOURCES.join(' ')}`,
  `media-src data: blob: ${CDN_SOURCES.join(' ')}`,
  'connect-src blob: data:',
  `worker-src 'none'`,
  `child-src 'none'`,
  `frame-src 'none'`,
  `object-src 'none'`,
  `base-uri 'none'`,
  `form-action 'none'`,
].join('; ')

const HOST_RUNTIME = `<script>${hostRuntime}</script>`

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
  readonly sessionId: SessionId
  readonly sourcePath: string
}

const registeredFrames = new Map<string, RegisteredInlineVisualizationFrame>()

export function registerInlineVisualizationFrame(
  input: InlineVisualizationFrameRegisterInput,
): InlineVisualizationFrameRegisterResult {
  if (!FRAME_ID_PATTERN.test(input.frameId)) throw new Error('Invalid visualization frame id')
  if (!input.sessionId || String(input.sessionId).length > MAX_SESSION_ID_LENGTH) {
    throw new Error('Invalid visualization session id')
  }
  if (!input.sourcePath || input.sourcePath.length > MAX_SOURCE_PATH_LENGTH) {
    throw new Error('Invalid visualization source path')
  }
  registrationSequence += 1
  const frameHost = `${INLINE_VISUALIZATION_PROTOCOL.FRAME_HOST_PREFIX}${input.frameId}`
  const registrationId = `visualization-frame-registration-${String(registrationSequence)}`
  registeredFrames.set(frameHost, {
    registrationId,
    sessionId: SessionId(input.sessionId),
    sourcePath: input.sourcePath,
  })
  return {
    frameUrl: inlineVisualizationFrameUrl(input.frameId),
    registrationId,
  }
}

export function unregisterInlineVisualizationFrame(input: InlineVisualizationFrameUnregisterInput) {
  const frameHost = `${INLINE_VISUALIZATION_PROTOCOL.FRAME_HOST_PREFIX}${input.frameId}`
  if (registeredFrames.get(frameHost)?.registrationId === input.registrationId) {
    registeredFrames.delete(frameHost)
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
    FRAME_HOST_PATTERN.test(url.host) &&
    url.pathname === INLINE_VISUALIZATION_PROTOCOL.LUCIDE_PATH &&
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

function visualizationDocument(frameHost: string, contents: string, errorReason?: string) {
  const frameOrigin = `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}://${frameHost}`
  const lucideUrl = `${frameOrigin}${INLINE_VISUALIZATION_PROTOCOL.LUCIDE_PATH}`
  const baseStyleUrl = `${frameOrigin}${INLINE_VISUALIZATION_PROTOCOL.BASE_STYLE_PATH}`
  const errorRuntime = errorReason
    ? `<script>dispatchEvent(new CustomEvent('openwaggle:visualization-error',{detail:{reason:${JSON.stringify(errorReason)}}}))</script>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${baseStyleUrl}"><script src="${lucideUrl}"></script>${HOST_RUNTIME}</head><body>${contents}${errorRuntime}</body></html>`
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
        if (!isRegisteredAssetRequest(request.url)) return notFoundResponse()
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
            result.reason,
          ),
        )
      }
      return visualizationResponse(visualizationDocument(input.frameHost, result.contents))
    } catch {
      return notFoundResponse()
    }
  })
}
