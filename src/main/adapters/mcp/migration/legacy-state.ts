/**
 * Local schemas for the pre-ADR-0048 files the migration reads. They are
 * deliberately lenient: the migration reads what it needs and ignores the rest.
 */
import path from 'node:path'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { isRecord } from '@shared/utils/validation'

const legacyServerStateSchema = Schema.Struct({
  instanceId: Schema.String,
  enabled: Schema.Boolean,
  trustedConfigHash: Schema.optional(Schema.String),
})

const stringRecordSchema = Schema.Record({ key: Schema.String, value: Schema.String })

const legacyStateFileSchema = Schema.Struct({
  globalState: Schema.optional(Schema.String),
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

/** The old code keyed projects by `path.resolve(projectPath)`. */
export function normalizeLegacyProjectPath(projectPath: string) {
  return path.resolve(projectPath.trim())
}

/** Server entries of an old OpenWaggle MCP file: `mcpServers`, else the `servers` alias. */
export function legacyServerMap(config: Record<string, unknown>) {
  if (isRecord(config.mcpServers)) return config.mcpServers
  if (isRecord(config.servers)) return config.servers
  return {}
}
