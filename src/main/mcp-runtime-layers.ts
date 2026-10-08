import { Layer } from 'effect'
import { mcpSessionConnectionPool } from './adapters/mcp/pool/mcp-connection-pool-instance'
import { createPiMcpAppRuntimeService } from './adapters/pi/mcp/pi-mcp-app-runtime-service'
import { createPiMcpServerRuntimeService } from './adapters/pi/mcp/pi-mcp-server-runtime-service'
import { McpAppRuntimeService } from './ports/mcp-app-runtime-service'
import { McpServerRuntimeService } from './ports/mcp-server-runtime-service'

/** The Host's MCP server and MCP App services, over the Host's one connection pool. */
export const PiMcpServerRuntimeServiceLive = Layer.succeed(
  McpServerRuntimeService,
  createPiMcpServerRuntimeService(mcpSessionConnectionPool),
)

export const PiMcpAppRuntimeServiceLive = Layer.succeed(
  McpAppRuntimeService,
  createPiMcpAppRuntimeService(mcpSessionConnectionPool),
)
