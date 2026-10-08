/**
 * The one check every MCP sign-in page passes before OpenWaggle opens it in the browser.
 *
 * pi-mcp only refuses `javascript:`, `data:`, and `vbscript:` authorization URLs, so a malicious
 * server or authorization server could otherwise make OpenWaggle open `file:`, `smb:`, `ms-msdt:`,
 * or any custom scheme with the operating system's handler. A page is opened only when it is
 * `https:` (or `http:` on loopback), carries no credentials, and its host is the MCP server's,
 * the authorization server Pi discovered for it, that server's authorization endpoint, or the
 * authorization server metadata host the user configured.
 */
import {
  assertSecureMcpProtocol,
  isAllowedMcpHostname,
  normalizeMcpAllowedHosts,
} from '../runtime/mcp-network-hosts'

export interface McpAuthorizationOrigin {
  readonly serverUrl: string
  /** The user's `oauth.authServerMetadataUrl`, which Pi trusts as configured. */
  readonly authServerMetadataUrl?: string | undefined
  /** What Pi's sign-in discovered and saved before it asked to open the page. */
  readonly discovery?:
    | {
        readonly authorizationServerUrl?: string | undefined
        readonly authorizationServerMetadata?:
          | {
              readonly issuer?: string | undefined
              readonly authorization_endpoint?: string | undefined
              readonly token_endpoint?: string | undefined
              readonly registration_endpoint?: string | undefined
            }
          | undefined
      }
    | undefined
}

function allowedHosts(origin: McpAuthorizationOrigin) {
  const metadata = origin.discovery?.authorizationServerMetadata
  return normalizeMcpAllowedHosts(
    [
      origin.serverUrl,
      origin.authServerMetadataUrl,
      origin.discovery?.authorizationServerUrl,
      metadata?.issuer,
      metadata?.authorization_endpoint,
    ]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => (URL.canParse(value) ? new URL(value).origin : value)),
  )
}

/** The authorization page to open, or an error saying why it must not be opened. */
export function checkMcpAuthorizationUrl(href: string, origin: McpAuthorizationOrigin): URL {
  if (!URL.canParse(href)) throw new Error('The MCP sign-in page is not a valid URL.')
  const url = new URL(href)
  if (url.username || url.password) {
    throw new Error('MCP sign-in pages cannot contain credentials.')
  }
  assertSecureMcpProtocol(url, false)
  if (!isAllowedMcpHostname(allowedHosts(origin), url.hostname)) {
    throw new Error(
      `The MCP sign-in page is on ${url.hostname}, which is neither the server nor its authorization server.`,
    )
  }
  return url
}
