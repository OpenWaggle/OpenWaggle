import { type McpConnectionHooks, McpSessionConnectionPool } from './mcp-session-connection-pool'

let hooks: ((sessionId: string, serverName: string) => McpConnectionHooks) | undefined

/**
 * Installs OpenWaggle's additions to every pooled connection: client capabilities, sampling,
 * elicitation, and MCP App observation. Set once by the Pi adapter that owns those interactions.
 */
export function setMcpConnectionHooks(
  next: (sessionId: string, serverName: string) => McpConnectionHooks,
) {
  hooks = next
}

/** The Host process's one pool: Pi sessions lease from it and Session removal closes it. */
export const mcpSessionConnectionPool = new McpSessionConnectionPool({
  hooks: (sessionId, serverName) => hooks?.(sessionId, serverName) ?? {},
})
