import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { Effect, Layer } from 'effect'
import { McpConfigService } from '../../ports/mcp-config-service'
import { createFilesystemMcpConfigService } from './service-factory'

export { createFilesystemMcpConfigServiceForTests } from './service-factory'

const service = createFilesystemMcpConfigService({ homeDir: homedir(), createId: randomUUID })

export const FilesystemMcpConfigServiceLive = Layer.succeed(
  McpConfigService,
  McpConfigService.of({
    getServerDefinition: (input) => Effect.promise(() => service.getServerDefinition(input)),
    getView: (input) => Effect.promise(() => service.getView(input)),
    setScopeState: (input) => Effect.promise(() => service.setScopeState(input)),
    setServerEnabled: (input) => Effect.promise(() => service.setServerEnabled(input)),
    setServerTrust: (input) => Effect.promise(() => service.setServerTrust(input)),
    writeSourceConfig: (input) => Effect.promise(() => service.writeSourceConfig(input)),
    removeServer: (input) => Effect.promise(() => service.removeServer(input)),
    addServer: (input) => Effect.promise(() => service.addServer(input)),
    previewImports: (input) => Effect.promise(() => service.previewImports(input)),
    applyImports: (input) => Effect.promise(() => service.applyImports(input)),
    createTurnSnapshot: (input) => Effect.promise(() => service.createTurnSnapshot(input)),
  }),
)
