import * as Effect from 'effect/Effect'
import { mcpOAuthVaultKey } from '../domain/mcp/oauth-vault-key'
import { McpConfigService } from '../ports/mcp-config-service'
import { McpRuntimeService } from '../ports/mcp-runtime-service'
import { McpSecretVaultService } from '../ports/mcp-secret-vault-service'
import { validateRequiredProjectPath } from '../utils/project-path-validation'
import {
  decodeMcpOperationInput,
  mcpAddServerSchema,
  mcpGetSettingsSchema,
  mcpImportApplySchema,
  mcpImportPreviewSchema,
  mcpRemoveSecretSchema,
  mcpRemoveServerSchema,
  mcpSetProjectServerEnabledSchema,
  mcpSetScopeStateSchema,
  mcpSetSecretSchema,
  mcpSetServerEnabledSchema,
  mcpSetServerTrustSchema,
  mcpWriteSourceConfigSchema,
  validateMcpProjectInput,
} from './mcp-operation-validation'
import { reconcileMcpRuntimeSettings, withMcpRuntimeSettings } from './mcp-runtime-settings'

export function getMcpSettingsOperation(raw: unknown = {}) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpGetSettingsSchema, raw, 'settings read')
    const input = yield* validateMcpProjectInput(decoded)
    const service = yield* McpConfigService
    const view = yield* service.getView(input)
    return yield* input.reconcileRuntime
      ? reconcileMcpRuntimeSettings(view)
      : withMcpRuntimeSettings(view)
  })
}

export function setMcpScopeStateOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpSetScopeStateSchema, raw, 'scope toggle')
    const input = yield* validateMcpProjectInput(decoded)
    const service = yield* McpConfigService
    return yield* Effect.uninterruptible(
      service.setScopeState(input).pipe(Effect.flatMap(reconcileMcpRuntimeSettings)),
    )
  })
}

export function setMcpServerEnabledOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpSetServerEnabledSchema, raw, 'server toggle')
    const input = yield* validateMcpProjectInput(decoded)
    const service = yield* McpConfigService
    return yield* Effect.uninterruptible(
      service.setServerEnabled(input).pipe(Effect.flatMap(reconcileMcpRuntimeSettings)),
    )
  })
}

export function setMcpProjectServerEnabledOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(
      mcpSetProjectServerEnabledSchema,
      raw,
      'project server toggle',
    )
    const projectPath = yield* validateRequiredProjectPath(decoded.projectPath)
    const service = yield* McpConfigService
    return yield* Effect.uninterruptible(
      service
        .setProjectServerEnabled({ ...decoded, projectPath })
        .pipe(Effect.flatMap(reconcileMcpRuntimeSettings)),
    )
  })
}

export function setMcpServerTrustOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpSetServerTrustSchema, raw, 'server trust')
    const input = yield* validateMcpProjectInput(decoded)
    const service = yield* McpConfigService
    return yield* Effect.uninterruptible(
      service.setServerTrust(input).pipe(Effect.flatMap(reconcileMcpRuntimeSettings)),
    )
  })
}

export function writeMcpSourceConfigOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpWriteSourceConfigSchema, raw, 'source write')
    const input = yield* validateMcpProjectInput(decoded)
    const service = yield* McpConfigService
    return yield* Effect.uninterruptible(
      service.writeSourceConfig(input).pipe(Effect.flatMap(reconcileMcpRuntimeSettings)),
    )
  })
}

export function removeMcpServerOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpRemoveServerSchema, raw, 'server removal')
    const input = yield* validateMcpProjectInput(decoded)
    const service = yield* McpConfigService
    return yield* Effect.uninterruptible(
      service.removeServer(input).pipe(Effect.flatMap(reconcileMcpRuntimeSettings)),
    )
  })
}

export function addMcpServerOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpAddServerSchema, raw, 'server add')
    const input = yield* validateMcpProjectInput(decoded)
    const service = yield* McpConfigService
    return yield* Effect.uninterruptible(
      service.addServer(input).pipe(Effect.flatMap(reconcileMcpRuntimeSettings)),
    )
  })
}

export function previewMcpImportsOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpImportPreviewSchema, raw, 'import preview')
    const input = yield* validateMcpProjectInput(decoded)
    return yield* (yield* McpConfigService).previewImports(input)
  })
}

export function applyMcpImportsOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpImportApplySchema, raw, 'import apply')
    const input = yield* validateMcpProjectInput(decoded)
    const service = yield* McpConfigService
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const result = yield* service.applyImports(input)
        const view = yield* reconcileMcpRuntimeSettings(result.view)
        return { ...result, view }
      }),
    )
  })
}

export function doctorMcpOperation(raw: unknown = {}) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpGetSettingsSchema, raw, 'doctor')
    const input = yield* validateMcpProjectInput(decoded)
    return yield* (yield* McpRuntimeService).doctor(input)
  })
}

export function listMcpSecretsOperation() {
  return Effect.gen(function* () {
    return yield* (yield* McpSecretVaultService).list()
  })
}

export function setMcpSecretOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decodeMcpOperationInput(mcpSetSecretSchema, raw, 'secret write')
    const vault = yield* McpSecretVaultService
    const runtime = yield* McpRuntimeService
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const summaries = yield* vault.set(input)
        yield* runtime.reconcileIdleConnections()
        return summaries
      }),
    )
  })
}

export function removeMcpSecretOperation(raw: unknown) {
  return Effect.gen(function* () {
    const input = yield* decodeMcpOperationInput(mcpRemoveSecretSchema, raw, 'secret removal')
    const vault = yield* McpSecretVaultService
    const runtime = yield* McpRuntimeService
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const summaries = yield* vault.remove(input)
        yield* runtime.reconcileIdleConnections()
        return summaries
      }),
    )
  })
}

export function logoutMcpServerOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(mcpRemoveServerSchema, raw, 'server logout')
    const input = yield* validateMcpProjectInput(decoded)
    const server = yield* (yield* McpConfigService).getServerDefinition(input)
    const vault = yield* McpSecretVaultService
    const runtime = yield* McpRuntimeService
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* vault.remove({ name: mcpOAuthVaultKey(server.instanceId) })
        yield* runtime.reconcileIdleConnections()
        return { loggedOut: true as const }
      }),
    )
  })
}
