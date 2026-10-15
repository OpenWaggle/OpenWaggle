import {
  MAX_MCP_APP_DECLARED_ORIGINS,
  MCP_APP_FRAME_PROTOCOL,
} from '@shared/constants/mcp-app-frame'
import type { McpAppCsp } from '@shared/types/mcp-app-frame'

/**
 * A declared origin as a CSP source: a scheme, a host (optionally `*.` for its subdomains), an
 * optional port (1-65535) and a path of URL characters (RFC 3986 unreserved, sub-delims except
 * `'`, `,`, and `;`, plus `:@/?%`). Anything else, such as a bare `*`, a keyword like
 * `'unsafe-eval'`, text that would end the directive, a fragment, a backslash, or a control or
 * non-ASCII character that a header could mangle, is dropped: the server chooses which origins
 * its App reaches, not how the frame's policy is built.
 */
const CSP_SOURCE =
  /^(?<scheme>https?|wss?):\/\/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::(?<port>\d{1,5}))?(?:\/[a-z0-9\-._~!$&()*+=:@/?%]*)?$/i
const MAX_PORT = 65_535
const WEBSOCKET_SCHEMES = new Set(['ws', 'wss'])

function isCspSource(value: string, allowWebSockets: boolean) {
  const match = CSP_SOURCE.exec(value)
  if (!match?.groups) return false
  const { scheme, port } = match.groups
  if (!allowWebSockets && WEBSOCKET_SCHEMES.has((scheme ?? '').toLowerCase())) return false
  return port === undefined || (Number(port) >= 1 && Number(port) <= MAX_PORT)
}

/**
 * The declared origins that are plain origins, without duplicates, in their order. WebSocket
 * origins are only connect sources: they serve no scripts, styles, frames, or documents.
 */
export function mcpAppCspSources(
  declared: readonly unknown[],
  options: { readonly allowWebSockets?: boolean } = {},
) {
  const sources = declared.flatMap((value) =>
    typeof value === 'string' ? [value.trim().replace(/\/$/, '')] : [],
  )
  const allowWebSockets = options.allowWebSockets === true
  return [...new Set(sources.filter((value) => isCspSource(value, allowWebSockets)))].slice(
    0,
    MAX_MCP_APP_DECLARED_ORIGINS,
  )
}

/** An App's declared origins, each list reduced to plain origins. */
export function sanitizedMcpAppCsp(csp: McpAppCsp): McpAppCsp {
  return {
    connectDomains: mcpAppCspSources(csp.connectDomains, { allowWebSockets: true }),
    resourceDomains: mcpAppCspSources(csp.resourceDomains),
    frameDomains: mcpAppCspSources(csp.frameDomains),
    baseUriDomains: mcpAppCspSources(csp.baseUriDomains),
  }
}

function sources(values: readonly string[], fallback: string) {
  return values.length > 0 ? values.join(' ') : fallback
}

/**
 * The Content-Security-Policy an App document is served with: inline scripts and styles, which
 * App documents need, plus exactly the origins its server declares (sanitized again here), and
 * nothing else from the network. No eval, workers, objects, or forms.
 */
export function mcpAppContentSecurityPolicy(declared: McpAppCsp) {
  const csp = sanitizedMcpAppCsp(declared)
  const resources = csp.resourceDomains.join(' ')
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${resources}`.trim(),
    `style-src 'unsafe-inline' ${resources}`.trim(),
    `img-src data: blob: ${resources}`.trim(),
    `font-src data: ${resources}`.trim(),
    `media-src data: blob: ${resources}`.trim(),
    `connect-src ${sources(csp.connectDomains, "'none'")}`,
    `frame-src ${sources(csp.frameDomains, "'none'")}`,
    "object-src 'none'",
    "worker-src 'none'",
    `base-uri ${sources(csp.baseUriDomains, "'none'")}`,
    "form-action 'none'",
  ].join('; ')
}

export function mcpAppFrameUrl(frameId: string) {
  return new URL(
    `${MCP_APP_FRAME_PROTOCOL.SCHEME}://${MCP_APP_FRAME_PROTOCOL.FRAME_HOST_PREFIX}${frameId}${MCP_APP_FRAME_PROTOCOL.DOCUMENT_PATH}`,
  ).toString()
}
