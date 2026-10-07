import path from 'node:path'
/**
 * The one-time, silent migration of OpenWaggle's pre-ADR-0048 MCP files to
 * Pi's entry format (ADR 0048, "One-time silent migration").
 *
 * Handles `~/.openwaggle/mcp.json` and `<project>/.openwaggle/mcp.json` for
 * every known project. Never writes Pi's files or `.mcp.json` (the old code
 * never wrote OpenWaggle-only fields there). Each file is handled once and
 * recorded in `~/.openwaggle/mcp/migration.json`; a changed file gets a
 * backup next to it first. A failure is logged and leaves the file as it was,
 * so the next start tries again.
 */
import type { Logger } from '@shared/types/logger'
import { createLogger } from '../../../logger'
import type { McpServerMigrationChange } from './entry-migration'
import {
  computeGlobalFile,
  computeProjectFile,
  type FileComputation,
  McpFileSources,
} from './file-computation'
import { contentHash } from './json-document'
import {
  type LegacyStateFile,
  legacyStateProjects,
  normalizeLegacyProjectPath,
  parseLegacyState,
} from './legacy-state'
import { type McpMigrationFs, nodeMcpMigrationFs } from './migration-fs'
import {
  defaultPiAgentDir,
  globalMcpPaths,
  migrationBackupPath,
  projectMcpPaths,
} from './migration-paths'
import { MCP_FILE_MIGRATION_VERSION, McpMigrationRecord } from './migration-record'
import {
  type McpOAuthMigrationResult,
  type McpOAuthMigrationSink,
  migrateLegacyOAuthStates,
} from './oauth-state-migration'

export type { McpServerMigrationChange } from './entry-migration'
export type { McpOAuthMigrationResult, McpOAuthMigrationSink } from './oauth-state-migration'

export interface MigrateOpenWaggleMcpFilesInput {
  readonly homeDir: string
  /** Pi's agent directory (`getPiAgentDir()`); defaults to `~/.pi/agent`. */
  readonly piAgentDir?: string
  /** Known OpenWaggle projects; projects named in the old state.json are added. */
  readonly projectPaths: readonly string[]
  /**
   * Every project OpenWaggle knows, read once on the first run. Their servers keep the on/off
   * state the old code gave them; projects added later get the new behaviour.
   */
  readonly knownProjectPaths?: () => Promise<readonly string[]>
  readonly now: () => Date
  readonly fs?: McpMigrationFs
  readonly logger?: Logger
  /** Old encrypted OAuth state and Pi's credential store; OAuth is skipped without it. */
  readonly oauth?: McpOAuthMigrationSink
}

export type McpFileMigrationStatus = 'migrated' | 'unchanged' | 'already-migrated' | 'failed'

export interface McpFileMigrationReport {
  readonly path: string
  readonly status: McpFileMigrationStatus
  readonly backupPath?: string
  readonly changes: readonly McpServerMigrationChange[]
  readonly error?: string
}

export interface McpMigrationReport {
  readonly files: readonly McpFileMigrationReport[]
  readonly oauth: readonly McpOAuthMigrationResult[]
  /** Session-level MCP switches in the old state; Session state now lives in the Host. */
  readonly droppedSessionStates: number
  /** Set when the migration could not start (unreadable record or old state). */
  readonly error?: string
}

const defaultLogger = createLogger('mcp-migration')

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

interface FileJob {
  readonly path: string
  readonly compute: (original: string | undefined) => Promise<FileComputation>
}

class McpFileMigrator {
  constructor(
    private readonly fs: McpMigrationFs,
    private readonly record: McpMigrationRecord,
    private readonly now: () => Date,
    private readonly logger: Logger,
  ) {}

  async run(job: FileJob): Promise<McpFileMigrationReport> {
    if (this.record.isFileMigrated(job.path)) {
      return { path: job.path, status: 'already-migrated', changes: [] }
    }
    try {
      const original = await this.fs.readText(job.path)
      const result = await job.compute(original)
      if (result.text === undefined) {
        await this.recordFile(job.path, 'unchanged', original)
        return { path: job.path, status: 'unchanged', changes: result.changes }
      }
      const backupPath = migrationBackupPath(job.path)
      if (original !== undefined) await this.fs.createTextExclusive(backupPath, original)
      await this.fs.writeTextAtomic(job.path, result.text)
      await this.recordFile(job.path, 'migrated', result.text)
      this.logger.info('Migrated MCP file to the Pi entry format', {
        path: job.path,
        servers: result.changes.map((change) => `${change.server}:${change.action}`),
      })
      return {
        path: job.path,
        status: 'migrated',
        ...(original === undefined ? {} : { backupPath }),
        changes: result.changes,
      }
    } catch (error) {
      this.logger.error('MCP file migration failed; the file was left unchanged', {
        path: job.path,
        error: describeError(error),
      })
      return { path: job.path, status: 'failed', changes: [], error: describeError(error) }
    }
  }

