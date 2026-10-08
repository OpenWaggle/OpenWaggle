import { McpPooledConnection } from './mcp-pooled-connection'
import {
  MCP_CLOSE_ALL_TIMEOUT_MS,
  MCP_IDLE_CLOSE_MS,
  MCP_MAX_WARM_SESSIONS,
  type McpPoolClock,
  type McpPoolConnectionState,
  type McpPooledServerSpec,
  type McpPoolServerConnection,
  type McpPoolServerStatus,
  type McpPoolTimer,
  type McpSessionConnectionPoolOptions,
  type PooledServer,
  type SessionConnections,
  systemClock,
} from './mcp-session-connection-pool-types'
import type { McpWireTransport } from './mcp-wire'

/**
 * Every Session's MCP server connections. A connection belongs to one Session and lasts across
 * its Runs; it is never shared with another Session, so a Worker or fork has its own. Warm
 * connections are bounded: a Session's close after `idleCloseMs` without a new Run, when the
 * Session is archived or deleted (`closeSession`), when the Host stops (`closeAll`), and when more
 * than `maxWarmSessions` Sessions hold some, the least recently used one without a Run first.
 */
export class McpSessionConnectionPool {
  private readonly sessions = new Map<string, SessionConnections>()
  /**
   * Sessions whose connections were closed on purpose (MCP switched off, archived): a Run still
   * running keeps Pi's transport factory, which must not reconnect. Cleared by the next Run.
   */
  private readonly closedSessions = new Set<string>()
  /** After `closeAll`, only Sessions that began a Run since may lease again. */
  private closedAll = false
  private readonly reopenedSessions = new Set<string>()
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
    if (this.sessions.get(sessionId)?.closedServers.has(spec.name)) {
      throw new Error(`The MCP server "${spec.name}" was turned off or removed.`)
    }
    const connection = this.connectionFor(sessionId, spec)
    this.sessions.get(sessionId)?.leased.set(spec.name, {
      identity: spec.identity,
      projectPath: spec.projectPath ?? null,
      fromExtension: spec.fromExtension === true,
    })
    return connection.attach()
  }

  /** The Session's open connection to a server, for OpenWaggle's own requests. */
  connection(sessionId: string, serverName: string) {
    const server = this.sessions.get(sessionId)?.servers.get(serverName)
    return server && !server.connection.isClosed ? server.connection : undefined
  }

  /** The Session's connection to a server, opened when it has none. */
  connectionFor(sessionId: string, spec: McpPooledServerSpec) {
    // A Run's lease and an MCP App request alike: a Session closed on purpose stays closed.
    if (
      this.closedSessions.has(sessionId) ||
      (this.closedAll && !this.reopenedSessions.has(sessionId))
    ) {
      throw new Error("This Session's MCP connections were closed; its next Run reconnects.")
    }
    const session = this.touch(sessionId)
    const existing = session.servers.get(spec.name)
    if (existing && existing.fingerprint === spec.fingerprint && !existing.connection.isClosed) {
      return existing.connection
    }
    // A changed definition closes the old connection. A retiring one (already `isClosed`) is only
    // replaced: it closes itself once the requests it already sent settle.
    if (existing && !existing.connection.isClosed) void existing.connection.close()
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
      projectPath: spec.projectPath ?? null,
      fromExtension: spec.fromExtension === true,
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
    // A new Run reads the configuration afresh, so a server turned on again may connect.
    session.closedServers.clear()
    session.leased.clear()
    this.closedSessions.delete(sessionId)
    if (this.closedAll) this.reopenedSessions.add(sessionId)
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

  /**
   * Closes every connection of the Session, for example because it was archived or deleted or its
   * MCP was switched off. Its running Run's leases are refused until its next Run.
   */
  async closeSession(sessionId: string) {
    this.closedSessions.add(sessionId)
    await this.closeSessionConnections(sessionId)
  }

  private async closeSessionConnections(sessionId: string) {
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

  /**
   * Closes one Session's connection to a server that was turned off or removed. A running Run
   * keeps Pi's earlier configuration, so its leases of that server are refused until its next Run.
   */
  async closeServer(sessionId: string, serverName: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.closedServers.add(serverName)
    await session.servers.get(serverName)?.connection.close()
  }

  /**
   * Every warm connection, and every server a running Run leased whose connection is gone (it
   * crashed or retired), without touching recency: a configuration change judges both.
   */
  serverConnections(): McpPoolServerConnection[] {
    return [...this.sessions].flatMap(([sessionId, session]) => {
      const servers = new Map(session.leased)
      for (const [name, server] of session.servers) {
        if (server.connection.isClosed) continue
        const { identity, projectPath, fromExtension } = server
        servers.set(name, { identity, projectPath, fromExtension })
      }
      return [...servers].map(([name, server]) => ({ sessionId, name, ...server }))
    })
  }

  /** Closes everything, waiting a bounded time for servers to exit. */
  async closeAll() {
    this.closedAll = true
    this.reopenedSessions.clear()
    const closing = Promise.all(
      [...this.sessions.keys()].map((id) => this.closeSessionConnections(id)),
    )
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
      closedServers: new Set<string>(),
      leased: new Map(),
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
      if (session.activeRuns === 0) void this.closeSessionConnections(sessionId)
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
      void this.closeSessionConnections(victim)
      warm = warm.filter((id) => id !== victim)
    }
  }
}
