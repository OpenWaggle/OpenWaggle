import {
  type McpMergedConfig,
  type McpMergedServer,
  mcpConfigFileScope,
  mergeMcpConfigLayers,
} from '../../../domain/mcp/config/mcp-config-merge'
import { piLiteral } from '../../../domain/mcp/config/mcp-pi-literal'
import { withOpenWaggleRuntimeExposure } from '../../../domain/mcp/config/mcp-runtime-exposure'
import type {
  McpConfiguredValue,
  McpServerConfig,
  McpTransportKind,
} from '../../../domain/mcp/config/mcp-server-config'
import { McpVaultError } from '../../../ports/mcp-errors'
import {
  mcpFileMigrationPending,
  type PendingMcpFileMigration,
  pendingMcpFileMigration,
} from '../migration/migration-health'
import { sameMigrationLocation } from '../migration/project-spellings'
import {
  connectsProjectMcpServers,
  projectServerPolicyNotice,
  withProjectServerPolicy,
} from './mcp-automation-policy'
import {
  type McpConfigFileReader,
  type McpConfigFileRoots,
  mcpConfigFileLocations,
  openWaggleMcpConfigPath,
  readMcpConfigLayers,
} from './mcp-config-files'
import { deferredMcpSecret } from './mcp-deferred-secrets'
import { mcpFilePendingNotice, mcpScopePendingNotice } from './mcp-write-refusal'

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
  /**
   * What Pi's MCP extension is given, with exposure as OpenWaggle runs it: a file's `direct` is
   * `codemode` here (`withOpenWaggleRuntimeExposure`, ADR 0051 amendment).
   */
  readonly loaded: McpRuntimeLoadedConfig
  /** The real transport of each server, for servers Pi sees as plain URL entries. */
  readonly transports: ReadonlyMap<string, McpTransportKind>
  /** The merge before secret resolution, with file ids, for management views. */
  readonly merged: McpMergedConfig
  /** Servers left out because a vault secret could not be read, with why. */
  readonly unavailable: ReadonlyMap<string, string>
  /** Those of `unavailable` whose secret is missing from the vault (Settings shows it per row). */
  readonly missingSecrets: ReadonlyMap<string, string>
  /**
   * Each server's configuration with every vault value replaced by its stamp (`secretStamp`), for
   * the connection fingerprint: the same whether the Run deferred the secret or read it.
   */
  readonly connectionConfigs: ReadonlyMap<string, McpServerConfig>
}

export type McpSecretResolver = (name: string) => Promise<string>

export interface LoadMcpRuntimeConfigInput {
  readonly roots: McpConfigFileRoots
  readonly resolveSecret: McpSecretResolver
  /** Session-level MCP off gives the Session no servers. Defaults to on. */
  readonly sessionMcpEnabled?: boolean
  /** An Agent definition's MCP allowlist: servers it does not name are left out. */
  readonly serverAllowlist?: readonly string[]
  /**
   * A Run's servers that are off get deferred markers instead of their vault secrets, read when
   * Pi connects them (`resolveDeferredMcpSecrets`), so a Run with no server on reads no keychain.
   */
  readonly deferSecretsOfServersOff?: boolean
  /**
   * What stands for a vault secret in `connectionConfigs`, without decrypting it, such as its
   * name and when it was saved. Defaults to the name.
   */
  readonly secretStamp?: (name: string) => Promise<string>
  readonly reader?: McpConfigFileReader
  /** Whether project files' servers may connect; defaults to `connectsProjectMcpServers()`. */
  readonly connectProjectServers?: boolean
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

type ResolvedValues =
  | { readonly ok: true; readonly values: Record<string, string> | undefined }
  | { readonly ok: false; readonly error: string; readonly missingSecret?: true }

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
      const missing = error instanceof McpVaultError && error.reason === 'secret-not-found'
      return {
        ok: false,
        error: `${server.source.path}: server "${server.name}": ${field} "${key}" names vault secret "${value.secret}", which could not be read: ${errorMessage(error)}`,
        ...(missing ? { missingSecret: true as const } : {}),
      }
    }
  }
  return { ok: true, values: resolved }
}

