import { createLogger } from './logger'
import { recordUpdateInstallAttempt, settleUpdateInstallAttempt } from './update-install-attempt'
import { type DownloadedUpdateStatus, getUpdateStatus, setUpdateStatus } from './update-status'

/**
 * What happens to Restart to update after the app hands it to the installer (ADR 0047): the app
 * is quitting from then on, the attempt is recorded for the next launch, and a failed attempt is
 * explained when that version is ready to install again.
 */

export interface UpdaterInstallEnvironment {
  readonly userDataDirectory: string
  readonly currentVersion: string
  /** Names macOS Squirrel's log directory. */
  readonly bundleIdentifier: string
}

const logger = createLogger('updater')
/**
 * Squirrel.Mac unpacks and verifies the update before the app quits. If it neither quits nor
 * reports an error in this time, the restart is reported as failed so it can be tried again.
 */
export const UPDATE_INSTALL_WATCHDOG_MS = 180_000

let installingVersion: string | null = null
let watchdog: ReturnType<typeof setTimeout> | null = null
let environment: UpdaterInstallEnvironment | null = null
let previousFailure: { readonly version: string; readonly message: string } | null = null

/** Whether the app is quitting to install an update, so the quit must also release the Host. */
export function isInstallingUpdate(): boolean {
  return installingVersion !== null
}

export function downloadedUpdateStatus(version: string): DownloadedUpdateStatus {
  return previousFailure?.version === version
    ? { type: 'downloaded', version, installFailure: previousFailure.message }
    : { type: 'downloaded', version }
}

/** Starts a new updater session and reports whether the last Restart to update installed. */
export function resetUpdateInstall(next: UpdaterInstallEnvironment | null) {
  stopUpdateInstallWatchdog()
  environment = next
  installingVersion = null
  previousFailure = null
  if (!next) return
  void settleUpdateInstallAttempt(next).then((outcome) => {
    if (outcome?.type !== 'failed') return
    previousFailure = { version: outcome.version, message: outcome.message }
    const status = getUpdateStatus()
    if (status.type === 'downloaded' && status.version === outcome.version) {
      const waiting = status.waitingForRuns
      const downloaded = downloadedUpdateStatus(outcome.version)
      setUpdateStatus(
        waiting === undefined ? downloaded : { ...downloaded, waitingForRuns: waiting },
      )
    }
  })
}

/**
 * Shows the restart at once: macOS Squirrel unpacks and verifies the update before the app quits,
 * and a user who sees nothing happen reopens the old version, which makes the install fail.
 */
export async function beginUpdateInstall(version: string) {
  installingVersion = version
  previousFailure = null
  setUpdateStatus({ type: 'installing', version })
  stopUpdateInstallWatchdog()
  watchdog = setTimeout(() => {
    watchdog = null
    failUpdateInstall(new Error('the installer did not start'))
  }, UPDATE_INSTALL_WATCHDOG_MS)
  if (environment) {
    await recordUpdateInstallAttempt(environment.userDataDirectory, {
      fromVersion: environment.currentVersion,
      toVersion: version,
      attemptedAt: Date.now(),
    })
  }
  logger.info('Installing update', { version })
}

/**
 * An updater error while installing means the app did not quit, so the downloaded update is still
 * there: say why and offer it again. Returns whether the error belonged to an install.
 */
export function failUpdateInstall(error: Error): boolean {
  const version = installingVersion
  if (!version) return false
  stopUpdateInstallWatchdog()
  installingVersion = null
  const reason = error.message.replace(/\.+$/, '')
  const message = `Version ${version} could not be installed: ${reason}. Restart to update to try again.`
  logger.error('Update install failed', { version, message: error.message })
  // The attempt record stays: it is true that this version did not install, and a retry
  // overwrites it.
  previousFailure = { version, message }
  setUpdateStatus(downloadedUpdateStatus(version))
  return true
}

/** The app has started quitting; from here only the next launch can tell how the install went. */
export function stopUpdateInstallWatchdog() {
  if (watchdog) clearTimeout(watchdog)
  watchdog = null
}
