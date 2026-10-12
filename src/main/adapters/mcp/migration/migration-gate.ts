/**
 * When the migration could not run at all (another process kept its lock past the wait, or its
 * record or the old state could not be read), OpenWaggle's files it has not migrated yet must not
 * load: in the old format, without the `enabled` overrides, servers the old OpenWaggle had off
 * would start. Each such file is gated as failed until a later run migrates it
 * (`migration-health.ts`). A managed worktree's file is never one: the migration never handles it,
 * so nothing would clear its gate.
 */

import type { Logger } from '@shared/types/logger'
import { ProcessFileLockTimeoutError } from '../process-file-lock'
import { nodeMcpMigrationFs } from './migration-fs'
import { type McpMigrationFailureDetails, recordMcpFileMigrationOutcome } from './migration-health'
import { globalMcpPaths, isInside, managedWorktreesRoot, projectMcpPaths } from './migration-paths'
import { McpMigrationRecord } from './migration-record'

/** The OpenWaggle files a run for these projects migrates: the global one and each project's. */
export function migratedMcpFiles(homeDir: string, projectPaths: readonly string[]) {
  const worktrees = managedWorktreesRoot(homeDir)
  return [
    globalMcpPaths(homeDir).openwaggleGlobal,
    ...projectPaths
      .filter((projectPath) => !isInside(projectPath, worktrees))
      .map((projectPath) => projectMcpPaths(projectPath).openwaggle),
  ]
}

/** Gates every file of the scopes, as nothing of them was migrated. */
export function gateMcpFiles(
  homeDir: string,
  projectPaths: readonly string[],
  error: string,
  details: McpMigrationFailureDetails,
) {
  for (const filePath of migratedMcpFiles(homeDir, projectPaths)) {
    recordMcpFileMigrationOutcome(filePath, error, details)
  }
}

export async function gateUnmigratedMcpFiles(input: {
  readonly homeDir: string
  readonly projectPath: string | null
  readonly error: unknown
  readonly logger: Logger
}) {
  const { homeDir, projectPath } = input
  const error = input.error instanceof Error ? input.error.message : String(input.error)
  input.logger.error('MCP migration failed; it is tried again later', { projectPath, error })
  // Read without the lock: a file already recorded as migrated stays loadable.
  const record = await McpMigrationRecord.load(nodeMcpMigrationFs, homeDir).catch(() => undefined)
  const details: McpMigrationFailureDetails = {
    cause: input.error instanceof ProcessFileLockTimeoutError ? 'wait' : 'content',
    // Not decided yet, or an MCP setup to keep: old on/off state waits to be applied.
    keepsLegacyState: record?.legacyProjects !== null,
  }
  for (const filePath of migratedMcpFiles(homeDir, projectPath ? [projectPath] : [])) {
    if (record?.isFileMigrated(filePath)) continue
    recordMcpFileMigrationOutcome(filePath, error, details)
  }
}
