import { Layer } from 'effect'
import { EncryptedMcpSecretVaultServiceLive } from './adapters/mcp/encrypted-mcp-secret-vault-service'
import { McpSessionConnectionPool } from './adapters/mcp/pool/mcp-session-connection-pool'
import { McpRegistryServiceLive } from './adapters/mcp/registry/mcp-registry-service'
import { openWaggleMcpConnectionHooks } from './adapters/pi/mcp/mcp-session-context'
import {
  OpenWaggleMcpConfigurationServiceLive,
  OpenWaggleMcpImportServiceLive,
} from './adapters/pi/mcp/openwaggle-mcp-configuration'
import { createPiMcpAppRuntimeService } from './adapters/pi/mcp/pi-mcp-app-runtime-service'
import { createPiMcpServerRuntimeService } from './adapters/pi/mcp/pi-mcp-server-runtime-service'
import { piAgentKernelLayer } from './adapters/pi/pi-agent-kernel-adapter'
import { McpAppRuntimeService } from './ports/mcp-app-runtime-service'
import { McpServerRuntimeService } from './ports/mcp-server-runtime-service'

/**
 * The Host's one MCP connection pool, composed here and passed to everything that uses it: Runs
 * (the Pi agent kernel), MCP Apps, Settings and sign-in, Session removal, and Host stop. Every
 * pooled connection gets OpenWaggle's client capabilities, sampling, elicitation, and MCP App
 * observation through its hooks.
 */
export const hostMcpConnectionPool = new McpSessionConnectionPool({
  hooks: openWaggleMcpConnectionHooks,
})

/** The Host's MCP server (Settings, the CLI, sign-in) and MCP App services. */
export const PiMcpRuntimeServicesLive = Layer.mergeAll(
  Layer.succeed(McpServerRuntimeService, createPiMcpServerRuntimeService(hostMcpConnectionPool)),
  Layer.succeed(McpAppRuntimeService, createPiMcpAppRuntimeService(hostMcpConnectionPool)),
)

/** Every MCP service the Host provides: secrets, configuration, import, Registry, runtime. */
export const McpServicesLive = Layer.mergeAll(
  EncryptedMcpSecretVaultServiceLive,
  OpenWaggleMcpConfigurationServiceLive,
  OpenWaggleMcpImportServiceLive,
  McpRegistryServiceLive,
  PiMcpRuntimeServicesLive,
)

/** The agent kernel, whose Runs lease from the same pool. */
export const HostPiAgentKernelLive = piAgentKernelLayer(hostMcpConnectionPool)

/** At Host stop: stdio MCP servers must not outlive the Host. */
export function closeHostMcpConnections() {
  return hostMcpConnectionPool.closeAll()
}
