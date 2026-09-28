import { homedir } from 'node:os'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { Effect, Layer } from 'effect'
import { app, safeStorage } from 'electron'
import { McpRuntimeService } from '../../ports/mcp-runtime-service'
import { McpSecretVaultService } from '../../ports/mcp-secret-vault-service'
import { McpTurnStateService } from '../../ports/mcp-turn-state-service'
import { createOpenWaggleRuntimeAuthProvider } from './oauth-provider'
import { mcpOAuthVaultAuthority } from './oauth-vault-authority'
import { createEncryptedMcpToolCatalogCache } from './runtime/encrypted-tool-catalog-cache'
import { FileMcpRemoteTaskStore } from './runtime/remote-task-store'
import { makeMcpRuntimeService } from './runtime/runtime-service-factory'
import { createFirstPartyMcpConnectionFactory } from './runtime/sdk-client-connection'

/**
 * The encrypted tool list cache, in app data rather than ~/.openwaggle: each OpenWaggle channel
 * seals with its own key, and one channel's lists must not replace another's (ADR 0032). Outside
 * the Electron app there is no app data directory, and the runtime keeps the lists in memory.
 */
function toolCatalogCacheOption() {
  if (typeof app?.getPath !== 'function') return {}
  return {
    toolCatalogCache: createEncryptedMcpToolCatalogCache({
      filePath: path.join(app.getPath('userData'), ...MCP_CONFIG.TOOL_CATALOG_FILE_PATH),
      encryption: safeStorage,
    }),
  }
}

export const FirstPartyMcpRuntimeServiceLive = Layer.scoped(
  McpRuntimeService,
  Effect.gen(function* () {
    const vault = yield* McpSecretVaultService
    const turnState = yield* McpTurnStateService
    // The MCP SDK OAuth provider is a vendor callback that needs a Promise vault.
    const oauthVault = {
      resolve: (name: string) => Effect.runPromise(vault.resolve(name)),
      set: (name: string, value: string) => Effect.runPromise(vault.set({ name, value })),
      remove: (name: string) => Effect.runPromise(vault.remove({ name })),
    }
    return yield* Effect.acquireRelease(
      makeMcpRuntimeService({
        turnState,
        remoteTaskStore: new FileMcpRemoteTaskStore(
          path.join(homedir(), ...MCP_CONFIG.GLOBAL_STATE_DIR, MCP_CONFIG.GLOBAL_TASK_FILE_NAME),
        ),
        ...toolCatalogCacheOption(),
        connect: createFirstPartyMcpConnectionFactory({
          clientVersion: typeof app.getVersion === 'function' ? app.getVersion() : '0.0.0-test',
          resolveSecret: (name) => Effect.runPromise(vault.resolve(name)),
          createAuthProvider: (server) =>
            createOpenWaggleRuntimeAuthProvider({
              instanceId: server.instanceId,
              definition: server.definition,
              vault: mcpOAuthVaultAuthority.runtimeVault(server.instanceId, oauthVault),
            }),
        }),
      }),
      (service) => service.disposeAll(),
    )
  }),
)

export { makeMcpRuntimeService } from './runtime/runtime-service-factory'
