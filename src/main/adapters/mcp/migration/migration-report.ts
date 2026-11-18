/** What one run of the MCP file migration did (`migrateOpenWaggleMcpFiles`). */
import type { McpServerMigrationChange } from './entry-migration'
import type { McpOAuthMigrationResult } from './oauth-state-migration'

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
  /** Projects left alone as their folder is gone; each migrates once it is back. */
  readonly goneProjects?: readonly string[]
}
