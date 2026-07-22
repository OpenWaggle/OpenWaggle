import { is } from '@electron-toolkit/utils'
import {
  OPENWAGGLE_EXTENSION_FRAME_PROTOCOL,
  OPENWAGGLE_EXTENSION_FRAME_ROOT_ID,
} from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { isNetworkOrigin } from '@shared/schemas/extension-network-origin'
import type {
  ExtensionFrameRegisterInput,
  ExtensionFrameRegisterResult,
  ExtensionFrameUnregisterInput,
} from '@shared/types/extension-frame'
import { protocol } from 'electron'
import { env } from './env'
import extensionFrameCss from './extension-frame-assets/extension-frame.css.raw?raw'
import extensionFrameHtml from './extension-frame-assets/extension-frame.html?raw'

const HTTP_FOUND_STATUS = 302
const HTTP_NOT_FOUND_STATUS = 404
const DIRECTIVE_SEPARATOR = '; '
const VALUE_SEPARATOR = ' '
const TEXT_HTML_CONTENT_TYPE = 'text/html; charset=utf-8'
const TEXT_CSS_CONTENT_TYPE = 'text/css; charset=utf-8'
const FRAME_RESOURCE_PATH_SEGMENT_COUNT = 3
const INLINE_STYLE_SOURCE = "'unsafe-inline'"
const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '[::1]'])
const EXTENSION_RUNTIME_SCRIPT_SOURCE =
  `${OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.SCHEME}:` as const
const VITE_DEV_CONNECT_SOURCES = ['ws://localhost:*', 'ws://127.0.0.1:*'] as const
const RENDERER_PROTOCOL = 'openwaggle'
const RENDERER_PROTOCOL_HOST = 'app'

interface RegisteredExtensionFrame {
  readonly registrationId: string
  readonly bootstrapUrl: string
  readonly networkOrigins: readonly string[]
}

type ExtensionFrameResource = 'document' | 'style' | 'bootstrap'

const registeredFrames = new Map<string, RegisteredExtensionFrame>()
let extensionFrameProtocolRegistered = false
let registrationSequence = 0

function notFoundResponse() {
  return new Response(null, { status: HTTP_NOT_FOUND_STATUS })
}

function textResponse(content: string, contentType: string, headers?: HeadersInit) {
  return new Response(content, {
    headers: {
      ...headers,
      'content-type': contentType,
    },
  })
}

function redirectResponse(url: string) {
  return new Response(null, {
    status: HTTP_FOUND_STATUS,
    headers: {
      location: url,
    },
  })
}

function cspSourceForUrl(url: string) {
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
    return parsedUrl.origin
  }

  return parsedUrl.protocol
}

