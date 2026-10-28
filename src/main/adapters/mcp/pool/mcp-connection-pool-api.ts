/**
 * What the Pi adapter uses of the MCP connection pool (ADR 0051): the pool as an injected
 * dependency, its connection hooks, server identities, and the parts upstream transports are
 * built from. The pool's own connection and request internals stay behind it.
 */
import type { McpSessionConnectionPool } from './mcp-session-connection-pool'

/** The pool operations Pi sessions, MCP Apps, Settings, and sign-in use; tests pass a fake. */
export type McpConnectionPool = Pick<
  McpSessionConnectionPool,
  | 'lease'
  | 'connection'
  | 'connectionFailed'
  | 'connectionFor'
  | 'connectionStates'
  | 'closeServerIdentity'
  | 'closeServer'
  | 'serverConnections'
  | 'closeSession'
  | 'beginRun'
  | 'noteActivity'
>

export { MCP_MAX_MESSAGE_BYTES } from '../runtime/mcp-message-limit'
export { MCP_CATALOG_FILL_WAIT_MS, mcpStartupWaitMs } from './mcp-connection-catalog'
export type { McpUpstream } from './mcp-connection-support'
export { DeferredTransport } from './mcp-deferred-transport'
export { McpSdkTransportAdapter } from './mcp-sdk-transport-adapter'
export { createMcpServerFetch } from './mcp-server-fetch'
export { mcpConnectionFingerprint, mcpServerIdentity } from './mcp-server-identity'
export type { McpConnectionHooks } from './mcp-session-connection-pool-types'
