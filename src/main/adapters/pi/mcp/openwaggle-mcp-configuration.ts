import { homedir } from 'node:os'
import { Layer } from 'effect'
import {
  McpConfigurationService,
  type McpConfigurationServiceShape,
} from '../../../ports/mcp-configuration-service'
import { McpVaultError } from '../../../ports/mcp-errors'
import { McpImportService } from '../../../ports/mcp-import-service'
import { createFilesystemMcpConfigurationService } from '../../mcp/config/filesystem-mcp-configuration-service'
import { loadMcpRuntimeConfig } from '../../mcp/config/mcp-runtime-config'
import {
  migrateBeforeEachCall,
  withRuntimeConfigErrors,
} from '../../mcp/config/migrating-mcp-configuration-service'
import { mcpVaultHasSecret } from '../../mcp/encrypted-mcp-secret-vault-service'
import { createFilesystemMcpImportService } from '../../mcp/filesystem-mcp-import-service'
import { migrateBeforeImports } from '../../mcp/migrating-mcp-import-service'
import { getPiAgentDir } from '../pi-provider-catalog'
import { durableMcpProjectPaths, migrateOpenWaggleMcpFilesOnce } from './openwaggle-mcp-migration'

let service: McpConfigurationServiceShape | undefined

/** What stands for a vault secret the view only checks; its value is never shown or sent. */
const PRESENT_SECRET = 'vault-secret'

/**
 * The view only reports a secret that is missing, so it checks the vault without decrypting: a
 * slow or prompting keychain does not slow Settings or the CLI down. A Run still decrypts.
 */
async function checkVaultSecret(name: string) {
  if (await mcpVaultHasSecret(name)) return PRESENT_SECRET
  throw new McpVaultError({
    reason: 'secret-not-found',
    secretName: name,
    message: `MCP secret ${JSON.stringify(name)} was not found.`,
  })
}

/**
 * The Host's one MCP configuration service, so a change saved by Pi's `/mcp` inside a Run and one
 * saved from Settings reach the same listeners.
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
    ),
    async (projectPath) =>
      (
        await loadMcpRuntimeConfig({
          roots: { homeDir: homedir(), piAgentDir: getPiAgentDir(), projectPath },
          resolveSecret: checkVaultSecret,
        })
      ).loaded.errors,
  )
  return service
}

/** The importer for the Host, with Pi's agent directory where `PI_CODING_AGENT_DIR` puts it. */
export const OpenWaggleMcpImportServiceLive = Layer.sync(McpImportService, () =>
  McpImportService.of(
    migrateBeforeImports(
      createFilesystemMcpImportService({ homeDir: homedir(), piAgentDir: getPiAgentDir() }),
      migrateOpenWaggleMcpFilesOnce,
    ),
  ),
)

export const OpenWaggleMcpConfigurationServiceLive = Layer.sync(McpConfigurationService, () =>
  getOpenWaggleMcpConfigurationService(),
)
