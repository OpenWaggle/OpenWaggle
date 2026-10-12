/**
 * The one-time, silent migration of OpenWaggle's pre-ADR-0051 MCP files to
 * Pi's entry format (ADR 0051, "One-time silent migration").
 *
 * Handles `~/.openwaggle/mcp.json` and `<project>/.openwaggle/mcp.json` for
 * every known project. Never writes Pi's files or `.mcp.json` (the old code
 * never wrote OpenWaggle-only fields there). Each file is handled once and
 * recorded in `~/.openwaggle/mcp/migration.json`, never again, whatever it
 * holds later. A changed file is backed up first: the global file next to it,
 * a project file under `~/.openwaggle/mcp/backups/` (`migrationBackupPath`).
 * A failure is logged and leaves the file as it was, so the next start tries
 * again.
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
import { reportHomeFolderProjectState } from './home-project-state'
import { contentHash } from './json-document'
import { legacyServerRecords } from './legacy-server-names'
import { legacyStateProjects, normalizeLegacyProjectPath } from './legacy-state'
import { type McpMigrationFs, nodeMcpMigrationFs } from './migration-fs'
import { gateUnmigratedMcpFiles } from './migration-gate'
import { recordMcpFileMigrationOutcome } from './migration-health'
import {
  defaultPiAgentDir,
  globalMcpPaths,
  isGlobalOpenWaggleMcpFile,
  migrationBackupPath,
  projectMcpPaths,
} from './migration-paths'
import { MCP_FILE_MIGRATION_VERSION, type McpMigrationRecord } from './migration-record'
import { loadMigrationStart, McpMigrationSourceError } from './migration-start'
import {
  type McpOAuthMigrationResult,
  type McpOAuthMigrationSink,
  migrateLegacyOAuthStates,
} from './oauth-state-migration'
import { keepsEnablement, migrationProjects } from './project-spellings'
import {
  type McpSessionSwitchMigrationSink,
  migrateLegacySessionSwitches,
} from './session-switch-migration'

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
  /** Switches MCP off for a Session in the Host; old per-Session switches are dropped without it. */
  readonly sessionMcpSwitch?: McpSessionSwitchMigrationSink
  /** Keeps each file the migration creates out of its git work tree; a failure is only logged. */
  readonly keepCreatedFileOutOfGit?: (filePath: string) => Promise<unknown>
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
  /** Old per-Session MCP switches not carried over to the Host ('on' and 'inherit' need none). */
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
  /** Whether old on/off state waits for this file while its migration fails. */
  readonly keepsLegacyState: boolean
  readonly compute: (original: string | undefined) => Promise<FileComputation>
}

class McpFileMigrator {
  constructor(
    private readonly fs: McpMigrationFs,
    private readonly record: McpMigrationRecord,
    private readonly logger: Logger,
    private readonly input: Pick<
      MigrateOpenWaggleMcpFilesInput,
      'now' | 'homeDir' | 'keepCreatedFileOutOfGit'
    >,
  ) {}

  async run(job: FileJob): Promise<McpFileMigrationReport> {
    const report = await this.migrate(job)
    recordMcpFileMigrationOutcome(job.path, report.status === 'failed' ? report.error : undefined, {
      keepsLegacyState: job.keepsLegacyState,
    })
    return report
  }

