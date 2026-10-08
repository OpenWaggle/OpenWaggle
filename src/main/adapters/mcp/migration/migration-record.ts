/**
 * `~/.openwaggle/mcp/migration.json`: which files the one-time ADR 0050
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

const legacyServerIdentitySchema = Schema.Struct({
  configHash: Schema.optional(Schema.String),
  identity: Schema.String,
})

export type McpLegacyServerIdentity = typeof legacyServerIdentitySchema.Type

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
  /**
   * The server name each old instance ID (state.json `servers[*].instanceId`) stood for, so Agent
   * definitions and Session profiles that still name a server by that ID keep reaching it.
   */
  legacyServerNames: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: Schema.String }),
    { default: () => ({}) },
  ),
  /**
   * For MCP Apps in transcripts from before the upgrade, which name their server by instance ID
   * and old config hash: the hash the user last turned the server on with, and the identity
   * (`mcpServerIdentity`) of what the old entry ran or connected to.
   */
  legacyServerIdentities: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: legacyServerIdentitySchema }),
    { default: () => ({}) },
  ),
  /** Home-folder projects whose left-out on/off choices were already logged. */
  homeFolderNotices: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
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
    private readonly serverNames: Record<string, string> = {},
    private readonly serverIdentities: Record<string, McpLegacyServerIdentity> = {},
    private readonly homeNotices: Set<string> = new Set(),
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
      { ...decoded.legacyServerNames },
      { ...decoded.legacyServerIdentities },
      new Set(decoded.homeFolderNotices),
    )
  }

  /** Old instance ID to server name; see `legacyServerNames` in the schema. */
  get legacyServerNames(): ReadonlyMap<string, string> {
    return new Map(Object.entries(this.serverNames))
  }

  /** Old instance ID to what its server was; see `legacyServerIdentities` in the schema. */
  get legacyServerIdentities(): ReadonlyMap<string, McpLegacyServerIdentity> {
    return new Map(Object.entries(this.serverIdentities))
  }

  noteLegacyServerIdentities(identities: ReadonlyMap<string, McpLegacyServerIdentity>) {
    for (const [instanceId, identity] of identities) this.serverIdentities[instanceId] ??= identity
  }

  /**
   * Adds the names not known yet (the first name seen for an ID is kept). Saved with the next
   * handled file, as the files they come from are handled in the same run.
   */
  noteLegacyServerNames(names: ReadonlyMap<string, string>) {
    for (const [instanceId, name] of names) this.serverNames[instanceId] ??= name
  }

  /** Undefined until the first run decides it; see `legacyProjects` in the schema. */
  get legacyProjects() {
    return this.legacy
  }

  /** Kept in memory and saved with the next handled file, so a failed run decides again. */
  setLegacyProjects(projects: readonly string[] | null) {
    this.legacy = projects
  }

  isHomeFolderNoticed(projectPath: string) {
    return this.homeNotices.has(projectPath)
  }

  async recordHomeFolderNotice(projectPath: string) {
    this.homeNotices.add(projectPath)
    await this.persist()
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
      ...(Object.keys(this.serverNames).length === 0
        ? {}
        : { legacyServerNames: this.serverNames }),
      ...(Object.keys(this.serverIdentities).length === 0
        ? {}
        : { legacyServerIdentities: this.serverIdentities }),
      ...(this.homeNotices.size === 0 ? {} : { homeFolderNotices: [...this.homeNotices] }),
    }
    return this.fs.writeTextAtomic(this.filePath, `${JSON.stringify(value, null, JSON_INDENT)}\n`)
  }
}
