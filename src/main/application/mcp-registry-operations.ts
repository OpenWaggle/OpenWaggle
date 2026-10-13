import {
  mcpRegistryInstallRequestSchema,
  mcpRegistrySearchRequestSchema,
  mcpRegistryServerRequestSchema,
} from '@shared/schemas/mcp-registry'
import type { McpWriteDestination } from '@shared/types/mcp-configuration'
import type { McpRegistryInstallResultView } from '@shared/types/mcp-registry'
import * as Effect from 'effect/Effect'
import { mcpNamespace } from '../domain/mcp/config/mcp-server-config'
import { withServerSecretNames } from '../domain/mcp/config/mcp-server-secret-names'
import { McpConfigurationError, McpConfigurationService } from '../ports/mcp-configuration-service'
import { McpRegistryService } from '../ports/mcp-registry-service'
import { McpSecretVaultService } from '../ports/mcp-secret-vault-service'
import { decodeMcpProjectRequest, decodeMcpRequest } from './mcp-configuration-operations'

/**
 * MCP Registry search and install for Settings > MCP and `openwaggle mcp registry`. An install is
 * an ordinary Pi entry saved to OpenWaggle's MCP file for the chosen scope (ADR 0051); nothing
 * else is recorded about where it came from.
 */

export function searchMcpRegistryOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decodeMcpRequest(mcpRegistrySearchRequestSchema, raw, 'registry search')
    const registry = yield* McpRegistryService
    return yield* registry.search(input)
  })
}

export function getMcpRegistryServerOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decodeMcpRequest(mcpRegistryServerRequestSchema, raw, 'registry lookup')
    const registry = yield* McpRegistryService
    return yield* registry.getServer(input)
  })
}

/** Pi treats names that differ only in `-` and `_` as one server, so they count as taken. */
function assertNameFree(projectPath: string | null, name: string) {
  return Effect.gen(function* () {
    const configuration = yield* McpConfigurationService
    const view = yield* configuration.getView({ projectPath })
    const existing = view.servers.find((server) => mcpNamespace(server.name) === mcpNamespace(name))
    if (!existing) return
    return yield* new McpConfigurationError({
      reason: 'validation',
      message: `An MCP server named "${existing.name}" is already configured in ${existing.source.path}. Choose another name.`,
    })
  })
}

export function installMcpRegistryServerOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decodeMcpProjectRequest(
      mcpRegistryInstallRequestSchema,
      raw,
      'registry install',
    )
    const { projectPath, scope } = input
    if (scope === 'project' && projectPath === null) {
      return yield* new McpConfigurationError({
        reason: 'validation',
        message: 'Choose a project to install a server for that project only.',
      })
    }
    // A chosen name is checked before anything is downloaded.
    if (input.serverName) yield* assertNameFree(projectPath, input.serverName)
    const registry = yield* McpRegistryService
    const prepared = yield* registry.prepareEntry(input)
    const name = input.serverName ?? prepared.suggestedName
    if (!input.serverName) yield* assertNameFree(projectPath, name)
    const destination: McpWriteDestination =
      scope === 'global' ? 'openwaggle-global' : 'project-openwaggle'
    const scoped = withServerSecretNames(prepared.entry, name)
    const configuration = yield* McpConfigurationService
    yield* Effect.uninterruptible(
      configuration.addServer({
        projectPath,
        name,
        scope,
        destination,
        entry: { ...scoped.entry, ...(input.exposure ? { exposure: input.exposure } : {}) },
      }),
    )
    // Listing the vault reads no secret; a vault that cannot be listed reports none as existing.
    const stored = yield* (yield* McpSecretVaultService).list().pipe(Effect.orElseSucceed(() => []))
    const storedNames = new Set(stored.map((secret) => secret.name))
    const view = yield* configuration.getView({ projectPath })
    const filePath = view.files.find((file) => file.fileId === destination)?.path ?? destination
    return {
      name,
      filePath,
      secrets: scoped.secrets,
      existingSecrets: scoped.secrets.filter((secret) => storedNames.has(secret)),
      optionalSecrets: prepared.optionalSecrets,
      optionalSecretArguments: prepared.optionalSecretArguments,
      optionalSecretsNeedContainerEnv: prepared.optionalSecretsNeedContainerEnv,
      view,
    } satisfies McpRegistryInstallResultView
  })
}
