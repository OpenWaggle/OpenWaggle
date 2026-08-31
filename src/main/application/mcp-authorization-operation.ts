import * as Effect from 'effect/Effect'
import { authorizeMcpServer } from '../adapters/mcp/oauth-provider'
import { openExternal } from '../desktop-ui'
import { createLogger } from '../logger'
import { McpConfigService } from '../ports/mcp-config-service'
import { McpRuntimeService } from '../ports/mcp-runtime-service'
import { McpSecretVaultService } from '../ports/mcp-secret-vault-service'
import { withMcpManagementWrite } from './mcp-management-operation-gate'
import {
  decodeMcpOperationInput,
  mcpRemoveServerSchema,
  validateMcpProjectInput,
} from './mcp-operation-validation'

const logger = createLogger('mcp-authorization')

/**
 * Authorize one configured MCP server under the owning process's management
 * writer lease. Resolving the server definition, mutating OAuth credentials,
 * and reconciling runtime clients are one identity-bound operation.
 */
export function authorizeMcpServerOperation(raw: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeMcpOperationInput(
      mcpRemoveServerSchema,
      raw,
      'server authorization',
    )
    const input = yield* validateMcpProjectInput(decoded)
    const config = yield* McpConfigService
    const vault = yield* McpSecretVaultService
    const runtime = yield* McpRuntimeService
    return yield* Effect.uninterruptible(
      withMcpManagementWrite(
        Effect.gen(function* () {
          const server = yield* config.getServerDefinition(input)
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
                  await Effect.runPromise(runtime.reconcileIdleConnections())
                } catch (reconciliationError) {
                  if (!authorizationError) throw reconciliationError
                  logger.error('MCP reconciliation failed after OAuth changed the vault.', {
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
      ),
    )
  })
}
