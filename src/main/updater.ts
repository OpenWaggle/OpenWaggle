import { is } from '@electron-toolkit/utils'
import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import { UPDATER_TIMING } from '@shared/constants/time'
import { type UpdateChannel, updaterFeedChannel } from '@shared/types/update-channel'
import type { UpdateStatus } from '@shared/types/updater'
import { autoUpdater } from 'electron-updater'
import { createLogger } from './logger'
import { broadcastToWindows } from './utils/broadcast'

const logger = createLogger('updater')

function updatesDisabled() {
  return is.dev || BUILD_CHANNEL === 'dev'
}

let currentStatus: UpdateStatus = { type: 'idle' }
let checkInterval: ReturnType<typeof setInterval> | null = null
let currentChannel: UpdateChannel = 'stable'

function configureUpdateChannel(channel: UpdateChannel) {
  currentChannel = channel
  autoUpdater.channel = updaterFeedChannel(channel)
  autoUpdater.allowPrerelease = channel !== 'stable'
  // The channel setter enables downgrade support. OpenWaggle channels may widen
  // eligibility, but they must never replace a newer installed version with an older one.
  autoUpdater.allowDowngrade = false
}

function setStatus(status: UpdateStatus) {
  currentStatus = status
  broadcastToWindows('updater:status-changed', status)
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

export function checkForUpdates(channel: UpdateChannel = currentChannel): void {
  if (updatesDisabled()) {
    logger.info('Skipping update check', { channel: BUILD_CHANNEL, dev: is.dev })
    return
  }
  configureUpdateChannel(channel)
  autoUpdater.checkForUpdates().catch((error: unknown) => {
    logger.error('Update check failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}

export function initAutoUpdater(channel: UpdateChannel): void {
  if (updatesDisabled()) {
    logger.info('Auto-updater disabled', { channel: BUILD_CHANNEL, dev: is.dev })
    return
  }

  configureUpdateChannel(channel)
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

  logger.info('Auto-updater initialized', { channel })
}

export function disposeAutoUpdater(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}
