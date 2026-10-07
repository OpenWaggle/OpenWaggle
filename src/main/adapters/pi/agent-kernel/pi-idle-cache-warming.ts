import type { AgentSession } from '@earendil-works/pi-coding-agent'
import {
  disposeOpenWagglePiSession,
  emitOpenWagglePiSessionShutdown,
} from '../pi-session-lifecycle'
import { logger } from './constants'

/**
 * Pi keeps a prompt cache warm "between runs" (`cacheWarming: idle`) from the session that made the
 * request, and OpenWaggle ends that session when a Run ends. A Run's session can stay open after
 * the Run as a warming session instead. It only refreshes the cache and records what that cost: its
 * extensions are shut down (so it holds no MCP connection), it never runs another Run, and it is
 * ended before anything else opens the Session's Pi file, so two writers never share that file.
 */
interface WarmingSession {
  readonly session: AgentSession
  readonly settledAt: number
}

interface IdleCacheWarmingClock {
  readonly now: () => number
  /** Calls `tick` every `ms` until the returned function is called. */
  readonly every: (ms: number, tick: () => void) => () => void
}

interface IdleCacheWarmingOptions {
  readonly clock?: IdleCacheWarmingClock
  /** Warming sessions kept at once; the longest-settled one ends first. */
  readonly maxSessions?: number
  /** Pi's own idle limit is 30 minutes; this bounds a warming session if Pi never stops. */
  readonly maxIdleMs?: number
  /** How often to check whether Pi has stopped warming. */
  readonly pollMs?: number
}

const DEFAULT_MAX_SESSIONS = 8
const DEFAULT_MAX_IDLE_MS = 31 * 60_000
const DEFAULT_POLL_MS = 15_000

const systemClock: IdleCacheWarmingClock = {
  now: () => Date.now(),
  every: (ms, tick) => {
    const handle = setInterval(tick, ms)
    handle.unref()
    return () => clearInterval(handle)
  },
}

/** Pi stops warming when a Run settles unless warming between runs, so its status is enough. */
function isWarming(session: AgentSession) {
  const status = session.cacheWarmingStatus
  return status !== undefined && status.state !== 'inactive'
}

export function createIdleCacheWarming(options: IdleCacheWarmingOptions = {}) {
  const clock = options.clock ?? systemClock
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS
  const maxIdleMs = options.maxIdleMs ?? DEFAULT_MAX_IDLE_MS
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const warmingBySessionId = new Map<string, WarmingSession>()
  /** Archived or deleted Sessions, whose Runs may still be ending. */
  const closedSessionIds = new Set<string>()
  let stopPolling: (() => void) | undefined

  function end(sessionId: string) {
    const warming = warmingBySessionId.get(sessionId)
    if (!warming) return
    warmingBySessionId.delete(sessionId)
    // The extensions were shut down when the Run ended; this cancels Pi's warming timer.
    warming.session.dispose()
    if (warmingBySessionId.size === 0) {
      stopPolling?.()
      stopPolling = undefined
    }
  }

  function endStoppedSessions() {
    const now = clock.now()
    for (const [sessionId, warming] of [...warmingBySessionId]) {
      if (!isWarming(warming.session) || now - warming.settledAt >= maxIdleMs) end(sessionId)
    }
  }

  function keep(sessionId: string, session: AgentSession) {
    warmingBySessionId.set(sessionId, { session, settledAt: clock.now() })
    for (const oldest of warmingBySessionId.keys()) {
      if (warmingBySessionId.size <= maxSessions) break
      end(oldest)
    }
    stopPolling ??= clock.every(pollMs, endStoppedSessions)
  }

  return {
    /** Ends a Run's Pi session, or keeps it warming the prompt cache while the Session is idle. */
    async settle(
      sessionId: string,
      session: AgentSession,
      run: { readonly aborted: boolean },
    ): Promise<'warming' | 'disposed'> {
      end(sessionId)
      if (run.aborted || closedSessionIds.has(sessionId) || !isWarming(session)) {
        await disposeOpenWagglePiSession(session)
        return 'disposed'
      }
      await emitOpenWagglePiSessionShutdown(session)
      keep(sessionId, session)
      logger.debug('Keeping the prompt cache warm between runs', { sessionId })
      return 'warming'
    },
    /** Ends the Session's warming session. Call before opening the Session's Pi file. */
    async release(sessionId: string) {
      end(sessionId)
    },
    /** The warming session, for reads that would otherwise open the Session's Pi file again. */
    borrow(sessionId: string): AgentSession | undefined {
      return warmingBySessionId.get(sessionId)?.session
    },
    /** An archived or deleted Session warms nothing, including after a Run still ending. */
    close(sessionId: string) {
      closedSessionIds.add(sessionId)
      end(sessionId)
    },
    reopen(sessionId: string) {
      closedSessionIds.delete(sessionId)
    },
    async releaseAll() {
      for (const sessionId of [...warmingBySessionId.keys()]) end(sessionId)
    },
  }
}

/** The Session Host's warming sessions. */
export const idleCacheWarming = createIdleCacheWarming()
