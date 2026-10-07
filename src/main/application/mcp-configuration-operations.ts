import { MCP_CATALOG_SERVERS } from '@shared/constants/mcp'
import { type Schema, safeDecodeUnknown } from '@shared/schema'
import {
  mcpAddServerRequestSchema,
  mcpConfigurationScopeRequestSchema,
  mcpImportApplyRequestSchema,
  mcpImportPreviewRequestSchema,
  mcpInstallCatalogServerRequestSchema,
  mcpServerNameRequestSchema,
  mcpSetServerEnabledRequestSchema,
  mcpSetServerExposureRequestSchema,
} from '@shared/schemas/mcp-configuration'
import type { McpImportApplyResultView } from '@shared/types/mcp-configuration-operations'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { McpConfigurationError, McpConfigurationService } from '../ports/mcp-configuration-service'
import { McpImportService } from '../ports/mcp-import-service'
import { McpServerRuntimeService } from '../ports/mcp-server-runtime-service'
import { WorkspaceProjectAuthorization } from '../ports/workspace-project-authorization'

/**
 * Settings > MCP and `openwaggle mcp` operations over Pi's MCP files (ADR 0048). The Session Host
 * runs them for both the GUI and the CLI; every input is decoded here, at the Host boundary.
 * Writes answer with the configuration as it is afterwards, so a client never shows a stale list.
 */

const logger = createLogger('mcp-configuration-operation')

function decodePayload<A, I>(schema: Schema.Schema<A, I>, raw: unknown, action: string) {
  const decoded = safeDecodeUnknown(schema, raw)
  if (decoded.success) return Effect.succeed(decoded.data)
  const message = decoded.issues.join('; ')
  logger.warn(`Invalid MCP ${action} payload`, { error: message })
  return Effect.fail(new McpConfigurationError({ reason: 'validation', message }))
}

/**
 * Decodes a request and accepts its project only when OpenWaggle knows that project. A project's
 * MCP files can start commands, so neither the GUI nor the CLI may name an arbitrary directory.
 */
function decode<A extends { readonly projectPath: string | null }, I>(
  schema: Schema.Schema<A, I>,
  raw: unknown,
  action: string,
) {
  return Effect.gen(function* () {
    const input = yield* decodePayload(schema, raw, action)
    if (input.projectPath === null) return input
    const authorization = yield* WorkspaceProjectAuthorization
    const projectPath = yield* authorization.authorize(input.projectPath).pipe(
      Effect.mapError(
        () =>
          new McpConfigurationError({
            reason: 'validation',
            message: 'Open this project in OpenWaggle before changing its MCP servers.',
          }),
      ),
    )
    return { ...input, projectPath }
  })
}

function viewFor(projectPath: string | null) {
  return Effect.flatMap(McpConfigurationService, (service) => service.getView({ projectPath }))
}

/** Runs a write to completion, then reads the files again. */
function writeThenView<R>(
  projectPath: string | null,
  write: Effect.Effect<void, McpConfigurationError, R>,
) {
  return Effect.uninterruptible(write).pipe(Effect.zipRight(viewFor(projectPath)))
}

export function getMcpConfigurationOperation(raw: unknown) {
  return Effect.flatMap(
    decode(mcpConfigurationScopeRequestSchema, raw, 'configuration read'),
    (input) => viewFor(input.projectPath),
  )
}

export function setMcpServerEnabledOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decode(mcpSetServerEnabledRequestSchema, raw, 'enable')
    const service = yield* McpConfigurationService
    if (input.target === 'project' && !input.projectPath) {
      return yield* new McpConfigurationError({
        reason: 'validation',
        message: 'Choose a project to switch a server for that project only.',
      })
    }
    return yield* writeThenView(input.projectPath, service.setServerEnabled(input))
  })
}

export function setMcpServerExposureOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decode(mcpSetServerExposureRequestSchema, raw, 'exposure')
    const service = yield* McpConfigurationService
    return yield* writeThenView(input.projectPath, service.setServerExposure(input))
  })
}

export function addMcpServerOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decode(mcpAddServerRequestSchema, raw, 'add server')
    const service = yield* McpConfigurationService
    return yield* writeThenView(input.projectPath, service.addServer(input))
  })
}

export function removeMcpServerOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decode(mcpServerNameRequestSchema, raw, 'remove server')
    const service = yield* McpConfigurationService
    return yield* writeThenView(input.projectPath, service.removeServer(input))
  })
}

/** A catalog install is an ordinary entry, saved like any other new server. */
export function installMcpCatalogServerOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decode(mcpInstallCatalogServerRequestSchema, raw, 'catalog install')
    const item = MCP_CATALOG_SERVERS.find((candidate) => candidate.name === input.catalogName)
    if (!item) {
      return yield* new McpConfigurationError({
        reason: 'not-found',
        message: `No catalog server named "${input.catalogName}".`,
      })
    }
    const service = yield* McpConfigurationService
    return yield* writeThenView(
      input.projectPath,
      service.addServer({
        projectPath: input.projectPath,
        name: item.name,
        entry: item.entry,
        scope: input.scope,
        ...(input.destination ? { destination: input.destination } : {}),
      }),
    )
  })
}

export function inspectMcpServerOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decode(mcpServerNameRequestSchema, raw, 'inspect server')
    const runtime = yield* McpServerRuntimeService
    return yield* runtime.inspectServer(input)
  })
}

/** Settings > MCP on open: every server's state without connecting to any of them. */
export function getMcpServerStatusesOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decode(mcpConfigurationScopeRequestSchema, raw, 'server statuses')
    const runtime = yield* McpServerRuntimeService
    return yield* runtime.getServerStatuses(input)
  })
}

export function signInMcpServerOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decode(mcpServerNameRequestSchema, raw, 'sign-in')
    const runtime = yield* McpServerRuntimeService
    return yield* runtime.signIn(input)
  })
}

export function signOutMcpServerOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decode(mcpServerNameRequestSchema, raw, 'sign-out')
    const runtime = yield* McpServerRuntimeService
    yield* Effect.uninterruptible(runtime.signOut(input))
  })
}

export function previewMcpImportsOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decode(mcpImportPreviewRequestSchema, raw, 'import preview')
    const importer = yield* McpImportService
    return yield* importer.preview(input)
  })
}

export function applyMcpImportsOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decode(mcpImportApplyRequestSchema, raw, 'import')
    const importer = yield* McpImportService
    const service = yield* McpConfigurationService
    const result = yield* Effect.uninterruptible(
      importer.apply(input, (target, writes) =>
        Effect.forEach(
          writes,
          (write) =>
            service.addServer({
              projectPath: input.projectPath,
              name: write.name,
              entry: write.entry,
              scope: target,
            }),
          { discard: true },
        ),
      ),
    )
    const view = yield* service.getView({ projectPath: input.projectPath })
    return { ...result, view } satisfies McpImportApplyResultView
  })
}
