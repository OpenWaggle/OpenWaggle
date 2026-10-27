import type {
  McpPoolClock,
  McpSessionConnectionPoolOptions,
  SessionConnections,
} from './mcp-session-connection-pool-types'

/**
 * The idle close of each Session's connections: after `idleCloseMs` without a Run, or sooner when
 * the policy says so for the Session (a settled Hive Worker, D1.1).
 */
export class McpSessionIdleClose {
  policy: McpSessionConnectionPoolOptions['idleCloseMsFor']

  constructor(
    private readonly input: {
      readonly clock: McpPoolClock
      readonly idleCloseMs: number
      readonly policy: McpSessionConnectionPoolOptions['idleCloseMsFor']
      readonly close: (sessionId: string) => void
    },
  ) {
    this.policy = input.policy
  }

  schedule(sessionId: string, session: SessionConnections) {
    this.arm(sessionId, session, this.input.idleCloseMs)
    const policy = this.policy
    if (!policy) return
    const armed = session.idleTimer
    void Promise.resolve()
      .then(() => policy(sessionId))
      .then((delayMs) => {
        if (delayMs === undefined || delayMs >= this.input.idleCloseMs) return
        // A Run started, or a later idle period re-armed the timer, while the policy was asked.
        if (session.idleTimer !== armed || session.activeRuns > 0) return
        this.arm(sessionId, session, delayMs)
      })
      .catch(() => undefined)
  }

  cancel(session: SessionConnections) {
    session.idleTimer?.cancel()
    session.idleTimer = undefined
  }

  private arm(sessionId: string, session: SessionConnections, delayMs: number) {
    this.cancel(session)
    session.idleTimer = this.input.clock.setTimeout(() => {
      session.idleTimer = undefined
      if (session.activeRuns === 0) this.input.close(sessionId)
    }, delayMs)
  }
}
