import { homedir } from 'node:os'
import { Layer } from 'effect'
import {
  McpConfigurationService,
  type McpConfigurationServiceShape,
} from '../../../ports/mcp-configuration-service'
import { createFilesystemMcpConfigurationService } from '../../mcp/config/filesystem-mcp-configuration-service'
import { getPiAgentDir } from '../pi-provider-catalog'

let service: McpConfigurationServiceShape | undefined

/**
 * The Host's one MCP configuration service, so a change saved by Pi's `/mcp` inside a Run and one
 * saved from Settings reach the same listeners.
 */
export function getOpenWaggleMcpConfigurationService() {
  service ??= createFilesystemMcpConfigurationService({
    homeDir: homedir(),
    piAgentDir: getPiAgentDir(),
  })
  return service
}

export const OpenWaggleMcpConfigurationServiceLive = Layer.sync(McpConfigurationService, () =>
  getOpenWaggleMcpConfigurationService(),
)
