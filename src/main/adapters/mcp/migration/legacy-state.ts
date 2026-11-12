/**
 * Local schemas for the pre-ADR-0051 files the migration reads. They are
 * deliberately lenient: the migration reads what it needs and ignores the rest.
 */
import path from 'node:path'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { mcpConfigServerMaps } from '../mcp-config-server-maps'

const legacyServerStateSchema = Schema.Struct({
  instanceId: Schema.String,
  enabled: Schema.Boolean,
  trustedConfigHash: Schema.optionalWith(Schema.String, { exact: true }),
})

const stringRecordSchema = Schema.Record({ key: Schema.String, value: Schema.String })

const legacyStateFileSchema = Schema.Struct({
  globalState: Schema.optionalWith(Schema.String, { exact: true }),
  projectStates: Schema.optionalWith(stringRecordSchema, { default: () => ({}) }),
  sessionStates: Schema.optionalWith(stringRecordSchema, { default: () => ({}) }),
  projectServerStates: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: stringRecordSchema }),
    { default: () => ({}) },
  ),
  servers: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: legacyServerStateSchema }),
    { default: () => ({}) },
  ),
})

export type LegacyStateFile = typeof legacyStateFileSchema.Type

export const EMPTY_LEGACY_STATE: LegacyStateFile = {
  projectStates: {},
  sessionStates: {},
  projectServerStates: {},
  servers: {},
}

/** Parse `~/.openwaggle/mcp/state.json`. Throws on invalid content. */
export function parseLegacyState(rawJson: string | undefined): LegacyStateFile {
  if (!rawJson?.trim()) return EMPTY_LEGACY_STATE
  const parsed: unknown = JSON.parse(rawJson)
  return decodeUnknownOrThrow(legacyStateFileSchema, parsed)
}

/** The project paths the old state names (project switches and per-project server switches). */
export function legacyStateProjects(state: LegacyStateFile) {
  return [...Object.keys(state.projectStates), ...Object.keys(state.projectServerStates)]
}

/**
 * The one spelling of a project path the migration uses everywhere: the old code keyed projects
 * by `path.resolve(projectPath)`, so the state it left is found under that spelling.
 */
export function normalizeLegacyProjectPath(projectPath: string) {
  return path.resolve(projectPath.trim())
}

/** Server entries of an old OpenWaggle MCP file: `mcpServers`, else the `servers` alias. */
export function legacyServerMap(config: Record<string, unknown>) {
  const { mcpServers, servers } = mcpConfigServerMaps(config)
  return mcpServers ?? servers ?? {}
}
