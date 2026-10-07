/**
 * `~/.openwaggle/mcp/migration.json`: which files the one-time ADR 0048
 * migration has handled, so it never runs twice for the same file.
 */
import path from 'node:path'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { McpMigrationFs } from './migration-fs'

/** Bump only with a new migration step; files recorded at this version are skipped. */
export const MCP_FILE_MIGRATION_VERSION = 1
const RECORD_FORMAT_VERSION = 1
const JSON_INDENT = 2

const fileRecordSchema = Schema.Struct({
  version: Schema.Number,
  migratedAt: Schema.String,
  status: Schema.Literal('migrated', 'unchanged'),
  contentHash: Schema.NullOr(Schema.String),
})

const oauthRecordSchema = Schema.Struct({
  migratedAt: Schema.String,
  status: Schema.Literal('migrated', 'skipped'),
  reason: Schema.optional(Schema.String),
})

const sessionSwitchRecordSchema = Schema.Struct({ migratedAt: Schema.String })

const migrationRecordSchema = Schema.Struct({
  version: Schema.Number,
  files: Schema.Record({ key: Schema.String, value: fileRecordSchema }),
  oauth: Schema.optionalWith(Schema.Record({ key: Schema.String, value: oauthRecordSchema }), {
    default: () => ({}),
  }),
  /** Sessions whose old MCP-off switch was written to the Host. */
  sessionSwitches: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: sessionSwitchRecordSchema }),
    { default: () => ({}) },
  ),
  /**
   * Decided on the first run: the projects whose on/off state the migration keeps, or null when
   * OpenWaggle had no MCP setup to keep (no old state.json and no ~/.openwaggle/mcp.json).
   */
  legacyProjects: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
})

export type McpMigrationFileRecord = typeof fileRecordSchema.Type
export type McpMigrationOAuthRecord = typeof oauthRecordSchema.Type
export type McpMigrationSessionSwitchRecord = typeof sessionSwitchRecordSchema.Type

export function migrationRecordPath(homeDir: string) {
  return path.join(homeDir, '.openwaggle', 'mcp', 'migration.json')
}

/** Mutable in-memory view of the record, persisted after every handled file. */
export class McpMigrationRecord {
  private constructor(
    private readonly fs: McpMigrationFs,
    private readonly filePath: string,
    private readonly files: Record<string, McpMigrationFileRecord>,
    private readonly oauth: Record<string, McpMigrationOAuthRecord>,
    private readonly sessionSwitches: Record<string, McpMigrationSessionSwitchRecord>,
    private legacy: readonly string[] | null | undefined,
  ) {}

  static async load(fs: McpMigrationFs, homeDir: string) {
    const filePath = migrationRecordPath(homeDir)
    const text = await fs.readText(filePath)
    if (!text?.trim()) return new McpMigrationRecord(fs, filePath, {}, {}, {}, undefined)
    const parsed: unknown = JSON.parse(text)
    const decoded = decodeUnknownOrThrow(migrationRecordSchema, parsed)
    return new McpMigrationRecord(
      fs,
      filePath,
      { ...decoded.files },
      { ...decoded.oauth },
      { ...decoded.sessionSwitches },
      decoded.legacyProjects,
    )
  }

  /** Undefined until the first run decides it; see `legacyProjects` in the schema. */
  get legacyProjects() {
    return this.legacy
  }

  /** Kept in memory and saved with the next handled file, so a failed run decides again. */
  setLegacyProjects(projects: readonly string[] | null) {
    this.legacy = projects
  }

  isFileMigrated(filePath: string) {
    const record = this.files[filePath]
    return record !== undefined && record.version >= MCP_FILE_MIGRATION_VERSION
  }

  isOAuthHandled(key: string) {
    return this.oauth[key] !== undefined
  }

  isSessionSwitchHandled(sessionId: string) {
    return this.sessionSwitches[sessionId] !== undefined
  }

  async recordSessionSwitch(sessionId: string, record: McpMigrationSessionSwitchRecord) {
    this.sessionSwitches[sessionId] = record
    await this.persist()
  }

  async recordFile(filePath: string, record: McpMigrationFileRecord) {
    this.files[filePath] = record
    await this.persist()
  }

  async recordOAuth(key: string, record: McpMigrationOAuthRecord) {
    this.oauth[key] = record
    await this.persist()
  }

  private persist() {
    const value = {
      version: RECORD_FORMAT_VERSION,
      files: this.files,
      oauth: this.oauth,
      ...(Object.keys(this.sessionSwitches).length === 0
        ? {}
        : { sessionSwitches: this.sessionSwitches }),
      ...(this.legacy === undefined ? {} : { legacyProjects: this.legacy }),
    }
    return this.fs.writeTextAtomic(this.filePath, `${JSON.stringify(value, null, JSON_INDENT)}\n`)
  }
}
