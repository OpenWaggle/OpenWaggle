import { homedir } from 'node:os'
import {
  createMcpAuthProvider,
  type McpServerEntry,
  McpSignInCancelledError,
  signInMcpServer,
} from '@earendil-works/pi-coding-agent'
import { McpClient } from '@earendil-works/pi-mcp'
import type { McpServerInspection } from '@shared/types/mcp-configuration'
import { Effect } from 'effect'
import type { McpTransportKind } from '../../../domain/mcp/config/mcp-server-config'
import { isMcpHostDraining } from '../../../mcp-host-draining'
import { mcpShellEnvironmentReady } from '../../../mcp-shell-environment'
import { McpConfigurationError } from '../../../ports/mcp-configuration-service'
import type {
  McpServerRuntimeServiceShape,
  McpServerScopeInput,
  McpSignInResult,
} from '../../../ports/mcp-server-runtime-service'
import {
  isSessionMcpEnabled,
  setSessionMcpEnabled,
  UnknownMcpSessionError,
} from '../../../store/session-mcp-switch'
import { deferredMcpSecret, resolveDeferredMcpSecrets } from '../../mcp/config/mcp-deferred-secrets'
import { loadMcpRuntimeConfig, mcpLeftOutServerNotice } from '../../mcp/config/mcp-runtime-config'
import {
  deferredMcpVaultSecret,
  resolveMcpVaultSecret,
} from '../../mcp/encrypted-mcp-secret-vault-service'
import { type McpConnectionPool, mcpServerIdentity } from '../../mcp/pool/mcp-connection-pool-api'
import { getPiAgentDir } from '../pi-provider-catalog'
import { hardenedMcpAuthProvider } from './mcp-hardened-auth-provider'
import { forgetKnownMcpServerState, recordMcpServerCheck } from './mcp-server-status-registry'
import { showSignInPage } from './mcp-sign-in-page'
import { getOpenWaggleMcpCredentials } from './openwaggle-mcp-credentials'
import { migrateOpenWaggleMcpSignInsOnce } from './openwaggle-mcp-migration'
import { mcpOAuthSettings, mcpOAuthUrl, mcpSignedIn } from './pi-mcp-server-oauth'
import { getMcpServerStatuses, type PiMcpServerRuntimeRoots } from './pi-mcp-server-status'
import { needsSignIn, toolViews } from './pi-mcp-server-tool-views'
import { openPiMcpUpstream } from './pi-mcp-upstream'

/** How long Settings waits for a server to connect and list its tools. */
const INSPECT_TIMEOUT_MS = 30_000
/** How long a Host-owned sign-in waits for the browser to come back. */
const SIGN_IN_TIMEOUT_MS = 300_000

function defaultMcpServerRuntimeRoots(): PiMcpServerRuntimeRoots {
  return { homeDir: homedir(), piAgentDir: getPiAgentDir() }
}

/**
 * How a lookup treats the server's vault secrets; none reads the keychain. `checked` (Check
 * connection): each must exist, and is read when the server connects. `unread` (sign-in and
 * sign-out, which send none of them): the vault is not read, so a missing secret does not stop them.
 */
type ServerSecrets = 'checked' | 'unread'

async function unreadMcpSecret(name: string) {
  return deferredMcpSecret(name)
}

