import { homedir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createMcpExtension,
  type ExtensionAPI,
  type InlineExtension,
  type McpTransportFactory,
} from '@earendil-works/pi-coding-agent'
import { isRecord } from '@shared/utils/validation'
import { mcpShellEnvironmentReady } from '../../../mcp-shell-environment'
import { createMcpUpdateConfig } from '../../mcp/config/mcp-config-writer'
import { resolveDeferredMcpSecrets } from '../../mcp/config/mcp-deferred-secrets'
import { loadMcpRuntimeConfig, type McpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'
import {
  mcpVaultSecretStamps,
  resolveMcpVaultSecret,
} from '../../mcp/encrypted-mcp-secret-vault-service'
import {
  type McpConnectionPool,
  mcpConnectionFingerprint,
  mcpServerIdentity,
} from '../../mcp/pool/mcp-connection-pool-api'
import { createPiMcpRuntimeInteractions } from '../mcp-client-interactions'
import { getPiAgentDir } from '../pi-provider-catalog'
import { mcpAppDescriptor } from './mcp-app-registry'
import { createMcpExtensionServers } from './mcp-extension-servers'
import { hardenedMcpAuthProvider } from './mcp-hardened-auth-provider'
import { attachSessionMcpContext } from './mcp-session-context'
import { createRunSignInOpener } from './mcp-sign-in-page'
import { approveMcpToolCall } from './mcp-tool-approval'
import { mcpServerEntryOfNamespace, mcpToolNamespace } from './mcp-tool-server'
import { registerMcpUsageStatistics } from './mcp-usage-statistics'
import { getOpenWaggleMcpCredentials, openWaggleMcpLogPath } from './openwaggle-mcp-credentials'
import {
  migrateOpenWaggleMcpFilesOnce,
  migrateOpenWaggleMcpSignInsOnce,
} from './openwaggle-mcp-migration'
import { mcpConnectionConfig, withShellResolvedClientSecrets } from './pi-mcp-server-oauth'
import { openPiMcpUpstream } from './pi-mcp-upstream'

/** Only servers with `direct` tools can delay a message, and by at most this long (ADR 0051). */
export const MCP_STARTUP_WAIT_MS = 1_500

export interface OpenWaggleMcpSessionInput {
  readonly sessionId: string
  /** The Host's connection pool, which keeps the Session's connections across Runs. */
  readonly pool: McpConnectionPool
  /** The durable project root, not the worktree a Run executes in. */
  readonly projectPath: string | null
  /** An Agent definition's MCP allowlist. */
  readonly serverAllowlist?: readonly string[]
  /** Session-level MCP off. */
  readonly sessionMcpEnabled?: boolean
  /** Told when Pi's `/mcp` saves a change, so Settings can refresh. */
  readonly onConfigChanged?: (filePath: string) => void
}

function serverIdentities(config: McpRuntimeConfig) {
  return new Map(
    config.loaded.servers.map((server) => [
      server.name,
      { identity: mcpServerIdentity(server.name, server.config) },
    ]),
  )
}

/** The configured server a Pi MCP tool belongs to, found through its tool namespace. */
function serverOfTool(
  pi: ExtensionAPI,
  config: Pick<McpRuntimeConfig, 'loaded'>,
  toolName: string,
) {
  const namespace = mcpToolNamespace(pi, toolName)
  if (!namespace) return undefined
  const server = mcpServerEntryOfNamespace(config, namespace)
  if (server) {
    return { name: server.name, identity: mcpServerIdentity(server.name, server.config) }
  }
  // A server an extension registered: still asked about, under its namespace.
  return { name: namespace.replace(/^mcp__/, ''), identity: `mcp-extension:${namespace}` }
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

function companionExtension(
  input: OpenWaggleMcpSessionInput,
  config: McpRuntimeConfig,
  extensionServers: ReturnType<typeof createMcpExtensionServers>,
) {
  const servers = serverIdentities(config)
  return (pi: ExtensionAPI) => {
    let detach: (() => void) | undefined
    pi.on('session_start', (_event, ctx) => {
      extensionServers.capture(pi)
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
    registerMcpToolApproval(pi, config)
    registerMcpUsageStatistics(pi, config)
  }
}

/**
 * Asks before every MCP server tool runs, through Pi's `tool_call` hook, which also fires for the
 * calls a codemode script makes (`parentToolCallId` set).
 */
export function registerMcpToolApproval(
  pi: ExtensionAPI,
  config: Pick<McpRuntimeConfig, 'loaded'>,
) {
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

/**
 * The transport of each server a Run connects: a lease on the Session's pooled connection. Servers
 * an Agent definition does not list are refused here too, since servers Pi extensions register
 * (`pi.registerMcpServer`) never pass through `loadConfig`.
 */
export function openWaggleMcpTransport(
  input: Pick<OpenWaggleMcpSessionInput, 'sessionId' | 'pool' | 'serverAllowlist' | 'projectPath'>,
  config: Pick<McpRuntimeConfig, 'transports'> &
    Partial<Pick<McpRuntimeConfig, 'connectionConfigs'>>,
): McpTransportFactory {
  return (entry, cwd, authProvider) => {
    if (input.serverAllowlist && !input.serverAllowlist.includes(entry.name)) {
      throw new Error(
        `This Session's Agent definition does not use the MCP server "${entry.name}".`,
      )
    }
    const transport =
      config.transports.get(entry.name) ?? ('url' in entry.config ? 'http' : 'stdio')
    return input.pool.lease(input.sessionId, {
      name: entry.name,
      // Vault values by their stamp: deferred in one Run and read in the next, a server that is
      // turned on keeps its connection. Servers Pi extensions register are taken as given.
      fingerprint: mcpConnectionFingerprint({
        config: mcpConnectionConfig(config.connectionConfigs, entry),
        transport,
        cwd,
      }),
      identity: mcpServerIdentity(entry.name, entry.config),
      projectPath: input.projectPath,
      ...(entry.scope === 'extension' ? { fromExtension: true } : {}),
      // A server that was off when the Run started reads its vault secrets only now.
      open: async () =>
        openPiMcpUpstream({
          entry: {
            ...entry,
            config: await resolveDeferredMcpSecrets(entry.config, resolveMcpVaultSecret),
          },
          transport,
          cwd,
          authProvider: hardenedMcpAuthProvider(entry, authProvider),
        }),
      roots: () => [{ uri: pathToFileURL(cwd).href, name: path.basename(cwd) }],
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
  // MCP off means no MCP runtime, so servers Pi extensions register do not connect either.
  if (input.sessionMcpEnabled === false) return []
  await migrateOpenWaggleMcpFilesOnce(input.projectPath)
  const config = await loadMcpRuntimeConfig({
    roots: { homeDir: homedir(), piAgentDir: getPiAgentDir(), projectPath: input.projectPath },
    resolveSecret: resolveMcpVaultSecret,
    ...(input.sessionMcpEnabled === undefined
      ? {}
      : { sessionMcpEnabled: input.sessionMcpEnabled }),
    ...(input.serverAllowlist ? { serverAllowlist: input.serverAllowlist } : {}),
    deferSecretsOfServersOff: true,
    secretStamp: mcpVaultSecretStamps(),
  })
  // A server that is on connects in the background: its old sign-in first, so it is not reported
  // signed out while the keychain is read, and the login shell's environment for its command and
  // values. With no server on, a Run waits for neither (ADR 0051).
  if (config.loaded.servers.some((server) => server.config.enabled !== false)) {
    await Promise.all([
      migrateOpenWaggleMcpSignInsOnce(input.projectPath),
      mcpShellEnvironmentReady(),
    ])
  }
  const extensionServers = createMcpExtensionServers()
  const mcp = createMcpExtension({
    loadConfig: () => withShellResolvedClientSecrets(config.loaded),
    createTransport: openWaggleMcpTransport(input, config),
    credentials: getOpenWaggleMcpCredentials(),
    logPath: openWaggleMcpLogPath(),
    // Servers Pi extensions registered sign in too; the companion reads them at session start.
    openUrl: createRunSignInOpener(() => [...config.loaded.servers, ...extensionServers.entries()]),
    updateConfig: createMcpUpdateConfig(
      (filePath) => input.onConfigChanged?.(filePath),
      (name) => config.merged.servers.find((server) => server.name === name)?.override?.path,
    ),
    startupWaitMs: MCP_STARTUP_WAIT_MS,
  })
  return [
    { name: 'mcp', factory: mcp, replaceable: true, builtin: true },
    companionExtension(input, config, extensionServers),
  ]
}
