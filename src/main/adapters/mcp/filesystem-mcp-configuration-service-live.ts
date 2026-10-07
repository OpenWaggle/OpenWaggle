import { homedir } from 'node:os'
import { Layer } from 'effect'
import { McpConfigurationService } from '../../ports/mcp-configuration-service'
import { getPiAgentDir } from '../pi/pi-provider-catalog'
import { createFilesystemMcpConfigurationService } from './config/filesystem-mcp-configuration-service'

/** The ADR 0048 file set of the signed-in user: Pi's agent directory and the home directory. */
export const FilesystemMcpConfigurationServiceLive = Layer.sync(McpConfigurationService, () =>
  McpConfigurationService.of(
    createFilesystemMcpConfigurationService({ homeDir: homedir(), piAgentDir: getPiAgentDir() }),
  ),
)
