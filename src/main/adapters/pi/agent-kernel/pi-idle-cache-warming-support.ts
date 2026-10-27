import { statSync } from 'node:fs'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { IdleCompactionPlan } from './pi-idle-compaction'

interface PiFileState {
  readonly size: number
  readonly mtimeMs: number
}

export interface WarmingSession {
  readonly session: AgentSession
  readonly settledAt: number
  /** The Pi file as the Run, then this session's own refreshes, left it. */
  fileState: PiFileState | null
  /** Set when the session is kept to compute an idle compaction, not to warm the cache. */
  readonly compaction?: {
    readonly plan: IdleCompactionPlan
    readonly abort: AbortController
    cancelTimer?: () => void
  }
}

export function piFileState(file: string | undefined): PiFileState | null {
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
export function fileChangedElsewhere(warming: WarmingSession) {
  const current = piFileState(warming.session.sessionFile)
  const left = warming.fileState
  if (!current || !left) return current !== left
  return current.size !== left.size || current.mtimeMs !== left.mtimeMs
}

export interface IdleCacheWarmingClock {
  readonly now: () => number
  /** Calls `tick` every `ms` until the returned function is called. */
  readonly every: (ms: number, tick: () => void) => () => void
  /** Calls `run` once after `ms` unless the returned function is called first. */
  readonly after: (ms: number, run: () => void) => () => void
}

export interface IdleCacheWarmingOptions {
  readonly clock?: IdleCacheWarmingClock
  /** Warming sessions kept at once; the longest-settled one ends first. */
  readonly maxSessions?: number
  /** Pi's own idle limit is 30 minutes; this bounds a warming session if Pi never stops. */
  readonly maxIdleMs?: number
  /** How often to check whether Pi has stopped warming. */
  readonly pollMs?: number
}

export const DEFAULT_MAX_SESSIONS = 8
export const DEFAULT_MAX_IDLE_MS = 31 * 60_000
export const DEFAULT_POLL_MS = 15_000

export const systemClock: IdleCacheWarmingClock = {
  now: () => Date.now(),
  every: (ms, tick) => {
    const handle = setInterval(tick, ms)
    handle.unref()
    return () => clearInterval(handle)
  },
  after: (ms, run) => {
    const handle = setTimeout(run, ms)
    handle.unref()
    return () => clearTimeout(handle)
  },
}

/** Pi stops warming when a Run settles unless warming between runs, so its status is enough. */
export function isWarming(session: AgentSession) {
  const status = session.cacheWarmingStatus
  return status !== undefined && status.state !== 'inactive'
}

export interface SettledRun {
  readonly aborted: boolean
}
