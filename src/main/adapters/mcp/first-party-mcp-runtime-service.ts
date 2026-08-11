import { homedir } from 'node:os'
import path from 'node:path'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { Effect, Layer } from 'effect'
import { app } from 'electron'
import { McpRuntimeService } from '../../ports/mcp-runtime-service'
import { McpSecretVaultService } from '../../ports/mcp-secret-vault-service'
import { createOpenWaggleRuntimeAuthProvider } from './oauth-provider'
import { FileMcpRemoteTaskStore } from './runtime/remote-task-store'
import { createMcpRuntimeService } from './runtime/runtime-service-factory'
import { createFirstPartyMcpConnectionFactory } from './runtime/sdk-client-connection'

export const FirstPartyMcpRuntimeServiceLive = Layer.scoped(
  McpRuntimeService,
  Effect.gen(function* () {
    const vault = yield* McpSecretVaultService
    const oauthVault = {
      resolve: (name: string) => Effect.runPromise(vault.resolve(name)),
      set: (name: string, value: string) => Effect.runPromise(vault.set({ name, value })),
      remove: (name: string) => Effect.runPromise(vault.remove({ name })),
    }
    const service = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createMcpRuntimeService({
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
      ),
      (runtime) => Effect.promise(() => runtime.disposeAll()),
    )

    return McpRuntimeService.of({
      prepareTurn: (input) => Effect.promise(() => service.prepareTurn(input)),
      completeTurn: (input) => Effect.promise(() => service.completeTurn(input)),
      executeGateway: (input) =>
        Effect.tryPromise({
          try: () =>
            service.executeGateway(input.snapshot, input.request, input.signal, input.interactions),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      listDirectTools: (snapshot) =>
        Effect.tryPromise({
          try: () => service.listDirectTools(snapshot),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      browseCapabilities: (input) =>
        Effect.tryPromise({
          try: () => service.browseCapabilities(input.snapshot, input.serverInstanceId),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      getPrompt: (input) =>
        Effect.tryPromise({
          try: () => service.getPrompt(input),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      readResource: (input) =>
        Effect.tryPromise({
          try: () => service.readResource(input),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      reviewRemoteSkill: (input) =>
        Effect.tryPromise({
          try: () => service.reviewRemoteSkill(input),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      callAppTool: (input) =>
        Effect.tryPromise({
          try: () => service.callAppTool(input),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      operateTask: (input) =>
        Effect.tryPromise({
          try: () => service.operateTask(input.snapshot, input.request),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      setEventSubscription: (input) =>
        Effect.tryPromise({
          try: () => service.setEventSubscription(input),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      getEvents: (sessionId) => Effect.promise(() => service.getEvents(sessionId)),
      getEventSubscriptions: (sessionId) =>
        Effect.promise(() => service.getEventSubscriptions(sessionId)),
      disposeSession: (sessionId) => Effect.promise(() => service.disposeSession(sessionId)),
      reconcileIdleConnections: () => Effect.promise(() => service.reconcileIdleConnections()),
      disposeAll: () => Effect.promise(() => service.disposeAll()),
      getConnectionStatuses: () => Effect.promise(() => service.getConnectionStatuses()),
      getNotices: (sessionId) => Effect.promise(() => service.getNotices(sessionId)),
      doctor: () => Effect.promise(() => service.doctor()),
    })
  }),
)

export { createMcpRuntimeService } from './runtime/runtime-service-factory'
