import { homedir } from 'node:os'
import { Layer } from 'effect'
import {
  McpConfigurationService,
  type McpConfigurationServiceShape,
} from '../../../ports/mcp-configuration-service'
import { createFilesystemMcpConfigurationService } from '../../mcp/config/filesystem-mcp-configuration-service'
import { loadMcpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'
import {
  migrateBeforeEachCall,
  withRuntimeConfigErrors,
} from '../../mcp/config/migrating-mcp-configuration-service'
import { resolveMcpVaultSecret } from '../../mcp/encrypted-mcp-secret-vault-service'
import { getPiAgentDir } from '../pi-provider-catalog'
import { migrateOpenWaggleMcpFilesOnce } from './openwaggle-mcp-migration'

let service: McpConfigurationServiceShape | undefined

/**
 * The Host's one MCP configuration service, so a change saved by Pi's `/mcp` inside a Run and one
 * saved from Settings reach the same listeners.
 */
export function getOpenWaggleMcpConfigurationService() {
  service ??= withRuntimeConfigErrors(
    migrateBeforeEachCall(
      createFilesystemMcpConfigurationService({ homeDir: homedir(), piAgentDir: getPiAgentDir() }),
      migrateOpenWaggleMcpFilesOnce,
    ),
    async (projectPath) =>
      (
        await loadMcpRuntimeConfig({
          roots: { homeDir: homedir(), piAgentDir: getPiAgentDir(), projectPath },
          resolveSecret: resolveMcpVaultSecret,
        })
      ).loaded.errors,
  )
  return service
}

export const OpenWaggleMcpConfigurationServiceLive = Layer.sync(McpConfigurationService, () =>
  getOpenWaggleMcpConfigurationService(),
)
