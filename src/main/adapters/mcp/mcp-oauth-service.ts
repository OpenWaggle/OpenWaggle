import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { openExternal } from '../../desktop-ui'
import { mcpOAuthVaultKey } from '../../domain/mcp/oauth-vault-key'
import { McpOAuthService } from '../../ports/mcp-oauth-service'
import { McpSecretVaultService } from '../../ports/mcp-secret-vault-service'
import { authorizeMcpServer } from './oauth-provider'
import { mcpOAuthVaultAuthority } from './oauth-vault-authority'

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

export const McpOAuthServiceLive = Layer.effect(
  McpOAuthService,
  Effect.gen(function* () {
    const vault = yield* McpSecretVaultService
    const rawVault = {
      resolve: (name: string) => Effect.runPromise(vault.resolve(name)),
      set: (name: string, value: string) => Effect.runPromise(vault.set({ name, value })),
      remove: (name: string) => Effect.runPromise(vault.remove({ name })),
    }
    return McpOAuthService.of({
      authorize: (server) =>
        cancellableAuthorization(async (signal) => {
          const authorization = mcpOAuthVaultAuthority.beginAuthorization(
            server.instanceId,
            rawVault,
          )
          try {
            return await authorizeMcpServer({
              ...server,
              vault: authorization.vault,
              openExternal,
              signal,
            })
          } finally {
            await authorization.finish()
          }
        }),
      revoke: (instanceId) =>
        Effect.tryPromise({
          try: () =>
            mcpOAuthVaultAuthority.revoke(instanceId, async () => {
              await Effect.runPromise(vault.remove({ name: mcpOAuthVaultKey(instanceId) }))
            }),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
    })
  }),
)
