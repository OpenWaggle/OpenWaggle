import { type McpConnectionHooks, McpSessionConnectionPool } from './mcp-session-connection-pool'

type McpConnectionHooksFactory = (
  sessionId: string,
  serverName: string,
  identity: string | undefined,
) => McpConnectionHooks

let hooks: McpConnectionHooksFactory | undefined

/**
 * Installs OpenWaggle's additions to every pooled connection: client capabilities, sampling,
 * elicitation, and MCP App observation. Set once by the Pi adapter that owns those interactions.
 */
export function setMcpConnectionHooks(next: McpConnectionHooksFactory) {
  hooks = next
}

/** The Host process's one pool: Pi sessions lease from it and Session removal closes it. */
export const mcpSessionConnectionPool = new McpSessionConnectionPool({
  hooks: (sessionId, serverName, identity) => hooks?.(sessionId, serverName, identity) ?? {},
})
