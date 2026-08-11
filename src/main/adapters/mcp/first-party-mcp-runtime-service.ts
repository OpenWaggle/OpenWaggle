import { homedir } from 'node:os'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { Effect, Layer } from 'effect'
import { app } from 'electron'
import { McpRuntimeService } from '../../ports/mcp-runtime-service'
import { McpSecretVaultService } from '../../ports/mcp-secret-vault-service'
import { McpTurnStateService } from '../../ports/mcp-turn-state-service'
import { createOpenWaggleRuntimeAuthProvider } from './oauth-provider'
import { FileMcpRemoteTaskStore } from './runtime/remote-task-store'
import { makeMcpRuntimeService } from './runtime/runtime-service-factory'
import { createFirstPartyMcpConnectionFactory } from './runtime/sdk-client-connection'

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
        connect: createFirstPartyMcpConnectionFactory({
          clientVersion: typeof app.getVersion === 'function' ? app.getVersion() : '0.0.0-test',
          resolveSecret: (name) => Effect.runPromise(vault.resolve(name)),
          createAuthProvider: (server) =>
            createOpenWaggleRuntimeAuthProvider({
              instanceId: server.instanceId,
              definition: server.definition,
              vault: oauthVault,
            }),
        }),
      }),
      (service) => service.disposeAll(),
    )
  }),
)

export { makeMcpRuntimeService } from './runtime/runtime-service-factory'
