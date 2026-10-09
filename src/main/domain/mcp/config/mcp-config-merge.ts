/**
 * Merges the MCP configuration file set of ADR 0051 into the server list Pi's MCP extension
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
  type McpTransportKind,
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
  readonly transport: McpTransportKind
  /** The file whose full entry defines the server. */
  readonly source: McpConfigFileReference
  readonly scope: McpConfigScope
  /** The last file whose override-only entry changes the server; enabled/exposure writes go here. */
  readonly override?: McpConfigFileReference
  /** An override-only entry turned the server off, which the defining file has on. */
  readonly offByOverride?: true
}

export interface McpMergedConfig {
  readonly servers: readonly McpMergedServer[]
  readonly errors: readonly string[]
  /** What is ignored without breaking anything, such as an orphaned override OpenWaggle wrote. */
  readonly warnings?: readonly string[]
  /** OpenWaggle's override-only entries for a server no file defines, which can be removed. */
  readonly orphanedOverrides?: readonly McpOrphanedOverride[]
  readonly autoEnableCodemode?: boolean
}

export interface McpOrphanedOverride extends McpConfigFileReference {
  readonly name: string
}

interface MergeState {
  readonly servers: Map<string, McpMergedServer>
  readonly errors: string[]
  readonly warnings: string[]
  readonly orphanedOverrides: McpOrphanedOverride[]
  /** OpenWaggle overrides no earlier file had a server for, classified after the merge. */
  readonly unappliedOverrides: McpOrphanedOverride[]
  /** Names some file defines with an error: invalid, clashing, or not allowed in that file. */
  readonly rejectedNames: Set<string>
  /** A file that could not be read, or is not an MCP file, may define any server. */
  unreadLayer: boolean
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
  // Keys an override cannot set make it a full entry missing its command or URL, such as one
  // with `comand`: a definition with an error, never an override, and never an orphan.
  if (!base && extra.length > 0) {
    state.rejectedNames.add(name)
    state.errors.push(`${layer.path}: server "${name}" needs "command" or "url"`)
    return
  }
  if (!base && isOpenWaggleMcpConfigFile(layer.fileId)) {
    // Ignored; whether it is an orphan is known once every file is read (`classifyUnapplied`).
    state.unappliedOverrides.push({ name, fileId: layer.fileId, path: layer.path })
    return
  }
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
  const baseOn = base.offByOverride === true || base.config.enabled !== false
  const offByOverride =
    'enabled' in value ? value.enabled === false && baseOn : base.offByOverride === true
  const { offByOverride: _previous, ...rest } = base
  state.servers.set(name, {
    ...rest,
    config: validated.server.config,
    override: { fileId: layer.fileId, path: layer.path },
    ...(offByOverride ? { offByOverride: true } : {}),
  })
}

function defineServer(state: MergeState, layer: McpConfigLayer, name: string, value: unknown) {
  const scope = mcpConfigFileScope(layer.fileId)
  const validated = validateMcpServerEntry(name, value, {
    allowSecretReferences: isOpenWaggleMcpConfigFile(layer.fileId),
  })
  if (!validated.ok) {
    state.rejectedNames.add(name)
    state.errors.push(`${layer.path}: ${validated.error}`)
    return
  }
  // Names that differ only in `-` and `_` would share a tool namespace.
  const clash = [...state.servers.keys()].find(
    (other) => other !== name && mcpNamespace(other) === mcpNamespace(name),
  )
  if (clash) {
    state.rejectedNames.add(name)
    state.errors.push(`${layer.path}: server "${name}" conflicts with "${clash}"`)
    return
  }
  const { config, transport } = validated.server
  if (scope === 'project' && 'url' in config && config.auth) {
    state.rejectedNames.add(name)
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
    state.unreadLayer = true
    state.errors.push(`${layer.path}: ${content.error}`)
    return
  }
  const parsed = content.value
  if (
    !isJsonRecord(parsed) ||
    (parsed.mcpServers !== undefined && !isJsonRecord(parsed.mcpServers))
  ) {
    state.unreadLayer = true
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

/**
 * An OpenWaggle override no earlier file had a server for is ignored. It is an orphan, which can
 * be removed, only when no file defines the server at all: OpenWaggle wrote it for a server since
 * removed. One that comes before the file that defines the server, such as a global override
 * for a server a project's `.mcp.json` defines, is only reported.
 */
function classifyUnapplied(state: MergeState) {
  for (const override of state.unappliedOverrides) {
    const defined = state.servers.get(override.name)
    if (defined) {
      state.warnings.push(
        `${override.path}: server "${override.name}" is defined in ${defined.source.path}, a file read after this one, so this change to it is ignored`,
      )
      continue
    }
    // A file that was not read, or one that defines the server with an error, may define it
    // once fixed; removing the override then would change what the server does.
    if (state.unreadLayer || state.rejectedNames.has(override.name)) {
      state.warnings.push(
        `${override.path}: server "${override.name}" only changes a server no file defines; it is ignored while another file could not be read or defines it with an error`,
      )
      continue
    }
    state.warnings.push(
      `${override.path}: server "${override.name}" only changes a server no file defines any more; it is ignored`,
    )
    state.orphanedOverrides.push(override)
  }
}

/** Merge the file layers, given in precedence order from lowest to highest. */
export function mergeMcpConfigLayers(layers: readonly McpConfigLayer[]): McpMergedConfig {
  const state: MergeState = {
    servers: new Map(),
    errors: [],
    warnings: [],
    orphanedOverrides: [],
    unappliedOverrides: [],
    rejectedNames: new Set(),
    unreadLayer: false,
  }
  layers.forEach((layer, index) => {
    readLayer(state, layer, index === 0)
  })
  classifyUnapplied(state)
  return {
    servers: [...state.servers.values()],
    errors: state.errors,
    ...(state.warnings.length > 0 ? { warnings: state.warnings } : {}),
    ...(state.orphanedOverrides.length > 0 ? { orphanedOverrides: state.orphanedOverrides } : {}),
    ...(state.autoEnableCodemode === undefined
      ? {}
      : { autoEnableCodemode: state.autoEnableCodemode }),
  }
}