function devConnectSourcesForBootstrap(url: string): readonly string[] {
  const parsedUrl = new URL(url)
  if (
    (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') ||
    !LOCALHOST_NAMES.has(parsedUrl.hostname)
  ) {
    return []
  }

  return VITE_DEV_CONNECT_SOURCES
}

function frameContentSecurityPolicy(frame: RegisteredExtensionFrame) {
  const frameProtocolSource = `${OPENWAGGLE_EXTENSION_FRAME_PROTOCOL.SCHEME}:`
  const bootstrapSource = cspSourceForUrl(frame.bootstrapUrl)
  const connectSources = [
    ...frame.networkOrigins,
    ...devConnectSourcesForBootstrap(frame.bootstrapUrl),
  ]
  const scriptSources = [
    frameProtocolSource,
    bootstrapSource,
    EXTENSION_RUNTIME_SCRIPT_SOURCE,
  ] as const
  const directives: Array<readonly [string, readonly string[]]> = [
    ['default-src', ["'none'"]],
    ['script-src', scriptSources],
    ['script-src-elem', scriptSources],
    ['style-src', [frameProtocolSource, INLINE_STYLE_SOURCE]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'none'"]],
  ]

  if (connectSources.length > 0) {
    directives.push(['connect-src', connectSources])
  }

  return directives
    .map(([name, values]) => `${name} ${values.join(VALUE_SEPARATOR)}`)
    .join(DIRECTIVE_SEPARATOR)
}

function decodeFrameId(value: string) {
  try {
    const decoded = decodeURIComponent(value)
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

function parseFrameRequest(requestUrl: string) {
  const parsedUrl = new URL(requestUrl)
  const protocolConfig = OPENWAGGLE_EXTENSION_FRAME_PROTOCOL
  if (parsedUrl.host !== protocolConfig.HOST) {
    return null
  }

  const pathSegments = parsedUrl.pathname.split('/').filter((segment) => segment.length > 0)
  const prefixSegments = protocolConfig.FRAME_PATH_PREFIX.split('/').filter(
    (segment) => segment.length > 0,
  )
  const [prefixSegment] = prefixSegments
  const [actualPrefix, encodedFrameId, resourcePath] = pathSegments
  if (
    prefixSegments.length !== 1 ||
    actualPrefix !== prefixSegment ||
    encodedFrameId === undefined ||
    resourcePath === undefined ||
    pathSegments.length !== FRAME_RESOURCE_PATH_SEGMENT_COUNT
  ) {
    return null
  }

  const frameId = decodeFrameId(encodedFrameId)
  if (frameId === null) {
    return null
  }

  const resource = (() => {
    if (resourcePath === protocolConfig.DOCUMENT_PATH) return 'document'
    if (resourcePath === protocolConfig.STYLE_PATH) return 'style'
    if (resourcePath === protocolConfig.BOOTSTRAP_PATH) return 'bootstrap'
    return null
  })() satisfies ExtensionFrameResource | null

  return resource === null ? null : { frameId, resource }
}

function extensionFrameUrl(frameId: string) {
  const protocolConfig = OPENWAGGLE_EXTENSION_FRAME_PROTOCOL
  const encodedFrameId = encodeURIComponent(frameId)
  return `${protocolConfig.SCHEME}://${protocolConfig.HOST}${protocolConfig.FRAME_PATH_PREFIX}/${encodedFrameId}/${protocolConfig.DOCUMENT_PATH}`
}

function normalizedNetworkOrigins(origins: readonly string[] | undefined) {
  if (origins === undefined) {
    return []
  }

  const normalized: string[] = []
  const seenOrigins = new Set<string>()
  for (const origin of origins) {
    const validation = isNetworkOrigin(origin)
    if (validation !== true) {
      throw new Error(`Extension frame network origin "${origin}" is invalid: ${validation}`)
    }

    if (!seenOrigins.has(origin)) {
      seenOrigins.add(origin)
      normalized.push(origin)
    }
  }
  return normalized
}

function devRendererOrigin() {
  if (!is.dev || !env.ELECTRON_RENDERER_URL) {
    return null
  }

  return new URL(env.ELECTRON_RENDERER_URL).origin
}

function bootstrapUrlIsTrusted(bootstrapUrl: URL) {
  if (bootstrapUrl.username.length > 0 || bootstrapUrl.password.length > 0) {
    return false
  }

  if (
    bootstrapUrl.protocol === `${RENDERER_PROTOCOL}:` &&
    bootstrapUrl.host === RENDERER_PROTOCOL_HOST
  ) {
    return true
  }

  const rendererOrigin = devRendererOrigin()
  return (
    rendererOrigin !== null &&
    (bootstrapUrl.protocol === 'http:' || bootstrapUrl.protocol === 'https:') &&
    bootstrapUrl.origin === rendererOrigin
  )
}

function normalizeBootstrapUrl(value: string) {
  const bootstrapUrl = new URL(value)
  if (!bootstrapUrlIsTrusted(bootstrapUrl)) {
    throw new Error('Extension frame bootstrap URL must use the OpenWaggle renderer origin.')
  }

  return bootstrapUrl.toString()
}

function validateRegistration(input: ExtensionFrameRegisterInput) {
  if (input.frameId.trim().length === 0) {
    throw new Error('Extension frame id is required.')
  }

  return {
    frameId: input.frameId,
    bootstrapUrl: normalizeBootstrapUrl(input.bootstrapUrl),
    networkOrigins: normalizedNetworkOrigins(input.networkOrigins),
  }
}

function nextRegistrationId() {
  registrationSequence += 1
  return `frame-registration-${String(registrationSequence)}`
}

export function registerExtensionFrame(
  input: ExtensionFrameRegisterInput,
): ExtensionFrameRegisterResult {
  const registration = validateRegistration(input)
  const registrationId = nextRegistrationId()
  registeredFrames.set(registration.frameId, {
    registrationId,
    bootstrapUrl: registration.bootstrapUrl,
    networkOrigins: registration.networkOrigins,
  })

  return { frameUrl: extensionFrameUrl(registration.frameId), registrationId }
}

export function unregisterExtensionFrame(input: ExtensionFrameUnregisterInput): void {
  const registration = registeredFrames.get(input.frameId)
  if (registration?.registrationId !== input.registrationId) {
    return
  }

  registeredFrames.delete(input.frameId)
}

export function registerExtensionFrameProtocolOnce() {
  if (extensionFrameProtocolRegistered) {
    return
  }

  extensionFrameProtocolRegistered = true
  protocol.handle(OPENWAGGLE_EXTENSION_FRAME_PROTOCOL.SCHEME, (request) => {
    try {
      const parsedRequest = parseFrameRequest(request.url)
      if (parsedRequest === null) {
        return notFoundResponse()
      }

      const registeredFrame = registeredFrames.get(parsedRequest.frameId)
      if (registeredFrame === undefined) {
        return notFoundResponse()
      }

      if (parsedRequest.resource === 'document') {
        return textResponse(extensionFrameHtml, TEXT_HTML_CONTENT_TYPE, {
          'content-security-policy': frameContentSecurityPolicy(registeredFrame),
          'x-openwaggle-extension-root': OPENWAGGLE_EXTENSION_FRAME_ROOT_ID,
        })
      }

      if (parsedRequest.resource === 'style') {
        return textResponse(extensionFrameCss, TEXT_CSS_CONTENT_TYPE)
      }

      return redirectResponse(registeredFrame.bootstrapUrl)
    } catch {
      return notFoundResponse()
    }
  })
}