/** The server, loaded alone. */
async function findServer(
  input: McpServerScopeInput,
  roots: PiMcpServerRuntimeRoots,
  secrets: ServerSecrets,
) {
  // Inspecting and signing in use the server's sign-in: an old one is migrated first, and a new
  // one is never written over by it.
  await Promise.all([
    mcpShellEnvironmentReady(),
    migrateOpenWaggleMcpSignInsOnce(input.projectPath),
  ])
  const scopeRoots = { ...roots, projectPath: input.projectPath }
  const config = await loadMcpRuntimeConfig({
    roots: scopeRoots,
    resolveSecret: secrets === 'checked' ? deferredMcpVaultSecret : unreadMcpSecret,
    serverAllowlist: [input.name],
  })
  const entry = config.loaded.servers.find((server) => server.name === input.name)
  const unavailable = config.unavailable.get(input.name)
  // Left out while a migration waits: say why, not that the server does not exist.
  const leftOut = entry ? undefined : mcpLeftOutServerNotice(scopeRoots, input.name)
  if (leftOut) throw new McpConfigurationError({ reason: 'validation', message: leftOut })
  if (!entry) {
    throw new McpConfigurationError({
      reason: unavailable ? 'validation' : 'not-found',
      message: unavailable ?? `No MCP server named "${input.name}" is configured.`,
    })
  }
  const transport = config.transports.get(entry.name) ?? ('url' in entry.config ? 'http' : 'stdio')
  return { entry, transport }
}

/**
 * Connects outside any Session, lists the tools, and disconnects, like `pi mcp list`. The result
 * becomes the server's last check, which Settings shows on open without connecting again.
 */
export async function inspectMcpServer(
  input: McpServerScopeInput,
  roots: PiMcpServerRuntimeRoots = defaultMcpServerRuntimeRoots(),
): Promise<McpServerInspection> {
  let found: Awaited<ReturnType<typeof findServer>>
  try {
    found = await findServer(input, roots, 'checked')
  } catch (error) {
    // A vault secret that cannot be read fails this server's check, not the whole list.
    if (!(error instanceof McpConfigurationError) || error.reason !== 'validation') throw error
    return { name: input.name, state: 'failed', tools: [], error: error.message }
  }
  const { entry, transport } = found
  const inspection = await connectAndList(entry, transport, input.projectPath ?? homedir())
  recordMcpServerCheck(mcpServerIdentity(entry.name, entry.config), inspection)
  return inspection
}

async function connectAndList(
  entry: McpServerEntry,
  transport: McpTransportKind,
  cwd: string,
): Promise<McpServerInspection> {
  const signedInState = mcpSignedIn(entry)
  const base = {
    name: entry.name,
    ...(signedInState === undefined ? {} : { signedIn: signedInState }),
  }
  if (entry.config.enabled === false) return { ...base, state: 'disabled', tools: [] }
  const url = mcpOAuthUrl(entry)
  const authProvider = url
    ? createMcpAuthProvider({
        serverUrl: url,
        store: getOpenWaggleMcpCredentials().forServer(entry.name, url),
        settings: () => mcpOAuthSettings(entry),
        onChallenge: () => {},
      })
    : undefined
  const client = new McpClient({
    name: 'openwaggle',
    version: '1',
    requestTimeoutMs: INSPECT_TIMEOUT_MS,
  })
  let upstream: ReturnType<typeof openPiMcpUpstream> | undefined
  try {
    // Inside the try: a `${NAME}` that does not resolve fails this server's check.
    upstream = openPiMcpUpstream({
      entry: {
        ...entry,
        config: await resolveDeferredMcpSecrets(entry.config, resolveMcpVaultSecret),
      },
      transport,
      cwd,
      authProvider: hardenedMcpAuthProvider(entry, authProvider),
      // A check launches `npx pkg@latest` as configured, so a new version is picked up.
      refreshPackage: true,
    })
    await client.connect(upstream.transport)
    const tools = client.serverCapabilities?.tools ? await client.listTools() : []
    return { ...base, state: 'connected', tools: toolViews(entry, tools) }
  } catch (error) {
    const stderrTail = upstream?.stderrTail?.()
    return {
      ...base,
      state: needsSignIn(error) ? 'needs-sign-in' : 'failed',
      tools: [],
      error: error instanceof Error ? error.message : String(error),
      ...(stderrTail ? { stderrTail } : {}),
    }
  } finally {
    await client.close().catch(() => undefined)
    await upstream?.close?.().catch(() => undefined)
    await authProvider?.settled()
  }
}

