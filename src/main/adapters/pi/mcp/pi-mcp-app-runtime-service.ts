import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMcpAuthProvider } from '@earendil-works/pi-coding-agent'
import { safeDecodeUnknown } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type { McpJsonValue } from '@shared/types/mcp'
import { isRecord } from '@shared/utils/validation'
import { Effect } from 'effect'
import { mcpShellEnvironmentReady } from '../../../mcp-shell-environment'
import type {
  McpAppRuntimeServiceShape,
  McpAppServerInput,
} from '../../../ports/mcp-app-runtime-service'
import { readSessionMcpServerAllowlist } from '../../../store/session-details/session-mcp-server-allowlist'
import { isSessionMcpEnabled } from '../../../store/session-mcp-switch'
import { loadMcpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'
import { resolveMcpVaultSecret } from '../../mcp/encrypted-mcp-secret-vault-service'
import {
  type McpConnectionPool,
  mcpConnectionFingerprint,
  mcpServerIdentity,
} from '../../mcp/pool/mcp-connection-pool-api'
import { getPiAgentDir } from '../pi-provider-catalog'
import { mcpAppTool } from './mcp-app-registry'
import { hardenedMcpAuthProvider } from './mcp-hardened-auth-provider'
import { getOpenWaggleMcpCredentials } from './openwaggle-mcp-credentials'
import { migrateOpenWaggleMcpFilesOnce } from './openwaggle-mcp-migration'
import { mcpOAuthSettings, mcpOAuthUrl } from './pi-mcp-server-oauth'
import { openPiMcpUpstream } from './pi-mcp-upstream'

/** How long an App's request may take, like Pi's own MCP request timeout. */
export const MCP_APP_REQUEST_TIMEOUT_MS = 60_000

/** JSON-RPC "method not found": a server without resources or prompts. */
const METHOD_NOT_FOUND = -32601

/**
 * The Session's connection to the App's server, opened with its current configuration if closed.
 * A cold connection is made exactly like a Run's (the Session's working path for `cwd` and roots,
 * Pi's OAuth settings, the server identity), so the Run that comes next reuses it.
 */
/** What a Run of the Session may use: its MCP switch and its Agent definition's server list. */
async function assertSessionMayUse(input: McpAppServerInput) {
  if (!(await isSessionMcpEnabled(input.sessionId))) {
    throw new Error('MCP is turned off for this Session.')
  }
  const allowlist = await readSessionMcpServerAllowlist(input.sessionId)
  if (allowlist && !allowlist.includes(input.serverName)) {
    throw new Error(
      `This Session's Agent definition does not use the MCP server "${input.serverName}".`,
    )
  }
}

async function appConnection(pool: McpConnectionPool, input: McpAppServerInput) {
  await assertSessionMayUse(input)
  const warm = pool.connection(input.sessionId, input.serverName)
  await Promise.all([mcpShellEnvironmentReady(), migrateOpenWaggleMcpFilesOnce(input.projectPath)])
  const config = await loadMcpRuntimeConfig({
    roots: { homeDir: homedir(), piAgentDir: getPiAgentDir(), projectPath: input.projectPath },
    resolveSecret: resolveMcpVaultSecret,
  })
  const entry = config.loaded.servers.find((server) => server.name === input.serverName)
  const identity = entry ? mcpServerIdentity(entry.name, entry.config) : undefined
  if (!entry || identity !== input.serverIdentity) {
    throw new Error(
      `The MCP server "${input.serverName}" this App belongs to was changed or removed.`,
    )
  }
  if (warm) return warm
  if (entry.config.enabled === false) {
    throw new Error(`The MCP server "${input.serverName}" is turned off.`)
  }
  const transport = config.transports.get(entry.name) ?? ('url' in entry.config ? 'http' : 'stdio')
  const cwd = input.workingPath ?? input.projectPath ?? homedir()
  const url = mcpOAuthUrl(entry)
  const authProvider = hardenedMcpAuthProvider(
    entry,
    url
      ? createMcpAuthProvider({
          serverUrl: url,
          store: getOpenWaggleMcpCredentials().forServer(entry.name, url),
          settings: () => mcpOAuthSettings(entry),
          onChallenge: () => {},
        })
      : undefined,
  )
  return pool.connectionFor(input.sessionId, {
    name: entry.name,
    fingerprint: mcpConnectionFingerprint({ config: entry.config, transport, cwd }),
    identity,
    open: () => openPiMcpUpstream({ entry, transport, cwd, authProvider }),
    roots: () => [{ uri: pathToFileURL(cwd).href, name: path.basename(cwd) }],
  })
}

/** One request of an App over the Session's connection, bounded in time. */
async function appRequest(
  pool: McpConnectionPool,
  input: McpAppServerInput,
  method: string,
  params: unknown,
) {
  const connection = await appConnection(pool, input)
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), MCP_APP_REQUEST_TIMEOUT_MS)
  try {
    return await connection.request(method, params, { signal: abort.signal })
  } catch (error) {
    if (abort.signal.aborted) {
      throw new Error(`The MCP server "${input.serverName}" did not answer ${method} in time.`, {
        cause: error,
      })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function json(value: unknown): McpJsonValue {
  const decoded = safeDecodeUnknown(mcpConfigValueSchema, value ?? null)
  if (!decoded.success) throw new Error('The MCP server returned a result OpenWaggle cannot read.')
  return decoded.data
}

async function readResource(
  pool: McpConnectionPool,
  input: McpAppServerInput & { readonly uri: string },
) {
  if (!input.uri.startsWith('ui://')) throw new Error('MCP Apps may only read ui:// resources.')
  const result = await appRequest(pool, input, 'resources/read', { uri: input.uri })
  return json(isRecord(result) ? result.contents : [])
}

/** A list the server may not offer at all; a server without the method lists nothing. */
async function optionalList(
  pool: McpConnectionPool,
  input: McpAppServerInput,
  method: string,
  key: string,
) {
  try {
    const result = await appRequest(pool, input, method, {})
    return json(isRecord(result) ? (result[key] ?? []) : [])
  } catch (error) {
    if (isRecord(error) && error.code === METHOD_NOT_FOUND) return json([])
    throw error
  }
}

async function listCatalog(pool: McpConnectionPool, input: McpAppServerInput) {
  const resources = await optionalList(pool, input, 'resources/list', 'resources')
  const prompts = await optionalList(pool, input, 'prompts/list', 'prompts')
  return { resources, prompts }
}

async function callTool(
  pool: McpConnectionPool,

  input: McpAppServerInput & {
    readonly toolName: string
    readonly arguments: Readonly<Record<string, McpJsonValue>>
  },
) {
  // An App may call only tools its server advertised in this Session.
  if (!mcpAppTool(input.sessionId, input.serverName, input.toolName)) {
    const listed = await appRequest(pool, input, 'tools/list', {})
    const tools = isRecord(listed) && Array.isArray(listed.tools) ? listed.tools : []
    if (!tools.some((tool) => isRecord(tool) && tool.name === input.toolName)) {
      throw new Error('The MCP App requested a tool that its server did not advertise.')
    }
  }
  const result = await appRequest(pool, input, 'tools/call', {
    name: input.toolName,
    arguments: input.arguments,
  })
  const value = isRecord(result) ? result : {}
  return {
    content: json(value.content ?? []),
    ...(value.structuredContent === undefined
      ? {}
      : { structuredContent: json(value.structuredContent) }),
    isError: value.isError === true,
  }
}

function attempt<A>(operation: () => Promise<A>) {
  return Effect.tryPromise({
    try: operation,
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

/** MCP Apps over the given pool, which holds the Session's warm connections. */
export function createPiMcpAppRuntimeService(pool: McpConnectionPool): McpAppRuntimeServiceShape {
  return {
    readResource: (input) => attempt(() => readResource(pool, input)),
    listCatalog: (input) => attempt(() => listCatalog(pool, input)),
    callTool: (input) => attempt(() => callTool(pool, input)),
  }
}
