import { OPENWAGGLE_EXTENSION_FRAME_PROTOCOL } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { INLINE_VISUALIZATION_PROTOCOL } from '@shared/constants/inline-visualization'
import { MCP_APP_FRAME_PROTOCOL } from '@shared/constants/mcp-app-frame'
import { SESSION_RESOURCE_PROTOCOL } from '@shared/constants/session-resource-protocol'

const SECURITY_PREFERENCE_EXPECTATIONS = [
  { key: 'nodeIntegration', expected: false },
  { key: 'contextIsolation', expected: true },
  { key: 'sandbox', expected: true },
  { key: 'webSecurity', expected: true },
  { key: 'allowRunningInsecureContent', expected: false },
] as const

const DIRECTIVE_SEPARATOR = '; '
const VALUE_SEPARATOR = ' '
// Vite React injects a deterministic inline preamble script in dev.
// Allow only that exact script hash so dev boot works without enabling broad unsafe-inline.
const VITE_REACT_PREAMBLE_HASH = "'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='" as const
/**
 * The one inline script of src/renderer/index.html, which applies the cached interface scale
 * before the startup frame paints. A unit test recomputes it from the file, and
 * `bun run check:renderer-csp` from the page the build wrote.
 */
export const STARTUP_APPEARANCE_SCRIPT_HASH =
  "'sha256-AzeWj8P/bvRHuRLOMEOepvQ0Qa2MUlvQ93kUJ7hu9co='" as const
const STYLE_SRC_VALUES = ["'self'", "'unsafe-inline'"] as const

/**
 * The trusted origins the renderer's policy names, as CSP sources. Electron's are its custom
 * schemes; Electrobun's are the loopback origins of its trusted origin servers
 * (`TrustedOriginsShape.sourcesOf`), plus the loopback socket of its RPC in `connect`.
 */
export interface RendererPolicySources {
  readonly extensionRuntime: readonly string[]
  readonly sessionResource: readonly string[]
  readonly extensionFrame: readonly string[]
  readonly inlineVisualization: readonly string[]
  readonly mcpAppFrame: readonly string[]
  readonly connect: readonly string[]
}

const SCHEME_POLICY_SOURCES: RendererPolicySources = {
  extensionRuntime: [`${OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL.SCHEME}:`],
  sessionResource: [`${SESSION_RESOURCE_PROTOCOL.SCHEME}:`],
  extensionFrame: [`${OPENWAGGLE_EXTENSION_FRAME_PROTOCOL.SCHEME}:`],
  inlineVisualization: [`${INLINE_VISUALIZATION_PROTOCOL.SCHEME}:`],
  mcpAppFrame: [`${MCP_APP_FRAME_PROTOCOL.SCHEME}:`],
  connect: [],
}

const CONNECT_SRC_VALUES = [
  "'self'",
  'ws://localhost:*',
  'http://localhost:*',
  'https://localhost:*',
  'wss://localhost:*',
  'https://api.github.com',
] as const

function unique(values: readonly string[]) {
  return [...new Set(values)]
}

function cspDirectives(sources: RendererPolicySources) {
  const scriptSources = [
    "'self'",
    VITE_REACT_PREAMBLE_HASH,
    STARTUP_APPEARANCE_SCRIPT_HASH,
    ...sources.extensionRuntime,
  ]
  return [
    ['default-src', ["'self'"]],
    ['script-src', scriptSources],
    ['script-src-elem', scriptSources],
    ['style-src', STYLE_SRC_VALUES],
    ['img-src', ["'self'", 'data:', 'blob:', ...sources.sessionResource]],
    [
      'frame-src',
      unique([
        "'self'",
        'blob:',
        ...sources.extensionFrame,
        ...sources.inlineVisualization,
        ...sources.mcpAppFrame,
      ]),
    ],
    ['connect-src', [...CONNECT_SRC_VALUES, ...sources.connect]],
  ] as const
}

type CspResponseHeaders = Record<string, string[] | string>

/** The security-relevant web preferences every app page must run with (ADR 0064). */
interface SecurityWebPreferences {
  readonly nodeIntegration?: boolean
  readonly contextIsolation?: boolean
  readonly sandbox?: boolean
  readonly webSecurity?: boolean
  readonly allowRunningInsecureContent?: boolean
}

export const SECURE_WEB_PREFERENCES: Required<SecurityWebPreferences> = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
}

interface HeadersReceivedDetails {
  readonly url: string
  readonly responseHeaders?: CspResponseHeaders
}

