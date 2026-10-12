/**
 * When the migration could not run at all (another process kept its lock past the wait, say),
 * OpenWaggle's files it has not migrated yet must not load: in the old format, without the
 * `enabled` overrides, servers the old OpenWaggle had off would start. Each such file is gated as
 * failed until a later run migrates it (`migration-health.ts`). The failure is logged too.
 */

import type { Logger } from '@shared/types/logger'
import { nodeMcpMigrationFs } from './migration-fs'
import { recordMcpFileMigrationOutcome } from './migration-health'
import { globalMcpPaths, projectMcpPaths } from './migration-paths'
import { McpMigrationRecord } from './migration-record'

export async function gateUnmigratedMcpFiles(input: {
  readonly homeDir: string
  readonly projectPath: string | null
  readonly error: unknown
  readonly logger: Logger
}) {
  const { homeDir, projectPath } = input
  const error = input.error instanceof Error ? input.error.message : String(input.error)
  input.logger.error('MCP migration failed; it is tried again later', { projectPath, error })
  const files = [
    globalMcpPaths(homeDir).openwaggleGlobal,
    ...(projectPath ? [projectMcpPaths(projectPath).openwaggle] : []),
  ]
  // Read without the lock: a file already recorded as migrated stays loadable.
  const record = await McpMigrationRecord.load(nodeMcpMigrationFs, homeDir).catch(() => undefined)
  for (const filePath of files) {
    if (record?.isFileMigrated(filePath)) continue
    recordMcpFileMigrationOutcome(filePath, error)
  }
}
