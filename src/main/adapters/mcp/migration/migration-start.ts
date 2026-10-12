/**
 * What a migration run reads first: its record and the old OpenWaggle's state. An error in either
 * names the file it came from, so the user is told which file to fix, not the migrated one.
 */
import type { Logger } from '@shared/types/logger'
import {
  EMPTY_LEGACY_STATE,
  legacyStateProjects,
  normalizeLegacyProjectPath,
  parseLegacyState,
} from './legacy-state'
import type { McpMigrationFs } from './migration-fs'
import { gateUnmigratedMcpFiles } from './migration-gate'
import { globalMcpPaths } from './migration-paths'
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
 * When only state.json cannot be read and the old state is needed no more (the old-state
 * decision is made and every old MCP-off Session switch carried over), the run goes on without
 * it: what it migrates from now on keeps no old state. A file that still waits for old state
 * fails instead (`unreadableState`). Undefined otherwise, which fails the run closed.
 */
export async function startWithoutOldState(fs: McpMigrationFs, homeDir: string, error: unknown) {
  const statePath = globalMcpPaths(homeDir).legacyState
  if (!(error instanceof McpMigrationSourceError) || error.filePath !== statePath) return undefined
  const record = await McpMigrationRecord.load(fs, homeDir).catch(() => undefined)
  if (record?.legacyProjects === undefined || !record.sessionSwitchesDone) return undefined
  return {
    record,
    legacyProjects: record.legacyProjects,
    state: EMPTY_LEGACY_STATE,
    stateExists: true,
    unreadableState: error,
  }
}

/**
 * The report of a run that could not read its record or the old state: the files the record
 * does not list as migrated are gated, as they may not load yet.
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

/**
 * The projects whose servers keep their old on/off state, decided once. Null when OpenWaggle had
 * no MCP setup (no old state and no global file): nothing connected before, but nothing was set
 * up either, so Pi's servers simply work.
 */
export async function decideLegacyProjects(
  input: { readonly homeDir: string; readonly projectPaths: readonly string[] },
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