/** A web profile that lets main rewrite response headers (Electron's `session.webRequest`). */
interface SessionWithHeadersHandler {
  readonly webRequest: {
    onHeadersReceived(
      listener: (
        details: HeadersReceivedDetails,
        callback: (response: { responseHeaders?: CspResponseHeaders }) => void,
      ) => void,
    ): void
  }
}

const sessionCspInstallState = new WeakSet<SessionWithHeadersHandler>()

/** The renderer's Content Security Policy; Electron's custom-scheme sources unless given. */
export function buildContentSecurityPolicy(sources: RendererPolicySources = SCHEME_POLICY_SOURCES) {
  return cspDirectives(sources)
    .map(([name, values]) => `${name} ${values.join(VALUE_SEPARATOR)}`)
    .join(DIRECTIVE_SEPARATOR)
}

export const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy()

export function applyContentSecurityPolicyHeader(responseHeaders: CspResponseHeaders | undefined) {
  return {
    ...responseHeaders,
    'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
  } satisfies CspResponseHeaders
}

function hasProtocolManagedContentSecurityPolicy(url: string) {
  try {
    const requestProtocol = new URL(url).protocol
    return (
      requestProtocol === `${OPENWAGGLE_EXTENSION_FRAME_PROTOCOL.SCHEME}:` ||
      requestProtocol === `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}:` ||
      requestProtocol === `${MCP_APP_FRAME_PROTOCOL.SCHEME}:`
    )
  } catch {
    return false
  }
}

export function isInlineVisualizationUrl(url: string | undefined) {
  if (!url) return false
  try {
    return new URL(url).protocol === `${INLINE_VISUALIZATION_PROTOCOL.SCHEME}:`
  } catch {
    return false
  }
}

export function shouldBlockInlineVisualizationFrameNavigation(input: {
  readonly isMainFrame: boolean
  readonly destinationUrl?: string
  readonly frameUrl?: string
  readonly frameIsVisualization?: boolean
  readonly initiatorUrl?: string
}) {
  const currentVisualizationIsLeaving =
    isInlineVisualizationUrl(input.frameUrl) && input.frameUrl !== input.destinationUrl
  return (
    !input.isMainFrame &&
    (input.frameIsVisualization === true ||
      currentVisualizationIsLeaving ||
      isInlineVisualizationUrl(input.initiatorUrl))
  )
}

export function isMcpAppFrameUrl(url: string | undefined) {
  if (!url) return false
  try {
    return new URL(url).protocol === `${MCP_APP_FRAME_PROTOCOL.SCHEME}:`
  } catch {
    return false
  }
}

/**
 * An MCP App frame stays on the document the Host served it (ADR 0053): navigating it elsewhere
 * would replace the App, and the policy built for it, with any page. Same-document navigations
 * (hash, history) are the App's own. Frames an App opens itself are its `frameDomains`, which its
 * policy already limits, so they are not blocked here.
 */
export function shouldBlockMcpAppFrameNavigation(input: {
  readonly isMainFrame: boolean
  readonly isSameDocument: boolean
  readonly destinationUrl?: string
  readonly frameUrl?: string
  readonly frameIsMcpApp?: boolean
}) {
  if (input.isMainFrame || input.isSameDocument) return false
  const isApp = input.frameIsMcpApp === true || isMcpAppFrameUrl(input.frameUrl)
  return isApp && input.destinationUrl !== input.frameUrl
}

export function shouldBlockInlineVisualizationDocumentRequest(input: {
  readonly resourceType: string
  readonly requestUrl: string
  readonly frameUrl?: string
}) {
  return (
    input.resourceType === 'subFrame' &&
    isInlineVisualizationUrl(input.frameUrl) &&
    input.requestUrl !== input.frameUrl
  )
}

export function assertSecureWebPreferences(preferences: SecurityWebPreferences) {
  for (const expectation of SECURITY_PREFERENCE_EXPECTATIONS) {
    const actualValue = preferences[expectation.key]
    if (actualValue !== expectation.expected) {
      throw new Error(
        `Insecure BrowserWindow webPreferences: "${expectation.key}" must be ${String(expectation.expected)}, received ${String(actualValue)}.`,
      )
    }
  }
}

export function installCspHeaders(session: SessionWithHeadersHandler) {
  if (sessionCspInstallState.has(session)) {
    return
  }

  session.webRequest.onHeadersReceived((details, callback) => {
    if (hasProtocolManagedContentSecurityPolicy(details.url)) {
      const { responseHeaders } = details
      callback(responseHeaders === undefined ? {} : { responseHeaders })
      return
    }

    callback({
      responseHeaders: applyContentSecurityPolicyHeader(details.responseHeaders),
    })
  })
  sessionCspInstallState.add(session)
}
