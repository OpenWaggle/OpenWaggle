import type { AgentSession, PrecomputedCompaction } from '@earendil-works/pi-coding-agent'
import type { PiCacheWarmingMode } from '@shared/types/settings'
import type { PromptCacheWarming } from '../../../ports/prompt-cache-warming'
import { currentOpenWagglePiAppSettings } from '../openwaggle-pi-app-settings'
import {
  disposeOpenWagglePiSession,
  emitOpenWagglePiSessionShutdown,
} from '../pi-session-lifecycle'
import { logger } from './constants'
import {
  DEFAULT_MAX_IDLE_MS,
  DEFAULT_MAX_SESSIONS,
  DEFAULT_POLL_MS,
  fileChangedElsewhere,
  type IdleCacheWarmingClock,
  type IdleCacheWarmingOptions,
  isWarming,
  piFileState,
  type SettledRun,
  systemClock,
  type WarmingSession,
} from './pi-idle-cache-warming-support'
import {
  idleCompactionToInstall,
  type PendingIdleCompaction,
  planIdleCompaction,
} from './pi-idle-compaction'

/**
 * Pi keeps a prompt cache warm "between runs" (`cacheWarming: idle`) from the session that made the
 * request, and OpenWaggle ends that session when a Run ends. A Run's session can stay open after
 * the Run as a warming session instead. It only refreshes the cache and records what that cost: its
 * extensions are shut down (so it holds no MCP connection), it never runs another Run, and it is
 * ended before anything else opens the Session's Pi file, so two writers never share that file.
 */
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
  /** Idle compaction runs while Pi warms the cache only during Runs (`streaming`, the default). */
  #idleCompactionEnabled = true
  /** Handoffs computed while their Session was idle, for the Session's next Run. */
  readonly #pendingCompactions = new Map<string, PendingIdleCompaction>()
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
  ): Promise<'warming' | 'compacting' | 'disposed'> {
    this.#end(sessionId)
    this.#pendingCompactions.delete(sessionId)
    if (!this.#mayWarm(sessionId, session, run)) {
      return await this.#settleForIdleCompaction(sessionId, session, run)
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

  /**
   * The idle compaction to install before the Session's next Run, if one was computed and the
   * prompt cache it replaces has expired. Taken once: a Run that does not use it drops it.
   */
  takeIdleCompaction(sessionId: string): PrecomputedCompaction | undefined {
    const pending = this.#pendingCompactions.get(sessionId)
    this.#pendingCompactions.delete(sessionId)
    return idleCompactionToInstall(pending, this.#clock.now())
  }

  /** Ends the Session's warming session. Call before opening the Session's Pi file. */
  async release(sessionId: string) {
    this.#end(sessionId)
  }

  /**
   * A Run starts: its warming session ends before the Run opens the Pi file, and the mode its
   * runtime resolves applies. The user's Pi settings may have turned warming between runs on or
   * off while OpenWaggle's settings, the only ones the Host applies on change, stayed the same.
   */
  async prepareRun(sessionId: string) {
    this.#end(sessionId)
    this.applyMode(currentOpenWagglePiAppSettings().cacheWarming)
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
    this.#idleCompactionEnabled = mode === 'streaming'
    if (!this.#enabled) this.#endWarming()
    if (!this.#idleCompactionEnabled) this.#endCompactions()
  }

  closeSession(sessionId: string) {
    this.#closedSessionIds.add(sessionId)
    this.#end(sessionId)
    this.#pendingCompactions.delete(sessionId)
  }

  reopenSession(sessionId: string) {
    this.#closedSessionIds.delete(sessionId)
  }

  forgetSession(sessionId: string) {
    this.#end(sessionId)
    this.#pendingCompactions.delete(sessionId)
    this.#closedSessionIds.delete(sessionId)
  }

  start() {
    this.#stopped = false
  }

  async stop() {
    this.#stopped = true
    this.#endAll()
    this.#pendingCompactions.clear()
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

  #mayCompact(sessionId: string, run: SettledRun) {
    return (
      this.#idleCompactionEnabled &&
      !this.#stopped &&
      !run.aborted &&
      !this.#closedSessionIds.has(sessionId)
    )
  }

  async #settleForIdleCompaction(
    sessionId: string,
    session: AgentSession,
    run: SettledRun,
  ): Promise<'compacting' | 'disposed'> {
    const plan = this.#mayCompact(sessionId, run)
      ? planIdleCompaction(session, this.#clock.now(), this.#maxIdleMs)
      : undefined
    if (!plan) {
      await disposeOpenWagglePiSession(session)
      return 'disposed'
    }
    await emitOpenWagglePiSessionShutdown(session)
    if (!this.#mayCompact(sessionId, run)) {
      session.dispose()
      return 'disposed'
    }
    const kept = this.#keep(sessionId, session, { plan, abort: new AbortController() })
    if (kept.compaction) {
      kept.compaction.cancelTimer = this.#clock.after(
        Math.max(0, plan.dueAt - this.#clock.now()),
        () => void this.#computeIdleCompaction(sessionId, kept),
      )
    }
    logger.debug('Keeping the Pi session to compact it before its prompt cache expires', {
      sessionId,
    })
    return 'compacting'
  }

  async #computeIdleCompaction(sessionId: string, kept: WarmingSession) {
    const compaction = kept.compaction
    if (!compaction || this.#warmingBySessionId.get(sessionId) !== kept) return
    if (fileChangedElsewhere(kept)) {
      this.#end(sessionId, kept)
      return
    }
    try {
      const result = await kept.session.precomputeIdleCompaction({
        signal: compaction.abort.signal,
      })
      if (result && this.#warmingBySessionId.get(sessionId) === kept) {
        this.#pendingCompactions.set(sessionId, {
          compaction: result,
          cacheExpiresAt: this.#clock.now() + compaction.plan.ttlMs,
        })
        logger.debug('Computed an idle compaction', { sessionId })
      }
    } catch (error) {
      logger.warn('Idle compaction failed', { sessionId, error: String(error) })
    } finally {
      this.#end(sessionId, kept)
    }
  }

  /** Ends the Session's warming session, or only `expected` when it is still that one. */
  #end(sessionId: string, expected?: WarmingSession) {
    const warming = this.#warmingBySessionId.get(sessionId)
    if (!warming || (expected && warming !== expected)) return
    this.#warmingBySessionId.delete(sessionId)
    warming.compaction?.cancelTimer?.()
    warming.compaction?.abort.abort()
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

  #endWarming() {
    for (const [sessionId, kept] of [...this.#warmingBySessionId]) {
      if (!kept.compaction) this.#end(sessionId, kept)
    }
  }

  #endCompactions() {
    for (const [sessionId, kept] of [...this.#warmingBySessionId]) {
      if (kept.compaction) this.#end(sessionId, kept)
    }
    this.#pendingCompactions.clear()
  }

  #endStoppedSessions() {
    const now = this.#clock.now()
    for (const [sessionId, warming] of [...this.#warmingBySessionId]) {
      if (
        (!warming.compaction && !isWarming(warming.session)) ||
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

  #keep(sessionId: string, session: AgentSession, compaction?: WarmingSession['compaction']) {
    const warming: WarmingSession = {
      session,
      settledAt: this.#clock.now(),
      fileState: piFileState(session.sessionFile),
      ...(compaction ? { compaction } : {}),
    }
    this.#guardRefreshWrites(sessionId, warming)
    this.#warmingBySessionId.set(sessionId, warming)
    for (const oldest of this.#warmingBySessionId.keys()) {
      if (this.#warmingBySessionId.size <= this.#maxSessions) break
      this.#end(oldest)
    }
    this.#stopPolling ??= this.#clock.every(this.#pollMs, () => this.#endStoppedSessions())
    return warming
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