  private async migrate(job: FileJob): Promise<McpFileMigrationReport> {
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
      const backupPath = migrationBackupPath(job.path, this.input.homeDir)
      if (original !== undefined) await this.fs.createTextExclusive(backupPath, original)
      await this.fs.writeTextAtomic(job.path, result.text)
      if (original === undefined) await this.keepCreatedOutOfGit(job.path)
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

  private async keepCreatedOutOfGit(filePath: string) {
    await this.input.keepCreatedFileOutOfGit?.(filePath).catch((error: unknown) => {
      const context = { path: filePath, error: describeError(error) }
      this.logger.warn('Could not keep a created MCP file out of git', context)
    })
  }

  private recordFile(filePath: string, status: 'migrated' | 'unchanged', text: string | undefined) {
    return this.record.recordFile(filePath, {
      version: MCP_FILE_MIGRATION_VERSION,
      migratedAt: this.input.now().toISOString(),
      status,
      contentHash: contentHash(text),
    })
  }
}

/**
 * The projects whose servers keep their old on/off state, decided once. Null when OpenWaggle had
 * no MCP setup (no old state and no global file): nothing connected before, but nothing was set
 * up either, so Pi's servers simply work.
 */
async function legacyProjects(
  input: MigrateOpenWaggleMcpFilesInput,
  start: Awaited<ReturnType<typeof loadMigrationStart>>,
  fs: McpMigrationFs,
  knownProjectPaths: () => Promise<readonly string[]>,
) {
  const { record, state } = start
  if (record.legacyProjects !== undefined) return record.legacyProjects
  const hadGlobalFile =
    (await fs.readText(globalMcpPaths(input.homeDir).openwaggleGlobal)) !== undefined
  if (!start.stateExists && !hadGlobalFile) {
    record.setLegacyProjects(null)
    return null
  }
  // Recorded for good, so a failure to list the known projects fails the run (tried again).
  const known = await knownProjectPaths()
  const projects = [...known, ...input.projectPaths, ...legacyStateProjects(state)]
    .filter((projectPath) => projectPath.trim().length > 0)
    .map(normalizeLegacyProjectPath)
  const unique = [...new Set(projects)]
  record.setLegacyProjects(unique)
  return unique
}

/** Run the migration for the global file and every known project. Safe to call repeatedly. */
export async function migrateOpenWaggleMcpFiles(
  input: MigrateOpenWaggleMcpFilesInput,
): Promise<McpMigrationReport> {
  const fs = input.fs ?? nodeMcpMigrationFs
  const logger = input.logger ?? defaultLogger
  let start: Awaited<ReturnType<typeof loadMigrationStart>>
  let kept: readonly string[] | null
  let listed: Promise<readonly string[]> | undefined
  // Listed once per run: they decide the projects kept on the first run and lend spellings.
  const knownProjectPaths = () => {
    listed ??= input.knownProjectPaths ? input.knownProjectPaths() : Promise.resolve([])
    return listed
  }
  try {
    start = await loadMigrationStart(fs, input.homeDir)
    kept = await legacyProjects(input, start, fs, knownProjectPaths)
  } catch (error) {
    logger.error('MCP migration could not read its record or the old MCP state', {
      homeDir: input.homeDir,
      error: describeError(error),
    })
    // What the record does not list as migrated may not load yet; the rest was migrated.
    await gateUnmigratedMcpFiles({
      homeDir: input.homeDir,
      projectPaths: input.projectPaths,
      error,
      fs,
      ...(error instanceof McpMigrationSourceError ? { source: error.filePath } : {}),
    })
    return { files: [], oauth: [], droppedSessionStates: 0, error: describeError(error) }
  }
  const { record, state } = start
  const migrator = new McpFileMigrator(fs, record, logger, input)
  const piAgentDir = input.piAgentDir ?? defaultPiAgentDir(input.homeDir)
  const sources = new McpFileSources(fs, input.homeDir, piAgentDir)
  const paths = globalMcpPaths(input.homeDir, piAgentDir)
  const projects = await migrationProjects({
    ...input,
    state,
    sources,
    // Only spellings: a list that cannot be read lends none.
    knownProjectPaths: () => knownProjectPaths().catch(() => []),
    recordedProjects: record.legacyProjects ?? [],
  })
  // Read before the files are rewritten, and saved with their records.
  const legacy = await legacyServerRecords({ sources, state, projects })
  record.noteLegacyServerNames(legacy.names)
  record.noteLegacyServerIdentities(legacy.identities)
  const files: McpFileMigrationReport[] = [
    await migrator.run({
      path: paths.openwaggleGlobal,
      keepsLegacyState: kept !== null,
      compute: (original) =>
        computeGlobalFile({ sources, state, original, preserveEnablement: kept !== null }),
    }),
  ]
  for (const projectPath of projects) {
    // A project that is the home folder, or whose .openwaggle folder links to the global one, has
    // the global file as its project file; it is migrated once, and its own choices stay out.
    if (isGlobalOpenWaggleMcpFile(projectMcpPaths(projectPath).openwaggle, input.homeDir)) {
      // Logged once, then recorded: the choices cannot move anywhere on a later start either.
      if (!record.isHomeFolderNoticed(projectPath)) {
        const reported = await reportHomeFolderProjectState({
          sources,
          state,
          projectPath,
          preserveEnablement: keepsEnablement(kept, projectPath),
          logger,
        })
        if (reported) await record.recordHomeFolderNotice(projectPath)
      }
      continue
    }
    files.push(
      await migrator.run({
        path: projectMcpPaths(projectPath).openwaggle,
        keepsLegacyState: keepsEnablement(kept, projectPath),
        compute: (original) =>
          computeProjectFile({
            sources,
            state,
            projectPath,
            original,
            preserveEnablement: keepsEnablement(kept, projectPath),
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
  const droppedSessionStates = await migrateLegacySessionSwitches({
    state,
    record,
    sink: input.sessionMcpSwitch,
    now: input.now,
    logger,
  })
  return { files, oauth, droppedSessionStates }
}
