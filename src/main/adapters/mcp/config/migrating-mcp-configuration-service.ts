import { Effect } from 'effect'
import type {
  McpConfigurationScopeInput,
  McpConfigurationServiceShape,
} from '../../../ports/mcp-configuration-service'

/**
 * Runs the one-time ADR 0048 migration (global files plus the requested project) before every
 * MCP configuration read or write. Settings and the CLI otherwise read and write files the
 * migration has not handled yet, and the migration a later Run starts would overwrite the user's
 * choices. The migration records each file, so after the first call this costs one record read.
 */
export function migrateBeforeEachCall(
  service: McpConfigurationServiceShape,
  migrate: (projectPath: string | null) => Promise<unknown>,
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
    getView: (input) => first(input, () => service.getView(input)),
    setServerEnabled: (input) => first(input, () => service.setServerEnabled(input)),
    setServerExposure: (input) => first(input, () => service.setServerExposure(input)),
    addServer: (input) => first(input, () => service.addServer(input)),
    removeServer: (input) => first(input, () => service.removeServer(input)),
    changed: (filePath) => service.changed(filePath),
    onChange: (listener) => service.onChange(listener),
  }
}
