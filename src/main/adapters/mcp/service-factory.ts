import { randomUUID } from 'node:crypto'
import { McpConfigContextStore } from './config-context-store'
import { McpConfigMutations } from './config-mutations'
import type { McpFilesystemConfigServiceOptions } from './config-types'

export function createFilesystemMcpConfigService(options: McpFilesystemConfigServiceOptions) {
  const store = new McpConfigContextStore(options)
  const mutations = new McpConfigMutations(store)
  return {
    getServerDefinition: store.getServerDefinition.bind(store),
    getView: store.getView.bind(store),
    setScopeState: store.setScopeState.bind(store),
    setServerEnabled: store.setServerEnabled.bind(store),
    setServerTrust: store.setServerTrust.bind(store),
    writeSourceConfig: store.writeSourceConfig.bind(store),
    createTurnSnapshot: store.createTurnSnapshot.bind(store),
    removeServer: mutations.removeServer.bind(mutations),
    addServer: mutations.addServer.bind(mutations),
    previewImports: mutations.previewImports.bind(mutations),
    applyImports: mutations.applyImports.bind(mutations),
  }
}

export function createFilesystemMcpConfigServiceForTests(options: {
  readonly homeDir: string
  readonly createId?: () => string
}) {
  return createFilesystemMcpConfigService({
    homeDir: options.homeDir,
    createId: options.createId ?? randomUUID,
  })
}
