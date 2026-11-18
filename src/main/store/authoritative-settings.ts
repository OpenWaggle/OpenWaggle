/**
 * The Settings this process may act on, published by the settings store and read by code that
 * must not act on Settings that have not loaded (Usage statistics and error reports). Kept apart
 * from the store so its readers do not load the store itself.
 */
import type { Settings } from '@shared/types/settings'
import { createLogger } from '../logger'
import { isAppDatabaseClientIsolated } from '../services/database-access-mode'

const logger = createLogger('settings')

/** Receives the authoritative Settings, or `undefined` while this process has none. */
export type AuthoritativeSettingsListener = (settings: Settings | undefined) => void

const listeners = new Set<AuthoritativeSettingsListener>()
let current: Settings | undefined
/** The last snapshot hydrated from the Session Host; the only authority in an attached GUI. */
let hostSnapshot: Settings | undefined

/**
 * Settings-store hook, called on every snapshot or readiness change. A process that owns the
 * database acts on its loaded snapshot. An attached GUI's own database is an empty in-memory one
 * whose defaults mean nothing (statistics would read as on), so only a snapshot hydrated from the
 * Host counts there.
 */
export function publishSettingsStoreState(ready: boolean, settings: Settings, fromHost: boolean) {
  if (fromHost) hostSnapshot = settings
  if (isAppDatabaseClientIsolated()) publishAuthoritativeSettings(hostSnapshot)
  else publishAuthoritativeSettings(ready ? settings : undefined)
}

export function resetHostSnapshotForTests() {
  hostSnapshot = undefined
}

function publishAuthoritativeSettings(settings: Settings | undefined) {
  current = settings
  for (const listener of [...listeners]) {
    try {
      listener(settings)
    } catch (error) {
      logger.warn('An authoritative Settings listener failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Calls `listener` now and after every change with the Settings this process may act on.
 * Returns the unsubscribe function.
 */
export function onAuthoritativeSettingsChange(listener: AuthoritativeSettingsListener) {
  listeners.add(listener)
  listener(current)
  return () => {
    listeners.delete(listener)
  }
}
