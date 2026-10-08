import type { McpPooledConnectionOptions, McpUpstream } from './mcp-connection-support'
import type { McpPooledConnection } from './mcp-pooled-connection'

export interface McpPoolTimer {
  readonly cancel: () => void
}

export interface McpPoolClock {
  readonly setTimeout: (callback: () => void, delayMs: number) => McpPoolTimer
}

export const systemClock: McpPoolClock = {
  setTimeout: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs)
    // An idle timer must not keep the Host alive.
    handle.unref()
    return { cancel: () => clearTimeout(handle) }
  },
}

/** A Session's connections close after this long without a new Run (ADR 0050). */
export const MCP_IDLE_CLOSE_MS = 300_000
/** Sessions that may hold warm connections at once; the least recently used gives them up. */
export const MCP_MAX_WARM_SESSIONS = 8
/** How long Host shutdown waits for servers to exit. */
export const MCP_CLOSE_ALL_TIMEOUT_MS = 5_000

export interface McpPooledServerSpec {
  readonly name: string
  /** Hash of what the connection is made of; a changed definition is a different connection. */
  readonly fingerprint: string
  /** The server identity (`mcpServerIdentity`), so Settings can find a warm connection's state. */
  readonly identity?: string
  readonly open: () => McpUpstream
  readonly roots?: McpPooledConnectionOptions['roots']
}

export type McpConnectionHooks = Pick<
  McpPooledConnectionOptions,
  'augmentInitializeParams' | 'handleServerRequest' | 'observeResult' | 'adaptResult'
>

export interface McpSessionConnectionPoolOptions {
  readonly clock?: McpPoolClock
  readonly idleCloseMs?: number
  readonly maxWarmSessions?: number
  readonly closeAllTimeoutMs?: number
  /** OpenWaggle's additions for one Session's server: capabilities, sampling, elicitation, Apps. */
  readonly hooks?: (
    sessionId: string,
    serverName: string,
    identity: string | undefined,
  ) => McpConnectionHooks
}

export interface PooledServer {
  readonly fingerprint: string
  readonly identity: string | undefined
  readonly connection: McpPooledConnection
}

export interface SessionConnections {
  readonly servers: Map<string, PooledServer>
  activeRuns: number
  idleTimer: McpPoolTimer | undefined
}

export interface McpPoolServerStatus {
  readonly name: string
  readonly clients: number
  readonly lastError?: string
  readonly stderrTail: string
}

/** What Settings may know about a warm connection without using it. */
export interface McpPoolConnectionState {
  /** The handshake is done, so the server is connected. */
  readonly ready: boolean
  readonly lastError?: string
}
