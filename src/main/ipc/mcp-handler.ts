import * as Effect from 'effect/Effect'
import { authorizeMcpServer } from '../adapters/mcp/oauth-provider'
import { reconcileConfiguredMcpOwnerRuntime } from '../application/gui-session-command-router'
import {
  addMcpServerOperation,
  applyMcpImportsOperation,
  doctorMcpOperation,
  getMcpSettingsOperation,
  listMcpSecretsOperation,
  logoutMcpServerOperation,
  previewMcpImportsOperation,
  removeMcpSecretOperation,
  removeMcpServerOperation,
  setMcpProjectServerEnabledOperation,
  setMcpScopeStateOperation,
  setMcpSecretOperation,
  setMcpServerEnabledOperation,
  setMcpServerTrustOperation,
  writeMcpSourceConfigOperation,
} from '../application/mcp-management-operations'
import {
  decodeMcpOperationInput,
  mcpRemoveServerSchema,
  validateMcpProjectInput,
} from '../application/mcp-operation-validation'
import { openExternal } from '../desktop-ui'
import { createLogger } from '../logger'
import { McpConfigService } from '../ports/mcp-config-service'
import { McpRuntimeService } from '../ports/mcp-runtime-service'
import { McpSecretVaultService } from '../ports/mcp-secret-vault-service'
import { registerMcpCapabilityHandlers } from './mcp-capability-handler'
import { hostHandle, typedHandle } from './typed-ipc'

const logger = createLogger('ipc-mcp')

function registerMcpConfigHandlers() {
  hostHandle('mcp:get-settings', (_event, raw = {}) => getMcpSettingsOperation(raw))
  hostHandle('mcp:set-scope-state', (_event, raw: unknown) => setMcpScopeStateOperation(raw))
  hostHandle('mcp:set-server-enabled', (_event, raw: unknown) => setMcpServerEnabledOperation(raw))
  hostHandle('mcp:set-project-server-enabled', (_event, raw: unknown) =>
    setMcpProjectServerEnabledOperation(raw),
  )
  hostHandle('mcp:set-server-trust', (_event, raw: unknown) => setMcpServerTrustOperation(raw))
  hostHandle('mcp:write-source-config', (_event, raw: unknown) =>
    writeMcpSourceConfigOperation(raw),
  )
  hostHandle('mcp:remove-server', (_event, raw: unknown) => removeMcpServerOperation(raw))
  hostHandle('mcp:logout-server', (_event, raw: unknown) => logoutMcpServerOperation(raw))
}

function registerMcpAuthorizationHandlers() {
  typedHandle('mcp:authorize-server', (_event, raw: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeMcpOperationInput(
        mcpRemoveServerSchema,
        raw,
        'server authorization',
      )
      const input = yield* validateMcpProjectInput(decoded)
      const server = yield* (yield* McpConfigService).getServerDefinition(input)
      const vault = yield* McpSecretVaultService
      const runtime = yield* McpRuntimeService
      return yield* Effect.tryPromise({
        try: async () => {
          let vaultMutated = false
          let result: Awaited<ReturnType<typeof authorizeMcpServer>> | undefined
          let authorizationError: unknown
          try {
            result = await authorizeMcpServer({
              ...server,
              vault: {
                resolve: (name) => Effect.runPromise(vault.resolve(name)),
                set: async (name, value) => {
                  const summaries = await Effect.runPromise(vault.set({ name, value }))
                  vaultMutated = true
                  return summaries
                },
                remove: async (name) => {
                  const summaries = await Effect.runPromise(vault.remove({ name }))
                  vaultMutated = true
                  return summaries
                },
              },
              openExternal,
            })
          } catch (error) {
            authorizationError = error
          }
          if (result || vaultMutated) {
            try {
              const handled = await reconcileConfiguredMcpOwnerRuntime(input.projectPath)
              if (!handled) await Effect.runPromise(runtime.reconcileIdleConnections())
            } catch (reconciliationError) {
              if (!authorizationError) throw reconciliationError
              logger.error('MCP owner reconciliation failed after OAuth changed the vault.', {
                error:
                  reconciliationError instanceof Error
                    ? reconciliationError.message
                    : String(reconciliationError),
              })
            }
          }
          if (authorizationError) throw authorizationError
          if (!result) throw new Error('MCP authorization completed without a result.')
          return result
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
    }),
  )
}

function registerMcpDiscoveryHandlers() {
  hostHandle('mcp:add-server', (_event, raw: unknown) => addMcpServerOperation(raw))
  hostHandle('mcp:preview-imports', (_event, raw: unknown) => previewMcpImportsOperation(raw))
  hostHandle('mcp:apply-imports', (_event, raw: unknown) => applyMcpImportsOperation(raw))
  hostHandle('mcp:doctor', (_event, raw = {}) => doctorMcpOperation(raw))
}

function registerMcpSecretHandlers() {
  hostHandle('mcp:list-secrets', () => listMcpSecretsOperation())
  hostHandle('mcp:set-secret', (_event, raw: unknown) => setMcpSecretOperation(raw))
  hostHandle('mcp:remove-secret', (_event, raw: unknown) => removeMcpSecretOperation(raw))
}

export function registerMcpHandlers(): void {
  registerMcpConfigHandlers()
  registerMcpAuthorizationHandlers()
  registerMcpDiscoveryHandlers()
  registerMcpSecretHandlers()
  registerMcpCapabilityHandlers()
}
