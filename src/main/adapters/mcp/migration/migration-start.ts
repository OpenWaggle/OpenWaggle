/**
 * What a migration run reads first: its record and the old OpenWaggle's state. An error in either
 * names the file it came from, so the user is told which file to fix, not the migrated one.
 */
import { parseLegacyState } from './legacy-state'
import type { McpMigrationFs } from './migration-fs'
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
