import { randomUUID } from 'node:crypto'
import { MAX_MCP_APP_DOCUMENT_BYTES, MCP_APP_FRAME_PROTOCOL } from '@shared/constants/mcp-app-frame'
import type {
  McpAppFrameRegisterInput,
  McpAppFrameRegisterResult,
  McpAppFrameUnregisterInput,
} from '@shared/types/mcp-app-frame'
import { mcpAppContentSecurityPolicy, mcpAppFrameUrl } from '@shared/utils/mcp-app-csp'
import { protocol } from 'electron'

const TEXT_HTML_CONTENT_TYPE = 'text/html; charset=utf-8'
const HTTP_NOT_FOUND_STATUS = 404
const FRAME_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const PERMISSIONS_POLICY = [
  'accelerometer',
  'ambient-light-sensor',
  'bluetooth',
  'camera',
  'clipboard-read',
  'clipboard-write',
  'display-capture',
  'geolocation',
  'gyroscope',
  'hid',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'usb',
  'xr-spatial-tracking',
]
  .map((feature) => `${feature}=()`)
  .join(', ')

interface RegisteredMcpAppFrame {
  readonly registrationId: string
  readonly ownerId: number
  readonly html: string
  readonly policy: string
}

/** App documents by frame host. Each is served only to frames of the renderer that registered. */
const registeredFrames = new Map<string, RegisteredMcpAppFrame>()
let protocolRegistered = false

function frameHost(frameId: string) {
  return `${MCP_APP_FRAME_PROTOCOL.FRAME_HOST_PREFIX}${frameId}`
}

/**
 * Serves `input.html` at its own `openwaggle-mcp-app://frame-<id>/document`, with a policy built
 * here from the origins the App declares (sanitized again: the policy is the Host's, not the
 * renderer's). A `srcdoc` frame would inherit the page's own CSP and load nothing from the
 * network (ADR 0053).
 */
export function registerMcpAppFrame(
  input: McpAppFrameRegisterInput,
  ownerId: number,
): McpAppFrameRegisterResult {
  if (!FRAME_ID_PATTERN.test(input.frameId)) throw new Error('Invalid MCP App frame id')
  if (Buffer.byteLength(input.html, 'utf8') > MAX_MCP_APP_DOCUMENT_BYTES) {
    throw new Error('MCP App document is too large')
  }
  const host = frameHost(input.frameId)
  if (registeredFrames.has(host)) throw new Error('MCP App frame id is already registered')
  const registrationId = randomUUID()
  registeredFrames.set(host, {
    registrationId,
    ownerId,
    html: input.html,
    policy: mcpAppContentSecurityPolicy(input.csp),
  })
  return { frameUrl: mcpAppFrameUrl(input.frameId), registrationId }
}

function frameOrigin(host: string) {
  return `${MCP_APP_FRAME_PROTOCOL.SCHEME}://${host}`
}

/** Stops serving a frame's document; returns its origin, whose storage the caller clears. */
export function unregisterMcpAppFrame(input: McpAppFrameUnregisterInput, ownerId: number) {
  const host = frameHost(input.frameId)
  const registration = registeredFrames.get(host)
  if (registration?.registrationId !== input.registrationId || registration.ownerId !== ownerId) {
    return []
  }
  registeredFrames.delete(host)
  return [frameOrigin(host)]
}

/** Drops every document of a renderer that went away; returns their origins. */
export function unregisterMcpAppFramesForOwner(ownerId: number) {
  const origins: string[] = []
  for (const [host, registration] of registeredFrames) {
    if (registration.ownerId !== ownerId) continue
    registeredFrames.delete(host)
    origins.push(frameOrigin(host))
  }
  return origins
}

function registeredDocument(requestUrl: string) {
  const url = new URL(requestUrl)
  if (
    url.protocol !== `${MCP_APP_FRAME_PROTOCOL.SCHEME}:` ||
    url.pathname !== MCP_APP_FRAME_PROTOCOL.DOCUMENT_PATH ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return undefined
  }
  return registeredFrames.get(url.host)
}

/** The response for an App frame's document; anything else under the scheme is not found. */
export function mcpAppFrameResponse(requestUrl: string) {
  const registration = (() => {
    try {
      return registeredDocument(requestUrl)
    } catch {
      return undefined
    }
  })()
  if (!registration) return new Response(null, { status: HTTP_NOT_FOUND_STATUS })
  return new Response(registration.html, {
    headers: {
      'content-type': TEXT_HTML_CONTENT_TYPE,
      'content-security-policy': registration.policy,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'permissions-policy': PERMISSIONS_POLICY,
      'cache-control': 'no-store',
    },
  })
}

export function registerMcpAppFrameProtocolOnce() {
  if (protocolRegistered) return
  protocolRegistered = true
  protocol.handle(MCP_APP_FRAME_PROTOCOL.SCHEME, (request) => mcpAppFrameResponse(request.url))
}
