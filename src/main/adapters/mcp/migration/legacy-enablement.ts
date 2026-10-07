/**
 * Keeps each server's on/off state through the migration (ADR 0048): a server that did not
 * connect before must not start connecting after it, and one that did keeps connecting.
 *
 * The old code read only OpenWaggle's global file, `.mcp.json`, and the project's OpenWaggle
 * file (a later file wins by name), never Pi's files. A server connected in a project when:
 * - MCP was on there (the project switch, else the global switch, which defaulted to off);
 * - its state record said `enabled: true` (a new server started off until the user turned it
 *   on, which was also the trust step);
 * - and it was not muted for that project, unless the entry was `required`.
 *
 * The migration writes override `enabled` values into OpenWaggle's files wherever the new merge
 * would otherwise give a different answer.
 */
import { isRecord } from '@shared/utils/validation'
import { isFullEntry } from '../../../domain/mcp/migration/legacy-entry-conversion'
import type { McpLayerServers, McpServerMigrationChange } from './entry-migration'
import { legacyServerIdentityKey } from './legacy-pi-import'
import type { LegacyStateFile } from './legacy-state'

export interface LegacyEnablementScope {
  readonly state: LegacyStateFile
  /** The project, or null for the global baseline (a project that inherits everything). */
  readonly projectPath: string | null
  /** The files the old code read for this scope, as they were before the migration, in its order. */
  readonly legacyLayers: readonly McpLayerServers[]
}

interface LegacyConnection {
  readonly connected: boolean
  readonly reason: string
}

function mcpWasOn(scope: LegacyEnablementScope) {
  const projectState = scope.projectPath ? scope.state.projectStates[scope.projectPath] : undefined
  if (projectState === 'on' || projectState === 'off') return projectState === 'on'
  return scope.state.globalState === 'on'
}

function mcpOffReason(scope: LegacyEnablementScope) {
  const projectState = scope.projectPath ? scope.state.projectStates[scope.projectPath] : undefined
  return projectState === 'off' ? 'MCP was off for this project' : 'MCP was off in OpenWaggle'
}

/** Whether the old code connected `name` in this scope, and why not when it did not. */
export function legacyServerConnection(
  scope: LegacyEnablementScope,
  name: string,
): LegacyConnection {
  const layer = scope.legacyLayers.findLast((candidate) => isRecord(candidate.servers[name]))
  if (!layer)
    return { connected: false, reason: 'OpenWaggle did not read the file that defines it' }
  const serverState = scope.state.servers[legacyServerIdentityKey(layer.path, name)]
  if (serverState?.enabled !== true) {
    return { connected: false, reason: 'it was not turned on in OpenWaggle' }
  }
  if (!mcpWasOn(scope)) return { connected: false, reason: mcpOffReason(scope) }
  if (!scope.projectPath) return { connected: true, reason: '' }
  const entry = layer.servers[name]
  if (isRecord(entry) && entry.required === true) return { connected: true, reason: '' }
  const muted = scope.state.projectServerStates[scope.projectPath]?.[serverState.instanceId]
  return muted === 'off'
    ? { connected: false, reason: 'it was turned off for this project' }
    : { connected: true, reason: '' }
}

/**
 * Whether the new merge leaves `name` on: a full entry's own switch, then any later override.
 * Undefined when no file defines the server.
 */
export function mergedServerEnabled(layers: readonly McpLayerServers[], name: string) {
  let enabled: boolean | undefined
  for (const [index, layer] of layers.entries()) {
    const entry = layer.servers[name]
    if (isFullEntry(entry)) {
      enabled = entry.enabled !== false
      continue
    }
    const override = isRecord(entry) && index > 0 ? entry.enabled : undefined
    if (enabled !== undefined && typeof override === 'boolean') enabled = override
  }
  return enabled
}

function withEnabled(entry: unknown, enabled: boolean) {
  if (!isRecord(entry)) return { enabled }
  if (enabled && isFullEntry(entry)) {
    const { enabled: _enabled, ...rest } = entry
    return rest
  }
  return { ...entry, enabled }
}

/**
 * Sets `enabled` in this file (`ownPath`, the highest layer) for every server whose merged state
 * would differ from what the old code did in `scope`.
 */
export function preserveLegacyEnablement(input: {
  readonly scope: LegacyEnablementScope
  readonly lowerLayers: readonly McpLayerServers[]
  readonly ownPath: string
  readonly servers: Readonly<Record<string, unknown>>
}) {
  const next: Record<string, unknown> = { ...input.servers }
  const layers = [...input.lowerLayers, { path: input.ownPath, servers: next }]
  const names = new Set(layers.flatMap((layer) => Object.keys(layer.servers)))
  const changes: McpServerMigrationChange[] = []
  for (const name of names) {
    const enabled = mergedServerEnabled(layers, name)
    if (enabled === undefined) continue
    const { connected, reason } = legacyServerConnection(input.scope, name)
    if (enabled === connected) continue
    next[name] = withEnabled(next[name], connected)
    changes.push(
      connected
        ? { server: name, action: 'enabled-by-state', details: ['kept on, as it connected before'] }
        : { server: name, action: 'disabled-by-state', details: [`turned off because ${reason}`] },
    )
  }
  return { servers: next, changes }
}
