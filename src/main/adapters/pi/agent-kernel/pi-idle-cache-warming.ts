import { statSync } from 'node:fs'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { PiCacheWarmingMode } from '@shared/types/settings'
import type { PromptCacheWarming } from '../../../ports/prompt-cache-warming'
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

interface SettledRun {
  readonly aborted: boolean
}

/** The Session Host's warming sessions, by OpenWaggle Session id. */
export class IdleCacheWarming implements PromptCacheWarming {
  readonly #clock: IdleCacheWarmingClock
  readonly #maxSessions: number
  readonly #maxIdleMs: number
  readonly #pollMs: number
  readonly #warmingBySessionId = new Map<string, WarmingSession>()
  /** Archived Sessions, whose Runs may still be ending; a deleted Session is forgotten. */
  readonly #closedSessionIds = new Set<string>()
  #stopPolling: (() => void) | undefined
  /** False once the user's setting is no longer warming between runs. */
  #enabled = true
  /** True from Host stop until it starts again, so a settle still in flight keeps nothing. */
  #stopped = false

  constructor(options: IdleCacheWarmingOptions = {}) {
    this.#clock = options.clock ?? systemClock
    this.#maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS
    this.#maxIdleMs = options.maxIdleMs ?? DEFAULT_MAX_IDLE_MS
    this.#pollMs = options.pollMs ?? DEFAULT_POLL_MS
  }

  /** Ends a Run's Pi session, or keeps it warming the prompt cache while the Session is idle. */
  async settle(
    sessionId: string,
    session: AgentSession,
    run: SettledRun,
  ): Promise<'warming' | 'disposed'> {
    this.#end(sessionId)
    if (!this.#mayWarm(sessionId, session, run)) {
      await disposeOpenWagglePiSession(session)
      return 'disposed'
    }
    await emitOpenWagglePiSessionShutdown(session)
    // The Session may have been archived, or warming turned off or stopped, during the shutdown.
    if (!this.#mayWarm(sessionId, session, run)) {
      session.dispose()
      return 'disposed'
    }
    this.#keep(sessionId, session)
    logger.debug('Keeping the prompt cache warm between runs', { sessionId })
    return 'warming'
  }

  /** Ends the Session's warming session. Call before opening the Session's Pi file. */
  async release(sessionId: string) {
    this.#end(sessionId)
  }

  /** The warming session, for reads that would otherwise open the Session's Pi file again. */
  borrow(sessionId: string): AgentSession | undefined {
    const warming = this.#warmingBySessionId.get(sessionId)
    if (!warming) return undefined
    // Its view of the file is stale once another writer continued the Session.
    if (fileChangedElsewhere(warming)) {
      this.#end(sessionId, warming)
      return undefined
    }
    return warming.session
  }

  applyMode(mode: PiCacheWarmingMode) {
    this.#enabled = mode === 'idle'
    if (!this.#enabled) this.#endAll()
  }

  closeSession(sessionId: string) {
    this.#closedSessionIds.add(sessionId)
    this.#end(sessionId)
  }

  reopenSession(sessionId: string) {
    this.#closedSessionIds.delete(sessionId)
  }

  forgetSession(sessionId: string) {
    this.#end(sessionId)
    this.#closedSessionIds.delete(sessionId)
  }

  start() {
    this.#stopped = false
  }

  async stop() {
    this.#stopped = true
    this.#endAll()
  }

  /** Ends every warming session without fencing later Runs. */
  async releaseAll() {
    this.#endAll()
  }

  #mayWarm(sessionId: string, session: AgentSession, run: SettledRun) {
    return (
      this.#enabled &&
      !this.#stopped &&
      !run.aborted &&
      !this.#closedSessionIds.has(sessionId) &&
      isWarming(session)
    )
  }

  /** Ends the Session's warming session, or only `expected` when it is still that one. */
  #end(sessionId: string, expected?: WarmingSession) {
    const warming = this.#warmingBySessionId.get(sessionId)
    if (!warming || (expected && warming !== expected)) return
    this.#warmingBySessionId.delete(sessionId)
    // The extensions were shut down when the Run ended; this cancels Pi's warming timer.
    warming.session.dispose()
    if (this.#warmingBySessionId.size === 0) {
      this.#stopPolling?.()
      this.#stopPolling = undefined
    }
  }

  #endAll() {
    for (const sessionId of [...this.#warmingBySessionId.keys()]) this.#end(sessionId)
  }

  #endStoppedSessions() {
    const now = this.#clock.now()
    for (const [sessionId, warming] of [...this.#warmingBySessionId]) {
      if (
        !isWarming(warming.session) ||
        now - warming.settledAt >= this.#maxIdleMs ||
        fileChangedElsewhere(warming)
      ) {
        this.#end(sessionId, warming)
      }
    }
  }

  /** Pi records each refresh with `appendUsage`; it is refused once another writer appended. */
  #guardRefreshWrites(sessionId: string, warming: WarmingSession) {
    const manager = warming.session.sessionManager
    const appendUsage = manager.appendUsage.bind(manager)
    manager.appendUsage = (...args) => {
      if (fileChangedElsewhere(warming)) {
        this.#end(sessionId, warming)
        // Pi's warmer treats a failed refresh as best effort and records nothing.
        throw new Error('The Pi session file changed outside its warming session.')
      }
      const entry = appendUsage(...args)
      warming.fileState = piFileState(warming.session.sessionFile)
      return entry
    }
  }

  #keep(sessionId: string, session: AgentSession) {
    const warming: WarmingSession = {
      session,
      settledAt: this.#clock.now(),
      fileState: piFileState(session.sessionFile),
    }
    this.#guardRefreshWrites(sessionId, warming)
    this.#warmingBySessionId.set(sessionId, warming)
    for (const oldest of this.#warmingBySessionId.keys()) {
      if (this.#warmingBySessionId.size <= this.#maxSessions) break
      this.#end(oldest)
    }
    this.#stopPolling ??= this.#clock.every(this.#pollMs, () => this.#endStoppedSessions())
  }
}

export function createIdleCacheWarming(options: IdleCacheWarmingOptions = {}) {
  return new IdleCacheWarming(options)
}

/**
 * The Session Host's warming sessions. The kernel settles and releases them; the Host wires the
 * rest (settings, Session lifecycle, start and stop) through the PromptCacheWarming port.
 */
export const idleCacheWarming = createIdleCacheWarming()
