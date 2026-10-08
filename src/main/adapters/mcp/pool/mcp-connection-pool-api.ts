/**
 * What the Pi adapter uses of the MCP connection pool (ADR 0050): the pool as an injected
 * dependency, its connection hooks, server identities, and the parts upstream transports are
 * built from. The pool's own connection and request internals stay behind it.
 */
import type { McpSessionConnectionPool } from './mcp-session-connection-pool'

/** The pool operations Pi sessions, MCP Apps, Settings, and sign-in use; tests pass a fake. */
export type McpConnectionPool = Pick<
  McpSessionConnectionPool,
  | 'lease'
  | 'connection'
  | 'connectionFor'
  | 'connectionStates'
  | 'closeServerIdentity'
  | 'closeSession'
  | 'beginRun'
  | 'noteActivity'
>

export type { McpUpstream } from './mcp-connection-support'
export { DeferredTransport } from './mcp-deferred-transport'
export { McpSdkTransportAdapter } from './mcp-sdk-transport-adapter'
export { createMcpServerFetch, MCP_MAX_MESSAGE_BYTES } from './mcp-server-fetch'
export { mcpConnectionFingerprint, mcpServerIdentity } from './mcp-server-identity'
export type { McpConnectionHooks } from './mcp-session-connection-pool'
