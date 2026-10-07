import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMcpAuthProvider } from '@earendil-works/pi-coding-agent'
import { safeDecodeUnknown } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type { McpJsonValue } from '@shared/types/mcp'
import { Effect, Layer } from 'effect'
import {
  McpAppRuntimeService,
  type McpAppServerInput,
} from '../../../ports/mcp-app-runtime-service'
import { loadMcpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'
import { resolveMcpVaultSecret } from '../../mcp/encrypted-mcp-secret-vault-service'
import { mcpSessionConnectionPool } from '../../mcp/pool/mcp-connection-pool-instance'
import { mcpConnectionFingerprint, mcpServerIdentity } from '../../mcp/pool/mcp-server-identity'
import { getPiAgentDir } from '../pi-provider-catalog'
import { mcpAppTool } from './mcp-app-registry'
import { getOpenWaggleMcpCredentials } from './openwaggle-mcp-credentials'
import { openPiMcpUpstream } from './pi-mcp-upstream'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function oauthUrl(config: {
  readonly url: string
  readonly headers?: Record<string, string>
  readonly auth?: unknown
}) {
  if (config.auth) return undefined
  const hasAuthorization = Object.keys(config.headers ?? {}).some(
    (header) => header.toLowerCase() === 'authorization',
  )
  return hasAuthorization ? undefined : config.url
}

/** The Session's connection to the App's server, opened with its current configuration if closed. */
async function appConnection(input: McpAppServerInput) {
  const warm = mcpSessionConnectionPool.connection(input.sessionId, input.serverName)
  const config = await loadMcpRuntimeConfig({
    roots: { homeDir: homedir(), piAgentDir: getPiAgentDir(), projectPath: input.projectPath },
    resolveSecret: resolveMcpVaultSecret,
  })
  const entry = config.loaded.servers.find((server) => server.name === input.serverName)
  if (!entry || mcpServerIdentity(entry.name, entry.config) !== input.serverIdentity) {
    throw new Error(
      `The MCP server "${input.serverName}" this App belongs to was changed or removed.`,
    )
  }
  if (warm) return warm
  if (entry.config.enabled === false) {
    throw new Error(`The MCP server "${input.serverName}" is turned off.`)
  }
  const transport = config.transports.get(entry.name) ?? ('url' in entry.config ? 'http' : 'stdio')
  const cwd = input.projectPath ?? homedir()
  const url = 'url' in entry.config ? oauthUrl(entry.config) : undefined
  const authProvider = url
    ? createMcpAuthProvider({
        serverUrl: url,
        store: getOpenWaggleMcpCredentials().forServer(entry.name, url),
        settings: () => ({}),
        onChallenge: () => {},
      })
    : undefined
  return mcpSessionConnectionPool.connectionFor(input.sessionId, {
    name: entry.name,
    fingerprint: mcpConnectionFingerprint({ config: entry.config, transport, cwd }),
    open: () => openPiMcpUpstream({ entry, transport, cwd, authProvider }),
    roots: () => [{ uri: pathToFileURL(cwd).href, name: path.basename(cwd) }],
  })
}

function json(value: unknown): McpJsonValue {
  const decoded = safeDecodeUnknown(mcpConfigValueSchema, value ?? null)
  if (!decoded.success) throw new Error('The MCP server returned a result OpenWaggle cannot read.')
  return decoded.data
}

async function readResource(input: McpAppServerInput & { readonly uri: string }) {
  if (!input.uri.startsWith('ui://')) throw new Error('MCP Apps may only read ui:// resources.')
  const connection = await appConnection(input)
  const result = await connection.request('resources/read', { uri: input.uri })
  return json(isRecord(result) ? result.contents : [])
}

async function callTool(
  input: McpAppServerInput & {
    readonly toolName: string
    readonly arguments: Readonly<Record<string, McpJsonValue>>
  },
) {
  // An App may call only tools its server advertised in this Session.
  if (!mcpAppTool(input.sessionId, input.serverName, input.toolName)) {
    const connection = await appConnection(input)
    const listed = await connection.request('tools/list', {})
    const tools = isRecord(listed) && Array.isArray(listed.tools) ? listed.tools : []
    if (!tools.some((tool) => isRecord(tool) && tool.name === input.toolName)) {
      throw new Error('The MCP App requested a tool that its server did not advertise.')
    }
  }
  const connection = await appConnection(input)
  const result = await connection.request('tools/call', {
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

export const PiMcpAppRuntimeServiceLive = Layer.succeed(McpAppRuntimeService, {
  readResource: (input) => attempt(() => readResource(input)),
  callTool: (input) => attempt(() => callTool(input)),
})
