import { statSync } from 'node:fs'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { onAuthoritativeSettingsChange } from '../../../store/authoritative-settings'
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
interface PiFileState {
  readonly size: number
  readonly mtimeMs: number
}

interface WarmingSession {
  readonly session: AgentSession
  readonly settledAt: number
  /** The Pi file as the Run, then this session's own refreshes, left it. */
  fileState: PiFileState | null
}

function piFileState(file: string | undefined): PiFileState | null {
  if (!file) return null
  try {
    const stats = statSync(file)
    return { size: stats.size, mtimeMs: stats.mtimeMs }
  } catch {
    return null
  }
}

/**
 * Another writer, such as `pi --resume`, continued the Session. A refresh would then be parented
 * on this session's stale leaf and become the file's last entry, so the next resume would continue
 * the old branch, and the prompt it keeps warm is no longer the one the Session will send.
 */
function fileChangedElsewhere(warming: WarmingSession) {
  const current = piFileState(warming.session.sessionFile)
  const left = warming.fileState
  if (!current || !left) return current !== left
  return current.size !== left.size || current.mtimeMs !== left.mtimeMs
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
  /** False once the user's setting is no longer warming between runs. */
  let enabled = true

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
      if (
        !isWarming(warming.session) ||
        now - warming.settledAt >= maxIdleMs ||
        fileChangedElsewhere(warming)
      ) {
        end(sessionId)
      }
    }
  }

  function mayWarm(sessionId: string, session: AgentSession, run: { readonly aborted: boolean }) {
    return enabled && !run.aborted && !closedSessionIds.has(sessionId) && isWarming(session)
  }

  /** Pi records each refresh with `appendUsage`; it is refused once another writer appended. */
  function guardRefreshWrites(sessionId: string, warming: WarmingSession) {
    const manager = warming.session.sessionManager
    const appendUsage = manager.appendUsage.bind(manager)
    manager.appendUsage = (...args) => {
      if (fileChangedElsewhere(warming)) {
        end(sessionId)
        // Pi's warmer treats a failed refresh as best effort and records nothing.
        throw new Error('The Pi session file changed outside its warming session.')
      }
      const entry = appendUsage(...args)
      warming.fileState = piFileState(warming.session.sessionFile)
      return entry
    }
  }

  function keep(sessionId: string, session: AgentSession) {
    const warming: WarmingSession = {
      session,
      settledAt: clock.now(),
      fileState: piFileState(session.sessionFile),
    }
    guardRefreshWrites(sessionId, warming)
    warmingBySessionId.set(sessionId, warming)
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
      if (!mayWarm(sessionId, session, run)) {
        await disposeOpenWagglePiSession(session)
        return 'disposed'
      }
      await emitOpenWagglePiSessionShutdown(session)
      // The Session may have been archived, or warming turned off, during the shutdown.
      if (!mayWarm(sessionId, session, run)) {
        session.dispose()
        return 'disposed'
      }
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
      const warming = warmingBySessionId.get(sessionId)
      if (!warming) return undefined
      // Its view of the file is stale once another writer continued the Session.
      if (fileChangedElsewhere(warming)) {
        end(sessionId)
        return undefined
      }
      return warming.session
    },
    setEnabled(next: boolean) {
      enabled = next
      if (!next) for (const sessionId of [...warmingBySessionId.keys()]) end(sessionId)
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

/**
 * A Pi session reads `cacheWarming` once, when it is built, so a warming session keeps warming
 * after the user turns warming between runs off. The Host ends them all instead, and Runs that end
 * later do not start warming.
 */
onAuthoritativeSettingsChange((settings) => {
  if (!settings) return
  idleCacheWarming.setEnabled(settings.cacheWarming === 'idle')
})
