import { homedir } from 'node:os'
import {
  createMcpAuthProvider,
  getMcpToolExposure,
  type McpOAuthSettings,
  type McpServerEntry,
  McpSignInCancelledError,
  resolveConfigValueOrThrow,
  signInMcpServer,
} from '@earendil-works/pi-coding-agent'
import { McpClient } from '@earendil-works/pi-mcp'
import type { McpServerInspection, McpServerToolView } from '@shared/types/mcp-configuration'
import { Effect, Layer } from 'effect'
import { openExternal } from '../../../desktop-ui'
import { McpConfigurationError } from '../../../ports/mcp-configuration-service'
import {
  McpServerRuntimeService,
  type McpServerScopeInput,
  type McpSignInResult,
} from '../../../ports/mcp-server-runtime-service'
import { loadMcpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'
import { resolveMcpVaultSecret } from '../../mcp/encrypted-mcp-secret-vault-service'
import { isSessionMcpEnabled, setSessionMcpEnabled } from '../../mcp/mcp-session-switch'
import { mcpSessionConnectionPool } from '../../mcp/pool/mcp-connection-pool-instance'
import { getPiAgentDir } from '../pi-provider-catalog'
import { getOpenWaggleMcpCredentials } from './openwaggle-mcp-credentials'
import { openPiMcpUpstream } from './pi-mcp-upstream'

/** How long Settings waits for a server to connect and list its tools. */
const INSPECT_TIMEOUT_MS = 30_000
/** How long a Host-owned sign-in waits for the browser to come back. */
const SIGN_IN_TIMEOUT_MS = 300_000

export interface PiMcpServerRuntimeRoots {
  readonly homeDir: string
  readonly piAgentDir: string
}

function defaultRoots(): PiMcpServerRuntimeRoots {
  return { homeDir: homedir(), piAgentDir: getPiAgentDir() }
}

async function findServer(input: McpServerScopeInput, roots: PiMcpServerRuntimeRoots) {
  const config = await loadMcpRuntimeConfig({
    roots: { ...roots, projectPath: input.projectPath },
    resolveSecret: resolveMcpVaultSecret,
  })
  const entry = config.loaded.servers.find((server) => server.name === input.name)
  if (!entry) {
    throw new McpConfigurationError({
      reason: 'not-found',
      message: `No MCP server named "${input.name}" is configured.`,
    })
  }
  const transport = config.transports.get(entry.name) ?? ('url' in entry.config ? 'http' : 'stdio')
  return { entry, transport }
}

/** The URL a server signs in for, when it uses OAuth (Pi's rule). */
function oauthUrl(entry: McpServerEntry) {
  const { config } = entry
  if (!('url' in config) || config.auth) return undefined
  const hasAuthorization = Object.keys(config.headers ?? {}).some(
    (header) => header.toLowerCase() === 'authorization',
  )
  return hasAuthorization ? undefined : config.url
}

function oauthSettings(entry: McpServerEntry): McpOAuthSettings {
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

function signedIn(entry: McpServerEntry) {
  const url = oauthUrl(entry)
  return url ? getOpenWaggleMcpCredentials().tokens(entry.name, url) !== undefined : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function needsSignIn(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'McpAuthRequiredError' || error.name === 'McpOAuthAuthorizationRequiredError')
  )
}

function toolViews(
  entry: McpServerEntry,
  tools: Awaited<ReturnType<McpClient['listTools']>>,
): McpServerToolView[] {
  return tools.map((tool) => {
    const ui = tool._meta?.ui
    const resourceUri = isRecord(ui) ? ui.resourceUri : undefined
    return {
      name: tool.name,
      ...(tool.title ? { title: tool.title } : {}),
      ...(tool.description ? { description: tool.description } : {}),
      exposure: getMcpToolExposure(entry.config, tool.name),
      hasApp: typeof resourceUri === 'string' && resourceUri.startsWith('ui://'),
    }
  })
}

/** Connects outside any Session, lists the tools, and disconnects, like `pi mcp list`. */
export async function inspectMcpServer(
  input: McpServerScopeInput,
  roots: PiMcpServerRuntimeRoots = defaultRoots(),
): Promise<McpServerInspection> {
  const { entry, transport } = await findServer(input, roots)
  const signedInState = signedIn(entry)
  const base = {
    name: entry.name,
    ...(signedInState === undefined ? {} : { signedIn: signedInState }),
  }
  if (entry.config.enabled === false) return { ...base, state: 'disabled', tools: [] }
  const url = oauthUrl(entry)
  const authProvider = url
    ? createMcpAuthProvider({
        serverUrl: url,
        store: getOpenWaggleMcpCredentials().forServer(entry.name, url),
        settings: () => oauthSettings(entry),
        onChallenge: () => {},
      })
    : undefined
  const upstream = openPiMcpUpstream({
    entry,
    transport,
    cwd: input.projectPath ?? homedir(),
    authProvider,
  })
  const client = new McpClient({
    name: 'openwaggle',
    version: '1',
    requestTimeoutMs: INSPECT_TIMEOUT_MS,
  })
  try {
    await client.connect(upstream.transport)
    const tools = client.serverCapabilities?.tools ? await client.listTools() : []
    return { ...base, state: 'connected', tools: toolViews(entry, tools) }
  } catch (error) {
    const stderrTail = upstream.stderrTail?.()
    return {
      ...base,
      state: needsSignIn(error) ? 'needs-sign-in' : 'failed',
      tools: [],
      error: error instanceof Error ? error.message : String(error),
      ...(stderrTail ? { stderrTail } : {}),
    }
  } finally {
    await client.close().catch(() => undefined)
    await authProvider?.settled()
  }
}

/**
 * Host-owned interactive sign-in, shared by Settings and the CLI. Runs Pi's own OAuth flow
 * against OpenWaggle's sign-in store and opens the authorization page in the browser. When the
 * page cannot be opened (non-disruptive automation), it gives up at once and returns the URL.
 */
async function signIn(input: McpServerScopeInput): Promise<McpSignInResult> {
  const { entry } = await findServer(input, defaultRoots())
  const url = oauthUrl(entry)
  if (!url) {
    throw new McpConfigurationError({
      reason: 'validation',
      message: `MCP server "${entry.name}" does not sign in with OAuth.`,
    })
  }
  const abort = new AbortController()
  let authorizationUrl: string | undefined
  let openFailed = false
  const timeout = setTimeout(() => abort.abort(), SIGN_IN_TIMEOUT_MS)
  try {
    await signInMcpServer({
      serverUrl: url,
      store: getOpenWaggleMcpCredentials().forServer(entry.name, url),
      settings: oauthSettings(entry),
      prompt: {
        showAuthorizationUrl: (page) => {
          authorizationUrl = page.href
          void openExternal(page.href).catch(() => {
            openFailed = true
            abort.abort()
          })
        },
        // There is no paste box; the flow ends when the browser returns or the wait is aborted.
        promptForRedirectUrl: (signal) =>
          new Promise<string | undefined>((resolve) => {
            const finish = () => resolve(undefined)
            signal.addEventListener('abort', finish, { once: true })
            abort.signal.addEventListener('abort', finish, { once: true })
          }),
      },
    })
  } catch (error) {
    if (error instanceof McpSignInCancelledError) {
      return { signedIn: false, ...(openFailed && authorizationUrl ? { authorizationUrl } : {}) }
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
  // Warm connections of this server pick the new sign-in up when they reconnect.
  await mcpSessionConnectionPool.closeServer(entry.name)
  return { signedIn: true }
}

async function signOut(input: McpServerScopeInput) {
  const { entry } = await findServer(input, defaultRoots())
  const url = oauthUrl(entry)
  if (url) getOpenWaggleMcpCredentials().remove(entry.name, url)
  await mcpSessionConnectionPool.closeServer(entry.name)
}

function toConfigurationError(error: unknown) {
  return error instanceof McpConfigurationError
    ? error
    : new McpConfigurationError({
        reason: 'io',
        message: error instanceof Error ? error.message : String(error),
      })
}

function attempt<A>(operation: () => Promise<A>) {
  return Effect.tryPromise({ try: operation, catch: toConfigurationError })
}

export const PiMcpServerRuntimeServiceLive = Layer.succeed(McpServerRuntimeService, {
  inspectServer: (input) => attempt(() => inspectMcpServer(input)),
  signIn: (input) => attempt(() => signIn(input)),
  signOut: (input) => attempt(() => signOut(input)),
  getSessionMcpEnabled: (sessionId) => Effect.sync(() => isSessionMcpEnabled(sessionId)),
  setSessionMcpEnabled: (sessionId, enabled) =>
    Effect.promise(async () => {
      setSessionMcpEnabled(sessionId, enabled)
      // A Session switched off keeps no servers running.
      if (!enabled) await mcpSessionConnectionPool.closeSession(sessionId)
    }),
})
