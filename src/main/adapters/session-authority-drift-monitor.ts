import { clearInterval, setInterval } from 'node:timers'
import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SESSION_AUTHORITY_REVISION_TABLE } from '../services/session-authority-revision-schema'

/** What one Run's authority check found. */
export type AuthorityDriftOutcome = 'current' | 'changed' | 'unverifiable'

export interface AuthorityDriftWatch {
  /** The Run's full check: revocable caller ancestry, Workspace binding and filesystem roots. */
  readonly check: () => Promise<AuthorityDriftOutcome>
  /** Called once, with the first check that is not `current`. */
  readonly onDrift: (outcome: Exclude<AuthorityDriftOutcome, 'current'>) => void
}

export interface AuthorityDriftMonitorOptions {
  /** The durable authority revision every authority writer's trigger bumps; null if unreadable. */
  readonly readRevision: () => Promise<number | null>
  readonly revisionPollMs?: number
  readonly safetyPollMs?: number
  readonly setTimer?: (callback: () => void, intervalMs: number) => () => void
}

/** How often one Host-wide query reads the authority revision while any Run is watched. */
export const AUTHORITY_REVISION_POLL_INTERVAL_MS = 500
/**
 * How often every watched Run is checked in full regardless: the filesystem roots (a symlink
 * swapped outside OpenWaggle) change without any write the revision sees.
 */
export const AUTHORITY_SAFETY_POLL_INTERVAL_MS = 2_000

function defaultTimer(callback: () => void, intervalMs: number) {
  const handle = setInterval(callback, intervalMs)
  handle.unref()
  return () => clearInterval(handle)
}

/**
 * Watches active Runs for authority drift (D4). Each Run used to poll its own full check every
 * 100 ms: two to four queries plus a `realpath` and `stat` of every authority root, ten times a
 * second per Run (57-72 Host wakeups a second with six Runs).
 *
 * One Host-wide timer now reads a single trigger-maintained revision. Any write to a profile,
 * grant, lineage, execution profile, Workspace binding or Workspace bumps it, so a revocation is
 * seen within `revisionPollMs`, and `signal()` lets an in-Host writer have it checked at once.
 * The full check runs only on a revision change, a signal, or the slower safety poll.
 */
export function createAuthorityDriftMonitor(options: AuthorityDriftMonitorOptions) {
  const revisionPollMs = options.revisionPollMs ?? AUTHORITY_REVISION_POLL_INTERVAL_MS
  const safetyPollMs = options.safetyPollMs ?? AUTHORITY_SAFETY_POLL_INTERVAL_MS
  const setTimer = options.setTimer ?? defaultTimer
  const watches = new Set<AuthorityDriftWatch>()
  const checking = new Set<AuthorityDriftWatch>()
  let stopTimer: (() => void) | undefined
  let lastRevision: number | null | undefined
  let lastFullCheckAt = 0
  let ticking = false

  function checkWatch(watch: AuthorityDriftWatch) {
    if (checking.has(watch) || !watches.has(watch)) return
    checking.add(watch)
    // A check that throws before it returns its promise fails closed like one that rejects.
    void Promise.resolve()
      .then(() => watch.check())
      .catch((): AuthorityDriftOutcome => 'unverifiable')
      .then((outcome) => {
        if (outcome === 'current' || !watches.has(watch)) return
        watches.delete(watch)
        watch.onDrift(outcome)
      })
      .finally(() => {
        checking.delete(watch)
        if (watches.size === 0) stop()
      })
  }

  function checkAll() {
    lastFullCheckAt = Date.now()
    for (const watch of [...watches]) checkWatch(watch)
  }

  async function tick() {
    if (ticking) return
    ticking = true
    try {
      const revision = await options.readRevision().catch(() => null)
      const changed = revision === null || revision !== lastRevision
      lastRevision = revision
      if (changed || Date.now() - lastFullCheckAt >= safetyPollMs) checkAll()
    } finally {
      ticking = false
    }
  }

  function stop() {
    stopTimer?.()
    stopTimer = undefined
  }

  return {
    /** Starts watching one Run; the returned function stops it. */
    watch(watch: AuthorityDriftWatch) {
      watches.add(watch)
      if (!stopTimer) {
        lastRevision = undefined
        stopTimer = setTimer(() => void tick(), Math.min(revisionPollMs, safetyPollMs))
      }
      return () => {
        watches.delete(watch)
        if (watches.size === 0) stop()
      }
    },
    /** An in-Host writer changed authority: check every watched Run now. */
    signal() {
      checkAll()
    },
    watchedCount() {
      return watches.size
    },
  }
}

export type AuthorityDriftMonitor = ReturnType<typeof createAuthorityDriftMonitor>

function readAuthorityRevision(sql: SqlClient.SqlClient) {
  return Effect.runPromise(
    sql
      .unsafe<{ readonly revision: number }>(
        `SELECT revision FROM ${SESSION_AUTHORITY_REVISION_TABLE} WHERE singleton = 1`,
      )
      .pipe(
        Effect.map((rows) => rows[0]?.revision ?? 0),
        Effect.catchAll(() => Effect.succeed(null)),
      ),
  )
}

const monitors = new WeakMap<SqlClient.SqlClient, AuthorityDriftMonitor>()

/** The Host's one monitor for its database connection. */
export function authorityDriftMonitorFor(sql: SqlClient.SqlClient) {
  let monitor = monitors.get(sql)
  if (!monitor) {
    monitor = createAuthorityDriftMonitor({ readRevision: () => readAuthorityRevision(sql) })
    monitors.set(sql, monitor)
  }
  return monitor
}

/** Tells every Run of this connection's Host to recheck its authority now. */
export function signalSessionAuthorityChanged(sql: SqlClient.SqlClient) {
  monitors.get(sql)?.signal()
}
