import { isMatching } from '@diegogbrisa/ts-match'
import { app } from 'electron'

const DESKTOP_INSTANCE_PROBE = { openwaggleInstanceProbe: 'update-cli' } as const

interface DesktopInstanceLock {
  readonly requestSingleInstanceLock: (additionalData?: Record<string, string>) => boolean
  readonly releaseSingleInstanceLock: () => void
}

/** A probe carries this data so the running desktop app ignores it instead of focusing a window. */
export function isDesktopInstanceProbe(additionalData: unknown) {
  return isMatching(DESKTOP_INSTANCE_PROBE, additionalData)
}

/**
 * Whether the desktop app currently holds the single-instance lock. The probe releases the lock
 * immediately when it wins it, so it never keeps a later desktop launch from starting.
 */
export function isDesktopAppRunning(lock: DesktopInstanceLock = app) {
  if (!lock.requestSingleInstanceLock({ ...DESKTOP_INSTANCE_PROBE })) return true
  lock.releaseSingleInstanceLock()
  return false
}
