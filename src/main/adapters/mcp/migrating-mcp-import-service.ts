import { Effect } from 'effect'
import type { McpImportServiceShape } from '../../ports/mcp-import-service'
import {
  type McpLockTimeouts,
  mcpWriteRefusal,
  migrateNoting,
  migratePendingKeptProjects,
  type PendingKeptProjects,
  type PendingMcpMigrationLookup,
} from './config/mcp-write-refusal'

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
    /** Kept projects whose migration fails, which a global import migrates again first. */
    readonly pendingKeptProjects?: PendingKeptProjects
    /** The last migration lock timeout (`McpLockTimeouts`), to tell whether a call waited. */
    readonly lockTimeouts?: McpLockTimeouts
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
    apply: (input, write) => {
      const scope = input.target === 'global' ? 'global' : 'all'
      const again = (waitedForLock: boolean) =>
        migratePendingKeptProjects(scope, migrate, options.pendingKeptProjects, {
          projectPath: input.projectPath,
          waitedForLock,
        })
      const viewed = () => migrateNoting(options.lockTimeouts, () => migrate(input.projectPath))
      return Effect.promise(viewed).pipe(
        Effect.flatMap((waitedForLock) => Effect.promise(() => again(waitedForLock))),
        Effect.flatMap((waited) =>
          Effect.suspend(() => {
            // An import written before the migration succeeds would be undone by it.
            const refusal =
              mcpWriteRefusal(waited) ??
              mcpWriteRefusal(options.pendingMigration?.(input.projectPath, scope))
            return refusal ? Effect.fail(refusal) : service.apply(input, write)
          }),
        ),
      )
    },
  }
}
