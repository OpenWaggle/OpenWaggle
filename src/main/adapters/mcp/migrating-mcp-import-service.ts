import { Effect } from 'effect'
import type { McpImportServiceShape } from '../../ports/mcp-import-service'
import { mcpWriteRefusal, type PendingMcpMigrationLookup } from './config/mcp-write-refusal'

/**
 * Runs the one-time ADR 0051 migration before an import reads OpenWaggle's files, so an import
 * previews and writes against the migrated files (taken names, earlier imports), not old ones
 * the migration would rewrite afterwards.
 */
export function migrateBeforeImports(
  service: McpImportServiceShape,
  migrate: (projectPath: string | null) => Promise<unknown>,
  options: {
    /**
     * While true (the Session Host drains), a preview reads the current files without the
     * migration, so it never holds the drain open. Applying is refused during a drain anyway.
     */
    readonly skipReadsWhile?: () => boolean
    /** The scope's OpenWaggle file whose migration is still failing, if any. */
    readonly pendingMigration?: PendingMcpMigrationLookup
  } = {},
): McpImportServiceShape {
  const migrated = (projectPath: string | null) =>
    Effect.promise(() => migrate(projectPath).catch(() => undefined))
  return {
    preview: (input) =>
      Effect.suspend(() =>
        options.skipReadsWhile?.()
          ? service.preview(input)
          : migrated(input.projectPath).pipe(
              Effect.zipRight(Effect.suspend(() => service.preview(input))),
            ),
      ),
    apply: (input, write) =>
      migrated(input.projectPath).pipe(
        Effect.zipRight(
          Effect.suspend(() => {
            // An import written before the migration succeeds would be undone by it.
            const scope = input.target === 'global' ? 'global' : 'all'
            const refusal = mcpWriteRefusal(options.pendingMigration?.(input.projectPath, scope))
            return refusal ? Effect.fail(refusal) : service.apply(input, write)
          }),
        ),
      ),
  }
}
