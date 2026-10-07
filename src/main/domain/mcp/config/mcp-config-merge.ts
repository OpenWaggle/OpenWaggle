/**
 * Merges the MCP configuration file set of ADR 0048 into the server list Pi's MCP extension
 * receives.
 *
 * Files are folded in order (Pi global, OpenWaggle global, `.mcp.json`, `.pi/mcp.json`,
 * `.openwaggle/mcp.json`), so for one server name a project entry beats a global one and a later
 * file beats an earlier one. A full entry replaces what an earlier file defined. An override-only
 * entry (no `command`, `url`, or `type`) changes only `enabled`, `exposure`, and `toolExposure` of
 * the entry an earlier file defined and records itself as that entry's override, which is where
 * enabled and exposure changes are written. This is Pi's project-override rule, applied to every
 * file after the first.
 */
import {
  isJsonRecord,
  isMcpOverrideEntry,
  MCP_OVERRIDE_KEYS,
  type McpConfiguredServerConfig,
  type McpServerTransport,
  mcpNamespace,
} from './mcp-server-config'
import { validateMcpServerEntry } from './mcp-server-entry-validation'

export const MCP_CONFIG_FILE_IDS = [
  'pi-global',
  'openwaggle-global',
  'project-mcp-json',
  'project-pi',
  'project-openwaggle',
] as const

export type McpConfigFileId = (typeof MCP_CONFIG_FILE_IDS)[number]

export type McpConfigScope = 'global' | 'project'

export function mcpConfigFileScope(fileId: McpConfigFileId): McpConfigScope {
  return fileId === 'pi-global' || fileId === 'openwaggle-global' ? 'global' : 'project'
}

/** OpenWaggle's own files, the only ones that may hold vault secret references. */
export function isOpenWaggleMcpConfigFile(fileId: McpConfigFileId) {
  return fileId === 'openwaggle-global' || fileId === 'project-openwaggle'
}

export type McpConfigLayerContent =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly error: string }
  | { readonly kind: 'parsed'; readonly value: unknown }

export interface McpConfigLayer {
  readonly fileId: McpConfigFileId
  readonly path: string
  readonly content: McpConfigLayerContent
}

export interface McpConfigFileReference {
  readonly fileId: McpConfigFileId
  readonly path: string
}

export interface McpMergedServer {
  readonly name: string
  readonly config: McpConfiguredServerConfig
  readonly transport: McpServerTransport
  /** The file whose full entry defines the server. */
  readonly source: McpConfigFileReference
  readonly scope: McpConfigScope
  /** The last file whose override-only entry changes the server; enabled/exposure writes go here. */
  readonly override?: McpConfigFileReference
}

export interface McpMergedConfig {
  readonly servers: readonly McpMergedServer[]
  readonly errors: readonly string[]
  readonly autoEnableCodemode?: boolean
}

interface MergeState {
  readonly servers: Map<string, McpMergedServer>
  readonly errors: string[]
  autoEnableCodemode?: boolean
}

function applyOverride(
  state: MergeState,
  layer: McpConfigLayer,
  name: string,
  value: Record<string, unknown>,
) {
  const base = state.servers.get(name)
  const extra = Object.keys(value).filter(
    (key) => !MCP_OVERRIDE_KEYS.some((overrideKey) => overrideKey === key),
  )
  if (!base) {
    state.errors.push(
      `${layer.path}: server "${name}" needs "command" or "url", or a server in an earlier file to override`,
    )
    return
  }
  if (extra.length > 0) {
    state.errors.push(
      `${layer.path}: server "${name}": an override can only set ${MCP_OVERRIDE_KEYS.join(', ')}`,
    )
    return
  }
  const validated = validateMcpServerEntry(
    name,
    { ...base.config, ...(base.transport === 'sse' ? { type: 'sse' } : {}), ...value },
    { allowSecretReferences: true },
  )
  if (!validated.ok) {
    state.errors.push(`${layer.path}: ${validated.error}`)
    return
  }
  state.servers.set(name, {
    ...base,
    config: validated.server.config,
    override: { fileId: layer.fileId, path: layer.path },
  })
}

function defineServer(state: MergeState, layer: McpConfigLayer, name: string, value: unknown) {
  const scope = mcpConfigFileScope(layer.fileId)
  const validated = validateMcpServerEntry(name, value, {
    allowSecretReferences: isOpenWaggleMcpConfigFile(layer.fileId),
  })
  if (!validated.ok) {
    state.errors.push(`${layer.path}: ${validated.error}`)
    return
  }
  // Names that differ only in `-` and `_` would share a tool namespace.
  const clash = [...state.servers.keys()].find(
    (other) => other !== name && mcpNamespace(other) === mcpNamespace(name),
  )
  if (clash) {
    state.errors.push(`${layer.path}: server "${name}" conflicts with "${clash}"`)
    return
  }
  const { config, transport } = validated.server
  if (scope === 'project' && 'url' in config && config.auth) {
    state.errors.push(`${layer.path}: server "${name}": auth is only allowed in a global mcp.json`)
    return
  }
  state.servers.set(name, {
    name,
    config,
    transport,
    source: { fileId: layer.fileId, path: layer.path },
    scope,
  })
}

function readLayer(state: MergeState, layer: McpConfigLayer, isFirst: boolean) {
  const { content } = layer
  if (content.kind === 'missing') return
  if (content.kind === 'unreadable') {
    state.errors.push(`${layer.path}: ${content.error}`)
    return
  }
  const parsed = content.value
  if (
    !isJsonRecord(parsed) ||
    (parsed.mcpServers !== undefined && !isJsonRecord(parsed.mcpServers))
  ) {
    state.errors.push(`${layer.path}: expected an object with an "mcpServers" object`)
    return
  }
  if (typeof parsed.autoEnableCodemode === 'boolean') {
    state.autoEnableCodemode = parsed.autoEnableCodemode
  }
  if (parsed.autoEnableCodemode !== undefined && typeof parsed.autoEnableCodemode !== 'boolean') {
    state.errors.push(`${layer.path}: autoEnableCodemode must be a boolean`)
  }
  const servers = isJsonRecord(parsed.mcpServers) ? parsed.mcpServers : {}
  for (const [name, value] of Object.entries(servers)) {
    if (!isFirst && isJsonRecord(value) && isMcpOverrideEntry(value)) {
      applyOverride(state, layer, name, value)
      continue
    }
    defineServer(state, layer, name, value)
  }
}

/** Merge the file layers, given in precedence order from lowest to highest. */
export function mergeMcpConfigLayers(layers: readonly McpConfigLayer[]): McpMergedConfig {
  const state: MergeState = { servers: new Map(), errors: [] }
  layers.forEach((layer, index) => {
    readLayer(state, layer, index === 0)
  })
  return {
    servers: [...state.servers.values()],
    errors: state.errors,
    ...(state.autoEnableCodemode === undefined
      ? {}
      : { autoEnableCodemode: state.autoEnableCodemode }),
  }
}
