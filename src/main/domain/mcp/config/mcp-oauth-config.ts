import {
  isJsonRecord,
  type JsonRecord,
  MCP_LOOPBACK_HOSTS,
  type McpOAuthConfig,
} from './mcp-server-config'

const MIN_PORT = 1
const MAX_PORT = 65_535

function isLoopbackRedirectUri(value: string) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (
    url.protocol === 'http:' &&
    MCP_LOOPBACK_HOSTS.includes(url.hostname) &&
    url.search === '' &&
    url.hash === ''
  )
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === 'string'
}

type OAuthRule = (value: JsonRecord) => string | undefined

function stringField(field: 'clientId' | 'clientSecret' | 'scope'): OAuthRule {
  return (value) => (optionalString(value[field]) ? undefined : `oauth.${field} must be a string`)
}

const callbackPortRule: OAuthRule = ({ callbackPort: port }) =>
  port === undefined ||
  (typeof port === 'number' && Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT)
    ? undefined
    : 'oauth.callbackPort must be a port number'

const callbackUrlRule: OAuthRule = ({ callbackUrl, callbackPort }) => {
  if (callbackUrl === undefined) return undefined
  if (typeof callbackUrl !== 'string' || !isLoopbackRedirectUri(callbackUrl)) {
    return 'oauth.callbackUrl must be an http URI on localhost, 127.0.0.1, or [::1] without query or fragment'
  }
  const urlPort = new URL(callbackUrl).port
  return urlPort && callbackPort !== undefined && Number(urlPort) !== callbackPort
    ? 'oauth.callbackUrl and oauth.callbackPort name different ports'
    : undefined
}

const clientNameRule: OAuthRule = ({ clientName }) =>
  clientName === undefined || (typeof clientName === 'string' && clientName.trim())
    ? undefined
    : 'oauth.clientName must be a non-empty string'

const clientRegistrationRule: OAuthRule = (value) => {
  const registration = value.clientRegistration
  if (registration === undefined || registration === 'dcr') return undefined
  if (registration !== 'cimd') return 'oauth.clientRegistration must be "dcr" or "cimd"'
  if (value.clientId !== undefined || value.clientName !== undefined) {
    return 'oauth.clientRegistration "cimd" cannot be combined with oauth.clientId or oauth.clientName'
  }
  const callback = typeof value.callbackUrl === 'string' ? new URL(value.callbackUrl) : undefined
  return callback && (callback.hostname === '[::1]' || callback.pathname !== '/callback')
    ? 'oauth.clientRegistration "cimd" requires oauth.callbackUrl on localhost or 127.0.0.1 with path /callback'
    : undefined
}

function isTrustedMetadataUrl(url: URL) {
  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && MCP_LOOPBACK_HOSTS.includes(url.hostname))
  )
}

const metadataUrlRule: OAuthRule = ({ authServerMetadataUrl }) => {
  if (authServerMetadataUrl === undefined) return undefined
  const url =
    typeof authServerMetadataUrl === 'string' && URL.canParse(authServerMetadataUrl)
      ? new URL(authServerMetadataUrl)
      : undefined
  return url && isTrustedMetadataUrl(url)
    ? undefined
    : 'oauth.authServerMetadataUrl must be an https URL, or http on localhost, 127.0.0.1, or [::1]'
}

/** Pi's checks, in Pi's order, so the first failure is the one Pi reports. */
const OAUTH_RULES: readonly OAuthRule[] = [
  stringField('clientId'),
  stringField('clientSecret'),
  callbackPortRule,
  callbackUrlRule,
  stringField('scope'),
  clientNameRule,
  clientRegistrationRule,
  metadataUrlRule,
]

function oauthConfig(value: JsonRecord): McpOAuthConfig {
  const config: McpOAuthConfig = {}
  if (typeof value.clientId === 'string') config.clientId = value.clientId
  if (typeof value.clientSecret === 'string') config.clientSecret = value.clientSecret
  if (typeof value.callbackPort === 'number') config.callbackPort = value.callbackPort
  if (typeof value.callbackUrl === 'string') config.callbackUrl = value.callbackUrl
  if (typeof value.scope === 'string') config.scope = value.scope
  if (typeof value.clientName === 'string') config.clientName = value.clientName
  if (value.clientRegistration === 'dcr' || value.clientRegistration === 'cimd') {
    config.clientRegistration = value.clientRegistration
  }
  if (typeof value.authServerMetadataUrl === 'string') {
    config.authServerMetadataUrl = value.authServerMetadataUrl
  }
  return config
}

export type McpOAuthValidation =
  | { readonly ok: true; readonly oauth: McpOAuthConfig | undefined }
  | { readonly ok: false; readonly error: string }

export function validateMcpOAuthConfig(name: string, value: unknown): McpOAuthValidation {
  if (value === undefined) return { ok: true, oauth: undefined }
  if (!isJsonRecord(value)) return { ok: false, error: `server "${name}": oauth must be an object` }
  for (const rule of OAUTH_RULES) {
    const error = rule(value)
    if (error) return { ok: false, error: `server "${name}": ${error}` }
  }
  return { ok: true, oauth: oauthConfig(value) }
}
