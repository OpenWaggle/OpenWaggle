import { homedir } from 'node:os'
import { getAgentDir } from '@mariozechner/pi-coding-agent'
import { Effect, Layer } from 'effect'
import { McpConfigService } from '../../ports/mcp-config-service'
import { installMcpAdapterPackage } from './mcp-config/adapter-package'

export { resolveCopyableBundledMcpAdapterPackageDir } from './mcp-config/adapter-package'

import {
  createPiMcpConfigService,
  createPiMcpConfigServiceForTests,
} from './mcp-config/service-factory'
export { createPiMcpConfigService, createPiMcpConfigServiceForTests }
export {
  getOpenWaggleMcpRuntimeContextForServices,
  prepareOpenWaggleMcpRuntimeContext,
  rememberOpenWaggleMcpRuntimeContext,
  withOpenWaggleMcpAdapterProcessContext,
} from './mcp-config/runtime-context'
export type {
  OpenWaggleMcpRuntimeContext,
  PiMcpConfigServiceForTests,
} from './mcp-config/types'

function createLivePiMcpConfigService() {
  return createPiMcpConfigService({
    homeDir: homedir(),
    agentDir: getAgentDir(),
    installAdapterPackage: installMcpAdapterPackage,
  })
}

export const PiMcpConfigServiceLive = Layer.succeed(McpConfigService, {
  getView: (projectPath) =>
    Effect.promise(() => createLivePiMcpConfigService().getView(projectPath)),
  setAdapterEnabled: (input) =>
    Effect.promise(() =>
      createLivePiMcpConfigService().setAdapterEnabled(input.enabled, input.projectPath),
    ),
  setServerEnabled: (input) =>
    Effect.promise(() => createLivePiMcpConfigService().setServerEnabled(input)),
  writeSourceConfig: (input) =>
    Effect.promise(() => createLivePiMcpConfigService().writeSourceConfig(input)),
})