/**
 * Host-owned interactive sign-in, shared by Settings and the CLI. Runs Pi's own OAuth flow
 * against OpenWaggle's sign-in store and opens the authorization page in the browser. When the
 * page cannot be opened (non-disruptive automation), it gives up at once and returns the URL.
 */
async function signIn(
  pool: McpConnectionPool,
  input: McpServerScopeInput,
): Promise<McpSignInResult> {
  const { entry } = await findServer(input, defaultMcpServerRuntimeRoots(), 'unread')
  const url = mcpOAuthUrl(entry)
  if (!url) {
    throw new McpConfigurationError({
      reason: 'validation',
      message: `MCP server "${entry.name}" does not sign in with OAuth.`,
    })
  }
  const abort = new AbortController()
  let authorizationUrl: string | undefined
  let refused: Error | undefined
  const timeout = setTimeout(() => abort.abort(), SIGN_IN_TIMEOUT_MS)
  try {
    await signInMcpServer({
      serverUrl: url,
      store: getOpenWaggleMcpCredentials().forServer(entry.name, url),
      settings: mcpOAuthSettings(entry),
      prompt: {
        showAuthorizationUrl: (page) => {
          void showSignInPage(entry, page.href).then(
            (outcome) => {
              if (outcome.kind === 'opened') return
              if (outcome.kind === 'not-opened') authorizationUrl = outcome.href
              else refused = outcome.error
              abort.abort()
            },
            (error: unknown) => {
              refused = error instanceof Error ? error : new Error(String(error))
              abort.abort()
            },
          )
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
    if (refused) throw refused
    if (error instanceof McpSignInCancelledError) {
      return { signedIn: false, ...(authorizationUrl ? { authorizationUrl } : {}) }
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
  // Warm connections of this server pick the new sign-in up when they reconnect, and the last
  // check (probably "needs sign-in") no longer says anything true.
  const identity = mcpServerIdentity(entry.name, entry.config)
  await pool.closeServerIdentity(identity)
  forgetKnownMcpServerState(identity)
  return { signedIn: true }
}

async function signOut(pool: McpConnectionPool, input: McpServerScopeInput) {
  const { entry } = await findServer(input, defaultMcpServerRuntimeRoots(), 'unread')
  const url = mcpOAuthUrl(entry)
  if (url) getOpenWaggleMcpCredentials().remove(entry.name, url)
  const identity = mcpServerIdentity(entry.name, entry.config)
  await pool.closeServerIdentity(identity)
  forgetKnownMcpServerState(identity)
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

/** Settings' and the CLI's MCP server operations over the given connection pool. */
export function createPiMcpServerRuntimeService(
  pool: McpConnectionPool,
): McpServerRuntimeServiceShape {
  return {
    inspectServer: (input) => attempt(() => inspectMcpServer(input)),
    getServerStatuses: (input) =>
      attempt(async () => {
        // The states include whether a server is signed in: an old sign-in is moved first, so a
        // migrated server never shows as signed out on the first launch. Not while the Host
        // drains: the migration may wait on the keychain and would hold the drain open.
        if (!isMcpHostDraining()) await migrateOpenWaggleMcpSignInsOnce(input.projectPath)
        return getMcpServerStatuses(input, defaultMcpServerRuntimeRoots(), pool)
      }),
    signIn: (input) => attempt(() => signIn(pool, input)),
    signOut: (input) => attempt(() => signOut(pool, input)),
    getSessionMcpEnabled: (sessionId) => Effect.promise(() => isSessionMcpEnabled(sessionId)),
    setSessionMcpEnabled: (sessionId, enabled) =>
      attempt(async () => {
        await setSessionMcpEnabled(sessionId, enabled).catch((error: unknown) => {
          if (!(error instanceof UnknownMcpSessionError)) throw error
          throw new McpConfigurationError({ reason: 'not-found', message: error.message })
        })
        // A Session switched off keeps no servers running.
        if (!enabled) await pool.closeSession(sessionId)
      }),
  }
}
