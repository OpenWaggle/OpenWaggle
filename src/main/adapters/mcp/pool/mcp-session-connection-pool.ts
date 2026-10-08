import type { McpPooledConnectionOptions, McpUpstream } from './mcp-connection-support'
import { McpPooledConnection } from './mcp-pooled-connection'
import type { McpWireTransport } from './mcp-wire'

export interface McpPoolTimer {
  readonly cancel: () => void
}

export interface McpPoolClock {
  readonly setTimeout: (callback: () => void, delayMs: number) => McpPoolTimer
}

const systemClock: McpPoolClock = {
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

interface PooledServer {
  readonly fingerprint: string
  readonly identity: string | undefined
  readonly connection: McpPooledConnection
}

interface SessionConnections {
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

/**
 * Every Session's MCP server connections. A connection belongs to one Session and lasts across
 * its Runs; it is never shared with another Session, so a Worker or fork has its own. Warm
 * connections are bounded: a Session's close after `idleCloseMs` without a new Run, when the
 * Session is archived or deleted (`closeSession`), when the Host stops (`closeAll`), and when more
 * than `maxWarmSessions` Sessions hold some, the least recently used one without a Run first.
 */
export class McpSessionConnectionPool {
  private readonly sessions = new Map<string, SessionConnections>()
  private readonly clock: McpPoolClock
  private readonly idleCloseMs: number
  private readonly maxWarmSessions: number
  private readonly closeAllTimeoutMs: number

  constructor(private readonly options: McpSessionConnectionPoolOptions = {}) {
    this.clock = options.clock ?? systemClock
    this.idleCloseMs = options.idleCloseMs ?? MCP_IDLE_CLOSE_MS
    this.maxWarmSessions = options.maxWarmSessions ?? MCP_MAX_WARM_SESSIONS
    this.closeAllTimeoutMs = options.closeAllTimeoutMs ?? MCP_CLOSE_ALL_TIMEOUT_MS
  }

  /** The transport Pi's client gets for one server of one Session. */
  lease(sessionId: string, spec: McpPooledServerSpec): McpWireTransport {
    return this.connectionFor(sessionId, spec).attach()
  }

  /** The Session's open connection to a server, for OpenWaggle's own requests. */
  connection(sessionId: string, serverName: string) {
    const server = this.sessions.get(sessionId)?.servers.get(serverName)
    return server && !server.connection.isClosed ? server.connection : undefined
  }

  /** The Session's connection to a server, opened when it has none. */
  connectionFor(sessionId: string, spec: McpPooledServerSpec) {
    const session = this.touch(sessionId)
    const existing = session.servers.get(spec.name)
    if (existing && existing.fingerprint === spec.fingerprint && !existing.connection.isClosed) {
      return existing.connection
    }
    // Closing removes the old connection from the Session at once.
    if (existing) void existing.connection.close()
    const wasWarm = session.servers.size > 0
    const connection: McpPooledConnection = new McpPooledConnection({
      serverName: spec.name,
      open: spec.open,
      ...(spec.roots ? { roots: spec.roots } : {}),
      ...this.options.hooks?.(sessionId, spec.name, spec.identity),
      onClosed: () => {
        if (session.servers.get(spec.name)?.connection === connection) {
          session.servers.delete(spec.name)
        }
      },
    })
    session.servers.set(spec.name, {
      fingerprint: spec.fingerprint,
      identity: spec.identity,
      connection,
    })
    if (session.activeRuns === 0) this.scheduleIdleClose(sessionId, session)
    if (!wasWarm) this.evictLeastRecentlyUsed(sessionId)
    return connection
  }

  /**
   * Work for the Session outside a Run, such as an MCP App request: it counts as recent use, so
   * the Session's connections are not closed as idle while an App still uses them.
   */
  noteActivity(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.touch(sessionId)
    if (session.activeRuns === 0 && session.servers.size > 0) {
      this.scheduleIdleClose(sessionId, session)
    }
  }

  /** A Run of the Session started; returns the function that ends it. */
  beginRun(sessionId: string) {
    const session = this.touch(sessionId)
    session.activeRuns += 1
    this.cancelIdleClose(session)
    let ended = false
    return () => {
      if (ended) return
      ended = true
      session.activeRuns = Math.max(0, session.activeRuns - 1)
      if (session.activeRuns === 0 && this.sessions.get(sessionId) === session) {
        this.scheduleIdleClose(sessionId, session)
      }
    }
  }

  /** Closes every connection of the Session, for example because it was archived or deleted. */
  async closeSession(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.cancelIdleClose(session)
    const connections = [...session.servers.values()].map((server) => server.connection)
    session.servers.clear()
    if (session.activeRuns === 0) this.sessions.delete(sessionId)
    await Promise.all(connections.map((connection) => connection.close()))
  }

  /**
   * Closes one server's connections in every Session, for example after signing in or out of it.
   * Matched by server identity, so same-named servers of other projects stay connected.
   */
  async closeServerIdentity(identity: string) {
    const connections = [...this.sessions.values()].flatMap((session) =>
      [...session.servers.values()]
        .filter((server) => server.identity === identity)
        .map((server) => server.connection),
    )
    await Promise.all(connections.map((connection) => connection.close()))
  }

  /** Closes everything, waiting a bounded time for servers to exit. */
  async closeAll() {
    const closing = Promise.all([...this.sessions.keys()].map((id) => this.closeSession(id)))
    let timer: McpPoolTimer | undefined
    await Promise.race([
      closing,
      new Promise<void>((resolve) => {
        timer = this.clock.setTimeout(resolve, this.closeAllTimeoutMs)
      }),
    ])
    timer?.cancel()
  }

  /** The Sessions holding warm connections, most recently used last. */
  warmSessions() {
    return [...this.sessions].filter(([, session]) => session.servers.size > 0).map(([id]) => id)
  }

  status(sessionId: string): McpPoolServerStatus[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    return [...session.servers].map(([name, { connection }]) => ({
      name,
      clients: connection.attachedLeases,
      ...(connection.lastError ? { lastError: connection.lastError } : {}),
      stderrTail: connection.stderrTail,
    }))
  }

  /**
   * The open connections to one server identity across Sessions, read without sending anything,
   * touching recency, or handing a connection out: a connection stays its Session's alone.
   */
  connectionStates(identity: string): McpPoolConnectionState[] {
    return [...this.sessions.values()].flatMap((session) =>
      [...session.servers.values()]
        .filter((server) => server.identity === identity && !server.connection.isClosed)
        .map(({ connection }) => ({
          ready: connection.isReady,
          ...(connection.lastError ? { lastError: connection.lastError } : {}),
        })),
    )
  }

  private touch(sessionId: string) {
    const session = this.sessions.get(sessionId) ?? {
      servers: new Map<string, PooledServer>(),
      activeRuns: 0,
      idleTimer: undefined,
    }
    // Map order is recency order: the first entry is the least recently used.
    this.sessions.delete(sessionId)
    this.sessions.set(sessionId, session)
    return session
  }

  private scheduleIdleClose(sessionId: string, session: SessionConnections) {
    this.cancelIdleClose(session)
    session.idleTimer = this.clock.setTimeout(() => {
      session.idleTimer = undefined
      if (session.activeRuns === 0) void this.closeSession(sessionId)
    }, this.idleCloseMs)
  }

  private cancelIdleClose(session: SessionConnections) {
    session.idleTimer?.cancel()
    session.idleTimer = undefined
  }

  private evictLeastRecentlyUsed(currentSessionId: string) {
    let warm = this.warmSessions()
    while (warm.length > this.maxWarmSessions) {
      const victim = warm.find(
        (id) => id !== currentSessionId && this.sessions.get(id)?.activeRuns === 0,
      )
      if (!victim) return
      void this.closeSession(victim)
      warm = warm.filter((id) => id !== victim)
    }
  }
}