  private recordFile(filePath: string, status: 'migrated' | 'unchanged', text: string | undefined) {
    return this.record.recordFile(filePath, {
      version: MCP_FILE_MIGRATION_VERSION,
      migratedAt: this.now().toISOString(),
      status,
      contentHash: contentHash(text),
    })
  }
}

async function loadStart(fs: McpMigrationFs, homeDir: string) {
  const record = await McpMigrationRecord.load(fs, homeDir)
  const stateText = await fs.readText(globalMcpPaths(homeDir).legacyState)
  return { record, state: parseLegacyState(stateText), stateExists: stateText !== undefined }
}

/**
 * The projects whose servers keep their old on/off state, decided once. Null when OpenWaggle had
 * no MCP setup (no old state and no global file): nothing connected before, but nothing was set
 * up either, so Pi's servers simply work.
 */
async function legacyProjects(
  input: MigrateOpenWaggleMcpFilesInput,
  start: Awaited<ReturnType<typeof loadStart>>,
  fs: McpMigrationFs,
) {
  const { record, state } = start
  if (record.legacyProjects !== undefined) return record.legacyProjects
  const hadGlobalFile =
    (await fs.readText(globalMcpPaths(input.homeDir).openwaggleGlobal)) !== undefined
  if (!start.stateExists && !hadGlobalFile) {
    record.setLegacyProjects(null)
    return null
  }
  const known = input.knownProjectPaths ? await input.knownProjectPaths() : []
  const projects = [...known, ...input.projectPaths, ...legacyStateProjects(state)]
    .filter((projectPath) => projectPath.trim().length > 0)
    .map(normalizeLegacyProjectPath)
  const unique = [...new Set(projects)]
  record.setLegacyProjects(unique)
  return unique
}

function knownProjects(input: MigrateOpenWaggleMcpFilesInput, state: LegacyStateFile) {
  const projects = [...input.projectPaths, ...legacyStateProjects(state)]
    .filter((projectPath) => projectPath.trim().length > 0)
    .map(normalizeLegacyProjectPath)
  return [...new Set(projects)]
}

/** Run the migration for the global file and every known project. Safe to call repeatedly. */
export async function migrateOpenWaggleMcpFiles(
  input: MigrateOpenWaggleMcpFilesInput,
): Promise<McpMigrationReport> {
  const fs = input.fs ?? nodeMcpMigrationFs
  const logger = input.logger ?? defaultLogger
  let start: Awaited<ReturnType<typeof loadStart>>
  let kept: readonly string[] | null
  try {
    start = await loadStart(fs, input.homeDir)
    kept = await legacyProjects(input, start, fs)
  } catch (error) {
    logger.error('MCP migration could not read its record or the old MCP state', {
      homeDir: input.homeDir,
      error: describeError(error),
    })
    return { files: [], oauth: [], droppedSessionStates: 0, error: describeError(error) }
  }
  const { record, state } = start
  const migrator = new McpFileMigrator(fs, record, input.now, logger)
  const piAgentDir = input.piAgentDir ?? defaultPiAgentDir(input.homeDir)
  const sources = new McpFileSources(fs, input.homeDir, piAgentDir)
  const paths = globalMcpPaths(input.homeDir, piAgentDir)
  const files: McpFileMigrationReport[] = [
    await migrator.run({
      path: paths.openwaggleGlobal,
      compute: (original) =>
        computeGlobalFile({ sources, state, original, preserveEnablement: kept !== null }),
    }),
  ]
  const projects = knownProjects(input, state)
  for (const projectPath of projects) {
    // A project that is the home folder has the global file as its project file; it is migrated once.
    if (
      path.resolve(projectMcpPaths(projectPath).openwaggle) === path.resolve(paths.openwaggleGlobal)
    )
      continue
    files.push(
      await migrator.run({
        path: projectMcpPaths(projectPath).openwaggle,
        compute: (original) =>
          computeProjectFile({
            sources,
            state,
            projectPath,
            original,
            preserveEnablement: kept?.includes(projectPath) === true,
          }),
      }),
    )
  }
  const oauth = input.oauth
    ? await migrateLegacyOAuthStates({
        sources,
        state,
        projects,
        record,
        sink: input.oauth,
        now: input.now,
        logger,
      })
    : []
  return {
    files,
    oauth,
    droppedSessionStates: Object.keys(state.sessionStates).length,
  }
}
