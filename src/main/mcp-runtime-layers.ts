import { Layer } from 'effect'
import { McpSessionConnectionPool } from './adapters/mcp/pool/mcp-session-connection-pool'
import { openWaggleMcpConnectionHooks } from './adapters/pi/mcp/mcp-session-context'
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

/** The agent kernel, whose Runs lease from the same pool. */
export const HostPiAgentKernelLive = piAgentKernelLayer(hostMcpConnectionPool)

/** At Host stop: stdio MCP servers must not outlive the Host. */
export function closeHostMcpConnections() {
  return hostMcpConnectionPool.closeAll()
}
