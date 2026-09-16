import { is } from '@electron-toolkit/utils'
import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import { UPDATER_TIMING } from '@shared/constants/time'
import type { UpdateStatus } from '@shared/types/updater'
import { autoUpdater } from 'electron-updater'
import { createLogger } from './logger'
import { broadcastToWindows } from './utils/broadcast'

const logger = createLogger('updater')

// A build only ever updates along its own Build channel's feed (docs/adr/0032).
// Dev builds never auto-update.
const UPDATER_FEED_CHANNEL = {
  stable: 'latest',
  alpha: 'alpha',
  beta: 'beta',
  rc: 'rc',
  dev: 'latest',
} as const

function updatesDisabled() {
  return is.dev || BUILD_CHANNEL === 'dev'
}

let currentStatus: UpdateStatus = { type: 'idle' }
let checkInterval: ReturnType<typeof setInterval> | null = null

function setStatus(status: UpdateStatus) {
  currentStatus = status
  broadcastToWindows('updater:status-changed', status)
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

export function checkForUpdates(): void {
  if (updatesDisabled()) {
    logger.info('Skipping update check', { channel: BUILD_CHANNEL, dev: is.dev })
    return
  }
  autoUpdater.checkForUpdates().catch((error: unknown) => {
    logger.error('Update check failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}

export function initAutoUpdater(): void {
  if (updatesDisabled()) {
    logger.info('Auto-updater disabled', { channel: BUILD_CHANNEL, dev: is.dev })
    return
  }

  autoUpdater.channel = UPDATER_FEED_CHANNEL[BUILD_CHANNEL]
  autoUpdater.allowPrerelease = BUILD_CHANNEL !== 'stable'
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null // We use our own logger

  autoUpdater.on('checking-for-update', () => {
    logger.info('Checking for update')
    setStatus({ type: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    logger.info('Update available', { version: info.version })
    setStatus({ type: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    logger.info('No update available')
    setStatus({ type: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    setStatus({
      type: 'downloading',
      version: currentStatus.type === 'available' ? currentStatus.version : 'unknown',
      percent: Math.round(progress.percent),
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    logger.info('Update downloaded', { version: info.version })
    setStatus({ type: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (error) => {
    logger.error('Auto-updater error', { message: error.message })
    setStatus({ type: 'error', message: error.message })
  })

  // Initial check after a short delay, then periodic checks
  setTimeout(() => {
    checkForUpdates()
    checkInterval = setInterval(checkForUpdates, UPDATER_TIMING.CHECK_INTERVAL_MS)
  }, UPDATER_TIMING.INITIAL_CHECK_DELAY_MS)

  logger.info('Auto-updater initialized')
}

export function disposeAutoUpdater(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}
