import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { Effect, Layer } from 'effect'
import { McpConfigService } from '../../ports/mcp-config-service'
import { McpTurnStateService } from '../../ports/mcp-turn-state-service'
import { createFilesystemMcpConfigService } from './service-factory'

export { createFilesystemMcpConfigServiceForTests } from './service-factory'

export const FilesystemMcpConfigServiceLive = Layer.effect(
  McpConfigService,
  Effect.gen(function* () {
    const turnState = yield* McpTurnStateService
    // Ref reads are synchronous; runSync bridges the shared turn-state service
    // into the Promise-based config store without an async boundary.
    const service = createFilesystemMcpConfigService({
      homeDir: homedir(),
      createId: randomUUID,
      getActiveTurn: (sessionId) => Effect.runSync(turnState.getActive(sessionId)),
    })
    return McpConfigService.of({
      getServerDefinition: (input) => Effect.promise(() => service.getServerDefinition(input)),
      getView: (input) => Effect.promise(() => service.getView(input)),
      setScopeState: (input) => Effect.promise(() => service.setScopeState(input)),
      setServerEnabled: (input) => Effect.promise(() => service.setServerEnabled(input)),
      setProjectServerEnabled: (input) =>
        Effect.promise(() => service.setProjectServerEnabled(input)),
      setServerTrust: (input) => Effect.promise(() => service.setServerTrust(input)),
      writeSourceConfig: (input) => Effect.promise(() => service.writeSourceConfig(input)),
      removeServer: (input) => Effect.promise(() => service.removeServer(input)),
      addServer: (input) => Effect.promise(() => service.addServer(input)),
      previewImports: (input) => Effect.promise(() => service.previewImports(input)),
      applyImports: (input) => Effect.promise(() => service.applyImports(input)),
      createTurnSnapshot: (input) => Effect.promise(() => service.createTurnSnapshot(input)),
    })
  }),
)
