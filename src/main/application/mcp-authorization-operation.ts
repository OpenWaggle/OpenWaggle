import * as Effect from 'effect/Effect'
import { authorizeMcpServer } from '../adapters/mcp/oauth-provider'
import { mcpOAuthVaultAuthority } from '../adapters/mcp/oauth-vault-authority'
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

function cancellableAuthorization<A>(operation: (signal: AbortSignal) => Promise<A>) {
  return Effect.async<A, Error>((resume) => {
    const controller = new AbortController()
    const promise = operation(controller.signal)
    void promise.then(
      (result) => resume(Effect.succeed(result)),
      (error: unknown) =>
        resume(Effect.fail(error instanceof Error ? error : new Error(String(error)))),
    )
    return Effect.promise(async () => {
      controller.abort(new Error('MCP OAuth authorization was cancelled.'))
      await promise.catch(() => undefined)
    })
  })
}

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
    return yield* withMcpManagementWrite(
      Effect.gen(function* () {
        const server = yield* config.getServerDefinition(input)
        return yield* cancellableAuthorization(async (signal) => {
          const rawVault = {
            resolve: (name: string) => Effect.runPromise(vault.resolve(name)),
            set: (name: string, value: string) => Effect.runPromise(vault.set({ name, value })),
            remove: (name: string) => Effect.runPromise(vault.remove({ name })),
          }
          const authorization = mcpOAuthVaultAuthority.beginAuthorization(
            server.instanceId,
            rawVault,
          )
          try {
            let result: Awaited<ReturnType<typeof authorizeMcpServer>> | undefined
            let authorizationError: unknown
            try {
              result = await authorizeMcpServer({
                ...server,
                vault: authorization.vault,
                openExternal,
                signal,
              })
            } catch (error) {
              authorizationError = error
            }
            try {
              // beginAuthorization advances the server's credential generation before the
              // browser flow starts. Reconcile even when the flow is cancelled or fails before
              // writing so providers from the previous generation cannot remain authoritative.
              await Effect.runPromise(runtime.reconcileIdleConnections())
            } catch (reconciliationError) {
              if (!authorizationError) throw reconciliationError
              logger.error('MCP reconciliation failed after OAuth authorization ended.', {
                error:
                  reconciliationError instanceof Error
                    ? reconciliationError.message
                    : String(reconciliationError),
              })
            }
            if (authorizationError) throw authorizationError
            if (!result) throw new Error('MCP authorization completed without a result.')
            return result
          } finally {
            await authorization.finish()
          }
        })
      }),
    )
  })
}
