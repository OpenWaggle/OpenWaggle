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
  /** The project whose configuration defines the server; null for global-only Sessions. */
  readonly projectPath?: string | null
  /** A server a Pi extension registered (`pi.registerMcpServer`): no MCP file defines it. */
  readonly fromExtension?: boolean
  /** Opens the upstream; it may first read what it needs, such as vault secrets. */
  readonly open: () => McpUpstream | Promise<McpUpstream>
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
  readonly projectPath: string | null
  readonly fromExtension: boolean
  readonly connection: McpPooledConnection
}

export interface SessionConnections {
  readonly servers: Map<string, PooledServer>
  /** Servers closed because they were turned off or removed: no Run lease until the next Run. */
  readonly closedServers: Set<string>
  /**
   * Servers the Session's running Runs leased since the last `beginRun`, connected or not: a crashed
   * or retired connection is gone from `servers`, but the Run's Pi client would reopen it.
   */
  readonly leased: Map<string, Omit<McpPoolServerConnection, 'sessionId' | 'name'>>
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

/** A warm connection, as the configuration-change check needs to know it. */
export interface McpPoolServerConnection {
  readonly sessionId: string
  readonly name: string
  readonly identity: string | undefined
  readonly projectPath: string | null
  readonly fromExtension: boolean
}
