import { Effect } from 'effect'
import type { McpImportServiceShape } from '../../ports/mcp-import-service'

/**
 * Runs the one-time ADR 0050 migration before an import reads OpenWaggle's files, so an import
 * previews and writes against the migrated files (taken names, earlier imports), not old ones
 * the migration would rewrite afterwards.
 */
export function migrateBeforeImports(
  service: McpImportServiceShape,
  migrate: (projectPath: string | null) => Promise<unknown>,
): McpImportServiceShape {
  const migrated = (projectPath: string | null) =>
    Effect.promise(() => migrate(projectPath).catch(() => undefined))
  return {
    preview: (input) =>
      migrated(input.projectPath).pipe(
        Effect.zipRight(Effect.suspend(() => service.preview(input))),
      ),
    apply: (input, write) =>
      migrated(input.projectPath).pipe(
        Effect.zipRight(Effect.suspend(() => service.apply(input, write))),
      ),
  }
}
