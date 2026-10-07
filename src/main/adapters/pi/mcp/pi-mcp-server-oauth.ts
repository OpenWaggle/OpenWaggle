import type { McpOAuthSettings, McpServerEntry } from '@earendil-works/pi-coding-agent'
import { resolveConfigValueOrThrow } from '@earendil-works/pi-coding-agent'
import { piLiteral } from '../../../domain/mcp/config/mcp-pi-literal'
import { mcpValueEnvironment } from '../../../mcp-shell-environment'
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
            mcpValueEnvironment(),
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

/**
 * Pi resolves `oauth.clientSecret` itself during a Run, against the app's environment only. A
 * secret that names a variable (`${NAME}`) is resolved here against the login shell's environment
 * too, and handed to Pi as a literal; `!command` values and unresolvable names are left to Pi.
 */
export function withShellResolvedClientSecrets<
  T extends { readonly servers: readonly McpServerEntry[] },
>(loaded: T): T {
  const environment = mcpValueEnvironment()
  const servers = loaded.servers.map((entry) => {
    const oauth = 'url' in entry.config ? entry.config.oauth : undefined
    const secret = oauth?.clientSecret
    if (!oauth || !secret || secret.startsWith('!') || !secret.includes('$')) return entry
    try {
      const value = resolveConfigValueOrThrow(secret, 'oauth.clientSecret', environment)
      return {
        ...entry,
        config: { ...entry.config, oauth: { ...oauth, clientSecret: piLiteral(value) } },
      }
    } catch {
      return entry
    }
  })
  return { ...loaded, servers }
}
