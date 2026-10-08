import {
  type McpMergedConfig,
  type McpMergedServer,
  mcpConfigFileScope,
  mergeMcpConfigLayers,
} from '../../../domain/mcp/config/mcp-config-merge'
import { piLiteral } from '../../../domain/mcp/config/mcp-pi-literal'
import type {
  McpConfiguredValue,
  McpServerConfig,
  McpTransportKind,
} from '../../../domain/mcp/config/mcp-server-config'
import { mcpFileMigrationFailure } from '../migration/migration-health'
import {
  type McpConfigFileReader,
  type McpConfigFileRoots,
  mcpConfigFileLocations,
  openWaggleMcpConfigPath,
  readMcpConfigLayers,
} from './mcp-config-files'

/** One server as Pi's MCP extension receives it (`McpServerEntry`). */
export interface McpRuntimeServerEntry {
  name: string
  config: McpServerConfig
  /** The config file that defines the server. */
  source: string
  scope?: 'global' | 'project' | 'extension'
  /** The file whose override-only entry changes the server's enabled state or exposure. */
  override?: string
}

/** What Pi's `loadConfig` returns (`LoadedMcpConfig`). */
export interface McpRuntimeLoadedConfig {
  servers: McpRuntimeServerEntry[]
  autoEnableCodemode?: boolean
  errors: string[]
  /** Where Pi writes "enable/disable in this project": OpenWaggle's project file. */
  projectConfig?: string
}

export interface McpRuntimeConfig {
  readonly loaded: McpRuntimeLoadedConfig
  /** The real transport of each server, for servers Pi sees as plain URL entries. */
  readonly transports: ReadonlyMap<string, McpTransportKind>
  /** The merge before secret resolution, with file ids, for management views. */
  readonly merged: McpMergedConfig
  /** Servers left out because a vault secret could not be read, with why. */
  readonly unavailable: ReadonlyMap<string, string>
}

export type McpSecretResolver = (name: string) => Promise<string>

export interface LoadMcpRuntimeConfigInput {
  readonly roots: McpConfigFileRoots
  readonly resolveSecret: McpSecretResolver
  /** Session-level MCP off gives the Session no servers. Defaults to on. */
  readonly sessionMcpEnabled?: boolean
  /** An Agent definition's MCP allowlist: servers it does not name are left out. */
  readonly serverAllowlist?: readonly string[]
  readonly reader?: McpConfigFileReader
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

type ResolvedValues =
  | { readonly ok: true; readonly values: Record<string, string> | undefined }
  | { readonly ok: false; readonly error: string }

async function resolveValues(
  server: McpMergedServer,
  field: 'env' | 'headers',
  values: Readonly<Record<string, McpConfiguredValue>> | undefined,
  resolveSecret: McpSecretResolver,
): Promise<ResolvedValues> {
  if (!values) return { ok: true, values: undefined }
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      resolved[key] = value
      continue
    }
    try {
      // A secret is data: Pi must never read it as `${VAR}` or run it as `!command`.
      resolved[key] = piLiteral(await resolveSecret(value.secret))
    } catch (error) {
      return {
        ok: false,
        error: `${server.source.path}: server "${server.name}": ${field} "${key}" names vault secret "${value.secret}", which could not be read: ${errorMessage(error)}`,
      }
    }
  }
  return { ok: true, values: resolved }
}

type ResolvedServer =
  | { readonly ok: true; readonly config: McpServerConfig }
  | { readonly ok: false; readonly error: string }

async function resolveServer(
  server: McpMergedServer,
  resolveSecret: McpSecretResolver,
): Promise<ResolvedServer> {
  const { config } = server
  if ('url' in config) {
    const { headers, ...rest } = config
    const resolved = await resolveValues(server, 'headers', headers, resolveSecret)
    if (!resolved.ok) return resolved
    return {
      ok: true,
      config: { ...rest, ...(resolved.values ? { headers: resolved.values } : {}) },
    }
  }
  const { env, ...rest } = config
  const resolved = await resolveValues(server, 'env', env, resolveSecret)
  if (!resolved.ok) return resolved
  return { ok: true, config: { ...rest, ...(resolved.values ? { env: resolved.values } : {}) } }
}

