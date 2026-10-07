import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createMcpExtension,
  type ExtensionAPI,
  type InlineExtension,
  mcpNamespace,
} from '@earendil-works/pi-coding-agent'
import { openExternal } from '../../../desktop-ui'
import { createLogger } from '../../../logger'
import { createMcpUpdateConfig } from '../../mcp/config/mcp-config-writer'
import { loadMcpRuntimeConfig, type McpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'
import { resolveMcpVaultSecret } from '../../mcp/encrypted-mcp-secret-vault-service'
import {
  mcpSessionConnectionPool,
  setMcpConnectionHooks,
} from '../../mcp/pool/mcp-connection-pool-instance'
import { mcpConnectionFingerprint, mcpServerIdentity } from '../../mcp/pool/mcp-server-identity'
import { createPiMcpRuntimeInteractions } from '../mcp-client-interactions'
import { getPiAgentDir } from '../pi-provider-catalog'
import { mcpAppDescriptor } from './mcp-app-registry'
import { hardenedMcpAuthProvider } from './mcp-hardened-auth-provider'
import { attachSessionMcpContext, openWaggleMcpConnectionHooks } from './mcp-session-context'
import { createRunSignInOpener } from './mcp-sign-in-page'
import { approveMcpToolCall } from './mcp-tool-approval'
import { getOpenWaggleMcpCredentials, openWaggleMcpLogPath } from './openwaggle-mcp-credentials'
import { migrateOpenWaggleMcpFilesOnce } from './openwaggle-mcp-migration'
import { openPiMcpUpstream } from './pi-mcp-upstream'

const logger = createLogger('mcp-extension')

/** Only servers with `direct` tools can delay a message, and by at most this long (ADR 0048). */
export const MCP_STARTUP_WAIT_MS = 1_500

setMcpConnectionHooks(openWaggleMcpConnectionHooks)

export interface OpenWaggleMcpSessionInput {
  readonly sessionId: string
  /** The durable project root, not the worktree a Run executes in. */
  readonly projectPath: string | null
  /** An Agent definition's MCP allowlist. */
  readonly serverAllowlist?: readonly string[]
  /** Session-level MCP off. */
  readonly sessionMcpEnabled?: boolean
  /** Told when Pi's `/mcp` saves a change, so Settings can refresh. */
  readonly onConfigChanged?: (filePath: string) => void
}

const MCP_TOOL_NAME = /^mcp__(.+?)__/

function serverIdentities(config: McpRuntimeConfig) {
  return new Map(
    config.loaded.servers.map((server) => [
      server.name,
      { identity: mcpServerIdentity(server.name, server.config) },
    ]),
  )
}

/** The configured server a Pi MCP tool belongs to, found through its tool namespace. */
function serverOfTool(pi: ExtensionAPI, config: McpRuntimeConfig, toolName: string) {
  const namespace =
    pi.getAllTools().find((tool) => tool.name === toolName)?.namespace?.name ??
    (MCP_TOOL_NAME.exec(toolName)?.[1] ? `mcp__${MCP_TOOL_NAME.exec(toolName)?.[1]}` : undefined)
  if (!namespace) return undefined
  const server = config.loaded.servers.find((entry) => mcpNamespace(entry.name) === namespace)
  if (server) {
    return { name: server.name, identity: mcpServerIdentity(server.name, server.config) }
  }
  // A server an extension registered: still asked about, under its namespace.
  return { name: namespace.replace(/^mcp__/, ''), identity: `mcp-extension:${namespace}` }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Adds the MCP App a tool result opens to the result's details, so the renderer's MCP App host
 * can show it under the tool call. Pi's MCP tools put `{ server, tool }` in their details and the
 * whole `CallToolResult` (without `_meta`) in `structuredContent`.
 */
function withMcpApp(
  sessionId: string,
  config: McpRuntimeConfig,
  event: {
    readonly toolName: string
    readonly details: unknown
    readonly structuredContent?: unknown
  },
) {
  const details = event.details
  if (
    !isRecord(details) ||
    typeof details.server !== 'string' ||
    typeof details.tool !== 'string'
  ) {
    return undefined
  }
  const server = config.loaded.servers.find((entry) => entry.name === details.server)
  if (!server) return undefined
  const descriptor = mcpAppDescriptor({
    sessionId,
    serverName: server.name,
    serverIdentity: mcpServerIdentity(server.name, server.config),
    toolName: details.tool,
    piToolName: event.toolName,
  })
  if (!descriptor) return undefined
  const result = isRecord(event.structuredContent) ? event.structuredContent : {}
  return {
    details: {
      ...details,
      mcpApp: {
        descriptor,
        toolResult: {
          content: result.content ?? [],
          ...(result.structuredContent === undefined
            ? {}
            : { structuredContent: result.structuredContent }),
          isError: result.isError === true,
          attribution: {
            serverInstanceId: descriptor.serverInstanceId,
            serverLabel: descriptor.serverLabel,
            toolName: descriptor.toolName,
          },
        },
      },
    },
  }
}

function companionExtension(input: OpenWaggleMcpSessionInput, config: McpRuntimeConfig) {
  const servers = serverIdentities(config)
  return (pi: ExtensionAPI) => {
    let detach: (() => void) | undefined
    pi.on('session_start', (_event, ctx) => {
      detach?.()
      detach = attachSessionMcpContext(input.sessionId, {
        interactions: createPiMcpRuntimeInteractions(ctx),
        servers,
      })
    })
    pi.on('session_shutdown', () => {
      detach?.()
      detach = undefined
    })
    pi.on('tool_result', (event) =>
      event.toolName.startsWith('mcp__') ? withMcpApp(input.sessionId, config, event) : undefined,
    )
    pi.on('tool_call', async (event, ctx) => {
      if (!event.toolName.startsWith('mcp__')) return undefined
      const server = serverOfTool(pi, config, event.toolName)
      if (!server) return undefined
      const approved = await approveMcpToolCall({
        ctx,
        serverName: server.name,
        serverIdentity: server.identity,
        toolName: event.toolName,
        input: event.input,
        fromScript: event.parentToolCallId !== undefined,
      })
      return approved ? undefined : { block: true, reason: 'The user declined this MCP tool call.' }
    })
  }
}

/**
 * Pi's built-in MCP extension with OpenWaggle's plug-in points, plus OpenWaggle's companion
 * extension (approval, sampling and elicitation context). Every Pi session OpenWaggle creates
 * for a Run loads these. Like codemode and tool search (`pi-built-in-extensions.ts`), MCP is the
 * `builtin:mcp` extension, so Pi's `-builtin:mcp` in the `extensions` setting turns it off.
 */
export async function createOpenWaggleMcpExtensions(
  input: OpenWaggleMcpSessionInput,
): Promise<readonly InlineExtension[]> {
  await migrateOpenWaggleMcpFilesOnce(input.projectPath)
  const config = await loadMcpRuntimeConfig({
    roots: { homeDir: homedir(), piAgentDir: getPiAgentDir(), projectPath: input.projectPath },
    resolveSecret: resolveMcpVaultSecret,
    ...(input.sessionMcpEnabled === undefined
      ? {}
      : { sessionMcpEnabled: input.sessionMcpEnabled }),
    ...(input.serverAllowlist ? { serverAllowlist: input.serverAllowlist } : {}),
  })
  const mcp = createMcpExtension({
    loadConfig: () => config.loaded,
    createTransport: (entry, cwd, authProvider) => {
      const transport =
        config.transports.get(entry.name) ?? ('url' in entry.config ? 'http' : 'stdio')
      return mcpSessionConnectionPool.lease(input.sessionId, {
        name: entry.name,
        fingerprint: mcpConnectionFingerprint({ config: entry.config, transport, cwd }),
        identity: mcpServerIdentity(entry.name, entry.config),
        open: () =>
          openPiMcpUpstream({
            entry,
            transport,
            cwd,
            authProvider: hardenedMcpAuthProvider(entry, authProvider),
          }),
        roots: () => [{ uri: pathToFileURL(cwd).href, name: path.basename(cwd) }],
      })
    },
    credentials: getOpenWaggleMcpCredentials(),
    logPath: openWaggleMcpLogPath(),
    openUrl: createRunSignInOpener(() => config.loaded.servers),
    updateConfig: createMcpUpdateConfig((filePath) => input.onConfigChanged?.(filePath)),
    startupWaitMs: MCP_STARTUP_WAIT_MS,
  })
  return [
    { name: 'mcp', factory: mcp, replaceable: true, builtin: true },
    companionExtension(input, config),
  ]
}
