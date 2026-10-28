import {
  type ExtensionAPI,
  type ExtensionFactory,
  getMcpToolExposure,
  type McpServerConfig,
  type McpServerEntry,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import {
  withFileDirectExposure,
  withMcpAppToolsDeclared,
  withOpenWaggleRuntimeExposure,
} from '../../../domain/mcp/config/mcp-runtime-exposure'
import { mcpServerIdentity } from '../../mcp/pool/mcp-connection-pool-api'
import { mcpAppTool, mcpAppToolNames } from './mcp-app-registry'
import { registerUnknownMcpAppToolWait } from './mcp-app-tool-startup-wait'
import { boundMember } from './mcp-openwaggle-surface'
import { knownMcpServerState } from './mcp-server-status-registry'

/**
 * MCP exposure as OpenWaggle runs it, on Pi's MCP extension (ADR 0051 amendment). The configured
 * servers arrive with `direct` already run as `codemode` (`loadMcpRuntimeConfig`); this covers
 * the rest:
 *
 * - Tools that open an MCP App are declared to the model (`withMcpAppToolsDeclared`). Pi drops a
 *   tool's `_meta`, so App tools are known only from the `tools/list` results the transport layer
 *   sees. Those already known when the Run starts, from this Session or any check of the same
 *   server, are given to Pi as `direct`: Pi then waits for their server before the first request
 *   (at most `MCP_STARTUP_WAIT_MS`), as it waits for any server with direct tools. One first
 *   learned in this Run is declared when Pi registers it, from the next request on.
 * - Servers Pi extensions register (`pi.registerMcpServer`) never pass through OpenWaggle's
 *   configuration, so their `direct` is run as `codemode` where Pi's MCP extension reads them,
 *   and their App tools are declared when Pi registers them.
 */
export function withOpenWaggleMcpExposure(
  sessionId: string,
  loaded: { readonly servers: readonly McpServerEntry[] },
  factory: ExtensionFactory,
  /** The first request also waits for servers whose App tools are not known yet, this long. */
  unknownApps?: {
    readonly waitMs: number
    readonly cached?: CachedMcpAppTools
    /** Whether the server's connection failed in this Run, so it will not list its tools. */
    readonly failed?: (server: McpServerEntry) => boolean
  },
  /** Whether this Run's codemode reaches MCP tools; without it, `direct` stays `direct`. */
  codemode?: McpCodemodeReach,
): ExtensionFactory {
  return (pi) => {
    codemode?.capture(pi)
    const registeredLabels = new Set<string>()
    if (unknownApps) {
      registerUnknownMcpAppToolWait(pi, {
        sessionId,
        servers: loaded.servers,
        ...unknownApps,
        registered: (label) => registeredLabels.has(label),
      })
    }
    // Only `direct` changes here, which is stable: Pi reconnects a registered server whose
    // configuration changes, so the App tools it learns are declared on registration instead.
    const getMcpServers: ExtensionAPI['getMcpServers'] = () =>
      codemode && !codemode.reachable()
        ? pi.getMcpServers()
        : pi.getMcpServers().map((server) => ({
            ...server,
            config: withOpenWaggleRuntimeExposure(server.config),
          }))
    const serverConfig = (name: string) =>
      loaded.servers.find((server) => server.name === name)?.config ??
      getMcpServers().find((server) => server.name === name)?.config
    const registerTool: ExtensionAPI['registerTool'] = (definition) => {
      registeredLabels.add(definition.label)
      pi.registerTool(declaredIfMcpApp(sessionId, serverConfig, definition))
    }
    return factory(
      new Proxy(pi, {
        get: (target, property) => {
          if (property === 'getMcpServers') return getMcpServers
          if (property === 'registerTool') return registerTool
          return boundMember(target, property)
        },
      }),
    )
  }
}

const CODEMODE_TOOL_NAME = 'codemode'

/** What a Run's MCP extension knows of codemode, read once Pi's extensions are loaded. */
export interface McpCodemodeReach {
  readonly capture: (pi: Pick<ExtensionAPI, 'getAllTools' | 'getActiveTools'>) => void
  /**
   * Whether codemode can reach MCP tools in this Run: a `codemode` tool that reaches tools is
   * registered, and Pi activates it (`autoEnableCodemode`) or it is active already. As Pi's MCP
   * extension decides it (`ensureDiscoveryActive`). True until `capture`.
   */
  readonly reachable: () => boolean
}

export function mcpCodemodeReach(autoEnableCodemode = true): McpCodemodeReach {
  let api: Pick<ExtensionAPI, 'getAllTools' | 'getActiveTools'> | undefined
  return {
    capture: (pi) => {
      api = pi
    },
    reachable: () => {
      if (!api) return true
      const registered = api
        .getAllTools()
        .some((tool) => tool.name === CODEMODE_TOOL_NAME && tool.reachesTools !== undefined)
      return (
        registered && (autoEnableCodemode || api.getActiveTools().includes(CODEMODE_TOOL_NAME))
      )
    },
  }
}

/**
 * The configuration Pi's MCP extension loads in a Run where codemode cannot reach MCP tools: each
 * server's `direct` as its file says it (`withFileDirectExposure`). Otherwise unchanged.
 */
export function withDirectKeptWithoutCodemode<
  Loaded extends { readonly servers: readonly McpServerEntry[] },
>(
  loaded: Loaded,
  codemode: McpCodemodeReach,
  fileConfigOf: (name: string) => Pick<McpServerConfig, 'exposure' | 'toolExposure'> | undefined,
): Loaded {
  if (codemode.reachable()) return loaded
  return {
    ...loaded,
    servers: loaded.servers.map((server) => {
      const file = fileConfigOf(server.name)
      return file ? { ...server, config: withFileDirectExposure(server.config, file) } : server
    }),
  }
}

/**
 * Where a Run looks up a server's App tools beyond this Host's memory: the server's cached
 * catalog (`cachedMcpAppToolNames`). Undefined when nothing is known.
 */
export type CachedMcpAppTools = (entry: McpServerEntry) => readonly string[] | undefined

/**
 * The MCP App tools a server is known to have: from this Session's listings, else from its cached
 * catalog, which is the project's (`mcpToolCatalogKeyOf`), else from the last listing of the same
 * server anywhere in the Host (a Run of another Session, Check connection). The Host-wide state is
 * kept by server identity, with no project, so it comes last: another project's listing says
 * little about the server here (review R5 P3-4). Undefined when none of them knows the server.
 */
export function knownMcpAppTools(
  sessionId: string,
  entry: McpServerEntry,
  cached?: CachedMcpAppTools,
): readonly string[] | undefined {
  const own = mcpAppToolNames(sessionId, entry.name)
  if (own) return own
  const fromCatalog = cached?.(entry)
  if (fromCatalog) return fromCatalog
  const known = knownMcpServerState(mcpServerIdentity(entry.name, entry.config))
  if (known?.state === 'connected') {
    return known.tools.filter((tool) => tool.hasApp).map((tool) => tool.name)
  }
  return undefined
}

/**
 * The configuration Pi's MCP extension loads, with each server's known App tools declared. Pi
 * calls `loadConfig` when its session starts, so App tools an earlier Run listed count.
 */
export function withKnownMcpAppToolsOf<
  Loaded extends { readonly servers: readonly McpServerEntry[] },
>(sessionId: string, loaded: Loaded, cached?: CachedMcpAppTools): Loaded {
  return {
    ...loaded,
    servers: loaded.servers.map((server) => ({
      ...server,
      config: withMcpAppToolsDeclared(
        server.config,
        knownMcpAppTools(sessionId, server, cached) ?? [],
      ),
    })),
  }
}

/**
 * Pi's definition of one MCP tool, declared when the tool opens an MCP App and would otherwise
 * run as `codemode`. Pi gives MCP tools of a `codemode` server the tool exposure `deferred`, the
 * namespace alias of their server's name, and the label `<server>/<tool>` (`tools.ts`).
 */
function declaredIfMcpApp<
  Definition extends Pick<ToolDefinition, 'name' | 'label' | 'exposure' | 'namespace'>,
>(
  sessionId: string,
  serverConfig: (name: string) => McpServerConfig | undefined,
  definition: Definition,
): Definition {
  if (definition.exposure !== 'deferred' || !definition.name.startsWith('mcp__')) return definition
  const server = definition.namespace?.aliases?.[0]
  if (!server || !definition.label.startsWith(`${server}/`)) return definition
  const tool = definition.label.slice(server.length + 1)
  const config = serverConfig(server)
  if (!config || getMcpToolExposure(config, tool) !== 'codemode') return definition
  if (!mcpAppTool(sessionId, server, tool)) return definition
  return { ...definition, exposure: 'direct' }
}