/**
 * The entry Pi's MCP extension sees. Pi knows one kind of override, a project file's override of a
 * global server ("global, project override", "saved to the project mcp.json"), so it hears only of
 * those. Any other override (a global file's, or one of a project server) is where OpenWaggle's
 * `updateConfig` saves changes, so Pi is given it as the source, and `/mcp` says "Saved to" the
 * file that is actually written.
 */
function runtimeEntry(server: McpMergedServer, config: McpServerConfig): McpRuntimeServerEntry {
  const projectOverrideOfGlobal =
    server.override !== undefined &&
    server.scope === 'global' &&
    mcpConfigFileScope(server.override.fileId) === 'project'
  return {
    name: server.name,
    config,
    source: !projectOverrideOfGlobal && server.override ? server.override.path : server.source.path,
    scope: server.scope,
    ...(projectOverrideOfGlobal && server.override ? { override: server.override.path } : {}),
  }
}

export function loadMcpMergedConfig(
  roots: McpConfigFileRoots,
  reader?: McpConfigFileReader,
): McpMergedConfig {
  return mergeMcpConfigLayers(readMcpConfigLayers(mcpConfigFileLocations(roots), reader))
}

/**
 * The merge a Run connects with. An OpenWaggle file whose one-time migration failed is left out,
 * with an error saying so: it still has the old format, without the overrides that keep servers
 * the old OpenWaggle had off turned off, so loading it could connect them.
 */
function loadConnectableMcpConfig(roots: McpConfigFileRoots, reader?: McpConfigFileReader) {
  const skipped: string[] = []
  const files = mcpConfigFileLocations(roots).filter((file) => {
    const failure = mcpFileMigrationFailure(file.path)
    if (failure === undefined) return true
    skipped.push(
      `${file.path} was not loaded: its one-time migration failed (${failure}). It is tried again shortly; until then its servers stay off.`,
    )
    return false
  })
  const merged = mergeMcpConfigLayers(readMcpConfigLayers(files, reader))
  return skipped.length === 0 ? merged : { ...merged, errors: [...skipped, ...merged.errors] }
}

/**
 * The configuration one Pi session receives: the merged file set with vault references resolved,
 * narrowed by the Session's MCP switch and an Agent definition's allowlist.
 */
export async function loadMcpRuntimeConfig(
  input: LoadMcpRuntimeConfigInput,
): Promise<McpRuntimeConfig> {
  const merged = loadConnectableMcpConfig(input.roots, input.reader)
  // A project at the home folder has no project file of its own: its path is the global file's,
  // and Pi's /mcp "in this project" must not write that.
  const projectConfig = mcpConfigFileLocations(input.roots).some(
    (file) => file.fileId === 'project-openwaggle',
  )
    ? openWaggleMcpConfigPath(input.roots, 'project')
    : undefined
  const allowlist = input.serverAllowlist ? new Set(input.serverAllowlist) : undefined
  const selected =
    input.sessionMcpEnabled === false
      ? []
      : merged.servers.filter((server) => !allowlist || allowlist.has(server.name))
  const errors = [...merged.errors]
  const servers: McpRuntimeServerEntry[] = []
  const transports = new Map<string, McpTransportKind>()
  const unavailable = new Map<string, string>()
  for (const server of selected) {
    const resolved = await resolveServer(server, input.resolveSecret)
    if (!resolved.ok) {
      errors.push(resolved.error)
      unavailable.set(server.name, resolved.error)
      continue
    }
    servers.push(runtimeEntry(server, resolved.config))
    transports.set(server.name, server.transport)
  }
  return {
    loaded: {
      servers,
      errors,
      ...(merged.autoEnableCodemode === undefined
        ? {}
        : { autoEnableCodemode: merged.autoEnableCodemode }),
      ...(projectConfig ? { projectConfig } : {}),
    },
    transports,
    merged,
    unavailable,
  }
}