type ResolvedServer =
  | { readonly ok: true; readonly config: McpServerConfig }
  | { readonly ok: false; readonly error: string; readonly missingSecret?: true }

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
 * the old OpenWaggle had off turned off, so loading it could connect them. While old on/off state
 * waits to be applied, no server of the scope connects at all: the overrides the migration writes
 * there also keep servers of Pi's files and `.mcp.json` off.
 */
function loadConnectableMcpConfig(roots: McpConfigFileRoots, reader?: McpConfigFileReader) {
  const left: PendingMcpFileMigration[] = []
  const files = mcpConfigFileLocations(roots).filter((file) => {
    const pending = mcpFileMigrationPending(file.path)
    if (pending) left.push(pending)
    return pending === undefined
  })
  const merged = mergeMcpConfigLayers(readMcpConfigLayers(files, reader))
  const scope = pendingMcpFileMigration(roots.homeDir, roots.projectPath)
  const closed = scope?.keepsLegacyState ? scope : undefined
  // One notice per failure: the scope's names its file, so that file's own is not repeated.
  const notices = [
    ...(closed ? [mcpScopePendingNotice(closed)] : []),
    ...left
      .filter((pending) => !closed || !sameMigrationLocation(pending.path, closed.path))
      .map(mcpFilePendingNotice),
  ]
  if (closed) {
    return {
      ...merged,
      servers: [],
      orphanedOverrides: undefined,
      errors: [...notices, ...merged.errors],
      incomplete: true as const,
    }
  }
  if (notices.length === 0) return merged
  return { ...merged, errors: [...notices, ...merged.errors], incomplete: true as const }
}

/**
 * Why a server the merge leaves out is missing: the notice of a failing migration, when the scope
 * is closed or the file that defines the server is left out, or the automation policy for a
 * project server. Undefined when it is not configured.
 */
export function mcpLeftOutServerNotice(
  roots: McpConfigFileRoots,
  name: string,
  connectProjectServers = connectsProjectMcpServers(),
) {
  const scope = pendingMcpFileMigration(roots.homeDir, roots.projectPath)
  if (scope?.keepsLegacyState) return mcpScopePendingNotice(scope)
  const server = loadMcpMergedConfig(roots).servers.find((candidate) => candidate.name === name)
  const notice = projectServerPolicyNotice(server, connectProjectServers)
  if (notice) return notice
  const leftOut = server ? mcpFileMigrationPending(server.source.path) : undefined
  return leftOut ? mcpFilePendingNotice(leftOut) : undefined
}

/**
 * The configuration one Pi session receives: the merged file set with vault references resolved,
 * narrowed by the Session's MCP switch and an Agent definition's allowlist.
 */
export async function loadMcpRuntimeConfig(
  input: LoadMcpRuntimeConfigInput,
): Promise<McpRuntimeConfig> {
  const merged = withProjectServerPolicy(
    loadConnectableMcpConfig(input.roots, input.reader),
    input.connectProjectServers ?? connectsProjectMcpServers(),
  )
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
  const connectionConfigs = new Map<string, McpServerConfig>()
  const missingSecrets = new Map<string, string>()
  const stamp = input.secretStamp ?? (async (name: string) => name)
  for (const configured of selected) {
    // Files keep `direct` for the `pi` command; OpenWaggle runs it as `codemode`.
    const server = { ...configured, config: withOpenWaggleRuntimeExposure(configured.config) }
    const deferred = input.deferSecretsOfServersOff === true && server.config.enabled === false
    const resolved = await resolveServer(
      server,
      // Not piLiteral-escaped: a marker holds no `$` and does not start with `!`.
      deferred ? async (name) => deferredMcpSecret(name) : input.resolveSecret,
    )
    if (!resolved.ok) {
      errors.push(resolved.error)
      unavailable.set(server.name, resolved.error)
      if (resolved.missingSecret) missingSecrets.set(server.name, resolved.error)
      continue
    }
    servers.push(runtimeEntry(server, resolved.config))
    transports.set(server.name, server.transport)
    const stamped = await resolveServer(server, async (name) => `vault-secret:${await stamp(name)}`)
    if (stamped.ok) connectionConfigs.set(server.name, stamped.config)
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
    missingSecrets,
    connectionConfigs,
  }
}
