import { Effect } from 'effect'
import type {
  McpConfigurationScopeInput,
  McpConfigurationServiceShape,
} from '../../../ports/mcp-configuration-service'

/**
 * Runs the one-time ADR 0050 migration (global files plus the requested project) before every
 * MCP configuration read or write. Settings and the CLI otherwise read and write files the
 * migration has not handled yet, and the migration a later Run starts would overwrite the user's
 * choices. The migration records each file, so after the first call this costs one record read.
 */
export function migrateBeforeEachCall(
  service: McpConfigurationServiceShape,
  migrate: (projectPath: string | null) => Promise<unknown>,
  options: {
    /**
     * While true (the Session Host drains), a read answers from the current files without the
     * migration, so it never holds the drain open. Writes are refused during a drain anyway.
     */
    readonly skipReadsWhile?: () => boolean
  } = {},
): McpConfigurationServiceShape {
  function first<A, E>(
    input: McpConfigurationScopeInput,
    call: () => Effect.Effect<A, E>,
  ): Effect.Effect<A, E> {
    return Effect.promise(() => migrate(input.projectPath).catch(() => undefined)).pipe(
      Effect.zipRight(Effect.suspend(call)),
    )
  }
  return {
    getView: (input) =>
      Effect.suspend(() =>
        options.skipReadsWhile?.()
          ? service.getView(input)
          : first(input, () => service.getView(input)),
      ),
    setServerEnabled: (input) => first(input, () => service.setServerEnabled(input)),
    setServerExposure: (input) => first(input, () => service.setServerExposure(input)),
    addServer: (input) => first(input, () => service.addServer(input)),
    removeServer: (input) => first(input, () => service.removeServer(input)),
    removeOrphanedOverride: (input) => first(input, () => service.removeOrphanedOverride(input)),
    changed: (filePath) => service.changed(filePath),
    onChange: (listener) => service.onChange(listener),
  }
}

/**
 * Adds what only the runtime configuration knows to the view, such as a vault secret that cannot
 * be read (that server is left out of every Run), so Settings and `openwaggle mcp doctor` show it.
 */
export function withRuntimeConfigErrors(
  service: McpConfigurationServiceShape,
  runtimeErrors: (projectPath: string | null) => Promise<readonly string[]>,
): McpConfigurationServiceShape {
  return {
    ...service,
    getView: (input) =>
      Effect.gen(function* () {
        const view = yield* service.getView(input)
        const extra = yield* Effect.promise(() =>
          runtimeErrors(input.projectPath).catch((error: unknown) => [
            error instanceof Error ? error.message : String(error),
          ]),
        )
        const errors = [...view.errors, ...extra.filter((error) => !view.errors.includes(error))]
        return { ...view, errors }
      }),
  }
}
