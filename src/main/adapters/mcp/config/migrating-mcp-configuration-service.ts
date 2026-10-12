import { Effect } from 'effect'
import type {
  McpConfigurationError,
  McpConfigurationScopeInput,
  McpConfigurationServiceShape,
} from '../../../ports/mcp-configuration-service'
import {
  fileWriteScope,
  type McpWriteScope,
  mcpWriteRefusal,
  type PendingMcpMigrationLookup,
  serverWriteScope,
} from './mcp-write-refusal'

/**
 * Runs the one-time ADR 0051 migration (global files plus the requested project) before every
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
    /** The scope's OpenWaggle file whose migration is still failing, if any. */
    readonly pendingMigration?: PendingMcpMigrationLookup
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
  /** A write, once the files it may change are migrated: one made before would be undone. */
  function write(
    input: McpConfigurationScopeInput,
    scope: Effect.Effect<McpWriteScope, McpConfigurationError>,
    call: () => Effect.Effect<void, McpConfigurationError>,
  ) {
    return first(input, () =>
      Effect.flatMap(scope, (writeScope) => {
        const refusal = mcpWriteRefusal(options.pendingMigration?.(input.projectPath, writeScope))
        return refusal ? Effect.fail(refusal) : call()
      }),
    )
  }
  /** Where changing the named server writes, from the current files. */
  const serverScope = (input: McpConfigurationScopeInput & { readonly name: string }) =>
    options.pendingMigration
      ? Effect.map(service.getView(input), (view) =>
          serverWriteScope(view.servers.find((server) => server.name === input.name)),
        )
      : Effect.succeed<McpWriteScope>('all')
  return {
    getView: (input) =>
      Effect.suspend(() =>
        options.skipReadsWhile?.()
          ? service.getView(input)
          : first(input, () => service.getView(input)),
      ),
    setServerEnabled: (input) =>
      write(input, input.target === 'project' ? Effect.succeed('all') : serverScope(input), () =>
        service.setServerEnabled(input),
      ),
    setServerExposure: (input) =>
      write(input, serverScope(input), () => service.setServerExposure(input)),
    addServer: (input) =>
      write(input, Effect.succeed(input.scope === 'global' ? 'global' : 'all'), () =>
        service.addServer(input),
      ),
    // Removing a server also removes its orphaned overrides in project files.
    removeServer: (input) =>
      write(input, Effect.succeed('everywhere'), () => service.removeServer(input)),
    removeOrphanedOverride: (input) =>
      write(input, Effect.succeed(fileWriteScope(input.fileId)), () =>
        service.removeOrphanedOverride(input),
      ),
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
  runtimeErrors: (projectPath: string | null) => Promise<{
    readonly errors: readonly string[]
    /** Those of `errors` caused by a secret missing from the vault. */
    readonly missingSecretErrors?: readonly string[]
    /** The servers they leave out. */
    readonly missingSecretServers?: readonly string[]
  }>,
): McpConfigurationServiceShape {
  return {
    ...service,
    getView: (input) =>
      Effect.gen(function* () {
        const view = yield* service.getView(input)
        const extra = yield* Effect.promise(() =>
          runtimeErrors(input.projectPath).catch(
            (error: unknown): Awaited<ReturnType<typeof runtimeErrors>> => ({
              errors: [error instanceof Error ? error.message : String(error)],
            }),
          ),
        )
        const errors = [
          ...view.errors,
          ...extra.errors.filter((error) => !view.errors.includes(error)),
        ]
        const missing = extra.missingSecretErrors ?? []
        const servers = extra.missingSecretServers ?? []
        return {
          ...view,
          errors,
          ...(missing.length > 0 ? { missingSecretErrors: missing } : {}),
          ...(servers.length > 0 ? { missingSecretServers: servers } : {}),
        }
      }),
  }
}
