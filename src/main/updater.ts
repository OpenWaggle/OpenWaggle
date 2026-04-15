import { is } from '@electron-toolkit/utils'
import { UPDATER_TIMING } from '@shared/constants/time'
import type { UpdateStatus } from '@shared/types/updater'
import { autoUpdater } from 'electron-updater'
import { createLogger } from './logger'
import { broadcastToWindows } from './utils/broadcast'

const logger = createLogger('updater')

let currentStatus: UpdateStatus = { type: 'idle' }
let checkInterval: ReturnType<typeof setInterval> | null = null

function setStatus(status: UpdateStatus): void {
  currentStatus = status
  broadcastToWindows('updater:status-changed', status)
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

export function checkForUpdates(): void {
  if (is.dev) {
    logger.info('Skipping update check in dev mode')
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
  if (is.dev) {
    logger.info('Auto-updater disabled in dev mode')
    return
  }

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
