import { homedir } from 'node:os'
import { Layer } from 'effect'
import { isMcpHostDraining } from '../../../mcp-host-draining'
import {
  McpConfigurationService,
  type McpConfigurationServiceShape,
} from '../../../ports/mcp-configuration-service'
import { McpImportService } from '../../../ports/mcp-import-service'
import { createFilesystemMcpConfigurationService } from '../../mcp/config/filesystem-mcp-configuration-service'
import { loadMcpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'
import {
  migrateBeforeEachCall,
  withRuntimeConfigErrors,
} from '../../mcp/config/migrating-mcp-configuration-service'
import { checkMcpVaultSecret } from '../../mcp/encrypted-mcp-secret-vault-service'
import { createFilesystemMcpImportService } from '../../mcp/filesystem-mcp-import-service'
import { migrateBeforeImports } from '../../mcp/migrating-mcp-import-service'
import { getPiAgentDir } from '../pi-provider-catalog'
import { durableMcpProjectPaths, migrateOpenWaggleMcpFilesOnce } from './openwaggle-mcp-migration'

let service: McpConfigurationServiceShape | undefined

/**
 * The Host's one MCP configuration service, so a change saved by Pi's `/mcp` inside a Run and one
 * saved from Settings reach the same listeners. Its view checks that vault secrets exist without
 * decrypting them (`checkMcpVaultSecret`).
 */
export function getOpenWaggleMcpConfigurationService() {
  service ??= withRuntimeConfigErrors(
    migrateBeforeEachCall(
      createFilesystemMcpConfigurationService({
        homeDir: homedir(),
        piAgentDir: getPiAgentDir(),
        // Not managed worktrees: their files are the user's checkout.
        knownProjectPaths: durableMcpProjectPaths,
      }),
      migrateOpenWaggleMcpFilesOnce,
      { skipReadsWhile: isMcpHostDraining },
    ),
    async (projectPath) => {
      const config = await loadMcpRuntimeConfig({
        roots: { homeDir: homedir(), piAgentDir: getPiAgentDir(), projectPath },
        resolveSecret: checkMcpVaultSecret,
      })
      // Settings shows a missing secret on the server's row ("Needs secret X") instead.
      return {
        errors: config.loaded.errors,
        missingSecretErrors: [...config.missingSecrets.values()],
      }
    },
  )
  return service
}

/** The importer for the Host, with Pi's agent directory where `PI_CODING_AGENT_DIR` puts it. */
export const OpenWaggleMcpImportServiceLive = Layer.sync(McpImportService, () =>
  McpImportService.of(
    migrateBeforeImports(
      createFilesystemMcpImportService({ homeDir: homedir(), piAgentDir: getPiAgentDir() }),
      migrateOpenWaggleMcpFilesOnce,
      { skipReadsWhile: isMcpHostDraining },
    ),
  ),
)

export const OpenWaggleMcpConfigurationServiceLive = Layer.sync(McpConfigurationService, () =>
  getOpenWaggleMcpConfigurationService(),
)
