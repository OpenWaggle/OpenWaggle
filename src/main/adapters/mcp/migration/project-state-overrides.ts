/**
 * Per-project choices recorded in the old state.json, expressed as Pi
 * override-only `{ "enabled": false }` entries in `<project>/.openwaggle/mcp.json`.
 */
import { isRecord } from '@shared/utils/validation'
import { isFullEntry } from '../../../domain/mcp/migration/legacy-entry-conversion'
import type { McpLayerServers, McpServerMigrationChange } from './entry-migration'
import { legacyServerIdentityKey } from './legacy-pi-import'
import { isUserDisabled, type LegacyStateFile } from './legacy-state'

export interface ProjectStateOverrideInput {
  readonly projectPath: string
  readonly state: LegacyStateFile
  /** Files the old code read for this project, with their content before the migration. */
  readonly legacyLayers: {
    readonly openwaggleGlobal: McpLayerServers
    readonly mcpJson: McpLayerServers
    readonly openwaggleProject: McpLayerServers
  }
  /** Every file below the project file in the new merge order, with current content. */
  readonly lowerLayers: readonly McpLayerServers[]
}

function serverNameByInstanceId(input: ProjectStateOverrideInput, instanceId: string) {
  const layers = Object.values(input.legacyLayers)
  for (const layer of layers) {
    for (const name of Object.keys(layer.servers)) {
      const state = input.state.servers[legacyServerIdentityKey(layer.path, name)]
      if (state?.instanceId === instanceId) return name
    }
  }
  return undefined
}

function visibleServerNames(
  input: ProjectStateOverrideInput,
  projectServers: Readonly<Record<string, unknown>>,
) {
  const names = new Set<string>()
  for (const layer of [...input.lowerLayers, { path: '', servers: projectServers }]) {
    for (const [name, entry] of Object.entries(layer.servers)) {
      if (isFullEntry(entry)) names.add(name)
    }
  }
  return names
}

/** Reasons, by server name, for turning servers off in this project. */
function projectDisables(
  input: ProjectStateOverrideInput,
  projectServers: Readonly<Record<string, unknown>>,
) {
  const reasons = new Map<string, string>()
  const visible = visibleServerNames(input, projectServers)
  const mcpJson = input.legacyLayers.mcpJson
  for (const name of Object.keys(mcpJson.servers)) {
    const state = input.state.servers[legacyServerIdentityKey(mcpJson.path, name)]
    if (isUserDisabled(state) && visible.has(name)) {
      reasons.set(name, 'it was turned off in OpenWaggle')
    }
  }
  const muted = input.state.projectServerStates[input.projectPath] ?? {}
  for (const [instanceId, value] of Object.entries(muted)) {
    if (value !== 'off') continue
    const name = serverNameByInstanceId(input, instanceId)
    if (name && visible.has(name)) reasons.set(name, 'it was turned off for this project')
  }
  if (input.state.projectStates[input.projectPath] === 'off') {
    for (const name of visible) reasons.set(name, 'MCP was turned off for this project')
  }
  return reasons
}

/** Apply the old per-project choices to the project file's (already migrated) servers. */
export function applyProjectStateOverrides(
  input: ProjectStateOverrideInput,
  servers: Readonly<Record<string, unknown>>,
) {
  const next: Record<string, unknown> = { ...servers }
  const changes: McpServerMigrationChange[] = []
  for (const [name, reason] of projectDisables(input, servers)) {
    const current = next[name]
    if (isRecord(current) && current.enabled === false) continue
    next[name] = isRecord(current) ? { ...current, enabled: false } : { enabled: false }
    changes.push({
      server: name,
      action: 'disabled-by-state',
      details: [`disabled because ${reason}`],
    })
  }
  return { servers: next, changes }
}
