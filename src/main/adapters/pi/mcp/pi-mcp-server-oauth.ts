import type { McpOAuthSettings, McpServerEntry } from '@earendil-works/pi-coding-agent'
import { resolveConfigValueOrThrow } from '@earendil-works/pi-coding-agent'
import { getOpenWaggleMcpCredentials } from './openwaggle-mcp-credentials'

/** The URL a server signs in for, when it uses OAuth (Pi's rule). */
export function mcpOAuthUrl(entry: McpServerEntry) {
  const { config } = entry
  if (!('url' in config) || config.auth) return undefined
  const hasAuthorization = Object.keys(config.headers ?? {}).some(
    (header) => header.toLowerCase() === 'authorization',
  )
  return hasAuthorization ? undefined : config.url
}

export function mcpOAuthSettings(entry: McpServerEntry): McpOAuthSettings {
  const oauth = 'url' in entry.config ? entry.config.oauth : undefined
  if (!oauth) return {}
  return {
    ...(oauth.clientId ? { clientId: oauth.clientId } : {}),
    ...(oauth.clientSecret
      ? {
          clientSecret: resolveConfigValueOrThrow(
            oauth.clientSecret,
            `MCP server "${entry.name}" oauth.clientSecret`,
          ),
        }
      : {}),
    ...(oauth.callbackPort ? { callbackPort: oauth.callbackPort } : {}),
    ...(oauth.callbackUrl ? { callbackUrl: oauth.callbackUrl } : {}),
    ...(oauth.scope ? { scope: oauth.scope } : {}),
    ...(oauth.clientName ? { clientName: oauth.clientName } : {}),
    ...(oauth.clientRegistration ? { clientRegistration: oauth.clientRegistration } : {}),
    ...(oauth.authServerMetadataUrl
      ? { authServerMetadataUrl: new URL(oauth.authServerMetadataUrl) }
      : {}),
  }
}

/** Whether OpenWaggle holds a sign-in for an OAuth server; read from the store only. */
export function mcpSignedIn(entry: McpServerEntry) {
  const url = mcpOAuthUrl(entry)
  return url ? getOpenWaggleMcpCredentials().tokens(entry.name, url) !== undefined : undefined
}
