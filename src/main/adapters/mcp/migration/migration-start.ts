/**
 * What a migration run reads first: its record and the old OpenWaggle's state. An error in either
 * names the file it came from, so the user is told which file to fix, not the migrated one.
 */
import type { Logger } from '@shared/types/logger'
import { normalizeLegacyProjectPath, parseLegacyState } from './legacy-state'
import type { McpMigrationFs } from './migration-fs'
import { gateUnmigratedMcpFiles } from './migration-gate'
import { recordMcpFileMigrationOutcome } from './migration-health'
import { globalMcpPaths, isInside, managedWorktreesRoot, projectMcpPaths } from './migration-paths'
import { McpMigrationRecord, migrationRecordPath } from './migration-record'

/** A file the migration reads could not be read or understood. */
export class McpMigrationSourceError extends Error {
  constructor(
    readonly filePath: string,
    what: string,
    cause: unknown,
  ) {
    super(
      `Invalid ${what} at ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        cause,
      },
    )
    this.name = 'McpMigrationSourceError'
  }
}

function fromSource<A>(filePath: string, what: string, read: () => Promise<A>) {
  return read().catch((error: unknown) => {
    throw new McpMigrationSourceError(filePath, what, error)
  })
}

export async function loadMigrationStart(fs: McpMigrationFs, homeDir: string) {
  const record = await fromSource(
    migrationRecordPath(homeDir),
    'OpenWaggle MCP migration record',
    () => McpMigrationRecord.load(fs, homeDir),
  )
  const statePath = globalMcpPaths(homeDir).legacyState
  const stateText = await fromSource(statePath, 'OpenWaggle MCP state', () =>
    fs.readText(statePath),
  )
  const state = await fromSource(statePath, 'OpenWaggle MCP state', async () =>
    parseLegacyState(stateText),
  )
  return { record, state, stateExists: stateText !== undefined }
}

/**
 * When the old state cannot be read, the report of a run that has nothing left to do with it:
 * every file asked for is recorded as migrated and the old-state decision is made, so a
 * state.json broken afterwards changes nothing. Undefined otherwise (another file, the record
 * itself, or work left), which fails the run closed.
 */
export async function settledAfterStateError(
  fs: McpMigrationFs,
  input: { readonly homeDir: string; readonly projectPaths: readonly string[] },
  error: unknown,
) {
  const statePath = globalMcpPaths(input.homeDir).legacyState
  if (!(error instanceof McpMigrationSourceError) || error.filePath !== statePath) return undefined
  const record = await McpMigrationRecord.load(fs, input.homeDir).catch(() => undefined)
  if (record?.legacyProjects === undefined) return undefined
  const worktrees = managedWorktreesRoot(input.homeDir)
  const files = [
    globalMcpPaths(input.homeDir).openwaggleGlobal,
    ...input.projectPaths
      .filter((projectPath) => projectPath.trim() && !isInside(projectPath, worktrees))
      .map((projectPath) => projectMcpPaths(normalizeLegacyProjectPath(projectPath)).openwaggle),
  ]
  if (!files.every((filePath) => record.isFileMigrated(filePath))) return undefined
  for (const filePath of files) recordMcpFileMigrationOutcome(filePath)
  return {
    files: files.map((filePath) => ({
      path: filePath,
      status: 'already-migrated' as const,
      changes: [],
    })),
    oauth: [],
    droppedSessionStates: 0,
  }
}

/**
 * The report of a run that could not read its record or the old state. Once nothing is left to
 * do with the old state, that is not a failure (a sign-in run still reports it, to be retried).
 * Otherwise the files the record does not list as migrated are gated: they may not load yet.
 */
export async function startFailureReport(input: {
  readonly fs: McpMigrationFs
  readonly homeDir: string
  readonly input: { readonly projectPaths: readonly string[]; readonly oauth?: unknown }
  readonly error: unknown
  readonly logger: Logger
}) {
  const { fs, homeDir, error, logger } = input
  const message = error instanceof Error ? error.message : String(error)
  const settled = await settledAfterStateError(
    fs,
    { homeDir, projectPaths: input.input.projectPaths },
    error,
  )
  if (settled) {
    logger.warn('MCP migration could not read the old MCP state; nothing is left to migrate', {
      error: message,
    })
    return input.input.oauth ? { ...settled, error: message } : settled
  }
  logger.error('MCP migration could not read its record or the old MCP state', {
    homeDir,
    error: message,
  })
  await gateUnmigratedMcpFiles({
    homeDir,
    projectPaths: input.input.projectPaths,
    error,
    fs,
    ...(error instanceof McpMigrationSourceError ? { source: error.filePath } : {}),
  })
  return { files: [], oauth: [], droppedSessionStates: 0, error: message }
}
