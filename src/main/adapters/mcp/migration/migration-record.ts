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

const migrationRecordSchema = Schema.Struct({
  version: Schema.Number,
  files: Schema.Record({ key: Schema.String, value: fileRecordSchema }),
  oauth: Schema.optionalWith(Schema.Record({ key: Schema.String, value: oauthRecordSchema }), {
    default: () => ({}),
  }),
})

export type McpMigrationFileRecord = typeof fileRecordSchema.Type
export type McpMigrationOAuthRecord = typeof oauthRecordSchema.Type

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
  ) {}

  static async load(fs: McpMigrationFs, homeDir: string) {
    const filePath = migrationRecordPath(homeDir)
    const text = await fs.readText(filePath)
    if (!text?.trim()) return new McpMigrationRecord(fs, filePath, {}, {})
    const parsed: unknown = JSON.parse(text)
    const decoded = decodeUnknownOrThrow(migrationRecordSchema, parsed)
    return new McpMigrationRecord(fs, filePath, { ...decoded.files }, { ...decoded.oauth })
  }

  isFileMigrated(filePath: string) {
    const record = this.files[filePath]
    return record !== undefined && record.version >= MCP_FILE_MIGRATION_VERSION
  }

  isOAuthHandled(key: string) {
    return this.oauth[key] !== undefined
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
    const value = { version: RECORD_FORMAT_VERSION, files: this.files, oauth: this.oauth }
    return this.fs.writeTextAtomic(this.filePath, `${JSON.stringify(value, null, JSON_INDENT)}\n`)
  }
}
