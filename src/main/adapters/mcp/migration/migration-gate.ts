/**
 * When the migration could not run at all (another process kept its lock past the wait, or its
 * record or the old state could not be read), OpenWaggle's files it has not migrated yet must not
 * load: in the old format, without the `enabled` overrides, servers the old OpenWaggle had off
 * would start. Each such file is gated as failed until a later run migrates it
 * (`migration-health.ts`). A managed worktree's file is never one: the migration never handles it,
 * so nothing would clear its gate. The caller logs the failure.
 */

import { ProcessFileLockTimeoutError } from '../process-file-lock'
import { type McpMigrationFs, nodeMcpMigrationFs } from './migration-fs'
import { recordMcpFileMigrationOutcome } from './migration-health'
import { globalMcpPaths, isInside, managedWorktreesRoot, projectMcpPaths } from './migration-paths'
import { McpMigrationRecord } from './migration-record'
import { keepsEnablement } from './project-spellings'

/** A file behind a link that leads nowhere counts as there: its read fails, it is not absent. */
function exists(fs: McpMigrationFs, filePath: string) {
  return fs.readText(filePath).then(
    (text) => text !== undefined,
    () => true,
  )
}

/** Whether old on/off state waits for this file: unknown while undecided, so assumed. */
function keepsLegacyState(record: McpMigrationRecord | undefined, projectPath: string | null) {
  const projects = record?.legacyProjects
  if (projects === undefined) return true
  if (projects === null) return false
  return projectPath === null || keepsEnablement(projects, projectPath)
}

/**
 * Gates the scopes' files the record does not list as migrated (read without the lock; all of
 * them when it cannot be read), each with whether old state waits for it.
 */
export async function gateUnmigratedMcpFiles(input: {
  readonly homeDir: string
  readonly projectPaths: readonly (string | null)[]
  readonly error: unknown
  readonly source?: string
  readonly fs?: McpMigrationFs
}) {
  const { homeDir } = input
  const error = input.error instanceof Error ? input.error.message : String(input.error)
  const fs = input.fs ?? nodeMcpMigrationFs
  const record = await McpMigrationRecord.load(fs, homeDir).catch(() => undefined)
  const cause = input.error instanceof ProcessFileLockTimeoutError ? 'wait' : 'content'
  const projects = input.projectPaths.filter((projectPath) => projectPath !== null)
  const worktrees = managedWorktreesRoot(homeDir)
  const scopes = [null, ...projects.filter((projectPath) => !isInside(projectPath, worktrees))]
  for (const projectPath of scopes) {
    const filePath = projectPath
      ? projectMcpPaths(projectPath).openwaggle
      : globalMcpPaths(homeDir).openwaggleGlobal
    if (record?.isFileMigrated(filePath)) continue
    // A project folder that is gone migrates once it is back; until then nothing is there to load.
    if (projectPath && (await fs.projectFolderGone?.(projectPath))) continue
    const keeps = keepsLegacyState(record, projectPath)
    // Without old state, an absent file has nothing to convert and nothing to keep from loading.
    if (!keeps && !(await exists(fs, filePath))) continue
    recordMcpFileMigrationOutcome(filePath, error, {
      cause,
      keepsLegacyState: keeps,
      ...(input.source ? { source: input.source } : {}),
    })
  }
}
