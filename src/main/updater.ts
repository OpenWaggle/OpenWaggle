import { is } from '@electron-toolkit/utils'
import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import { UPDATER_TIMING } from '@shared/constants/time'
import { type UpdateChannel, updaterFeedChannel } from '@shared/types/update-channel'
import type { UpdateStatus } from '@shared/types/updater'
import { autoUpdater } from 'electron-updater'
import { createLogger } from './logger'
import { configureUpdaterFeed, isVersionEligibleForChannel } from './update-feed'
import { broadcastToWindows } from './utils/broadcast'

const logger = createLogger('updater')

function updatesDisabled() {
  return is.dev || BUILD_CHANNEL === 'dev'
}

let currentStatus: UpdateStatus = { type: 'idle' }
let checkInterval: ReturnType<typeof setInterval> | null = null
let currentChannel: UpdateChannel = 'stable'
let readAuthoritativeChannel: (() => Promise<UpdateChannel>) | null = null
let checkGeneration = 0
let activeUpdateCancellation: { cancel: () => void } | null = null
let activeUpdateVersion: string | null = null

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

function logUpdateCheckError(error: unknown) {
  logger.error('Update check failed', {
    message: error instanceof Error ? error.message : String(error),
  })
}

function runUpdaterCheck(generation: number) {
  void autoUpdater
    .checkForUpdates()
    .then((result) => {
      if (!result?.isUpdateAvailable) return
      if (generation !== checkGeneration) {
        result.cancellationToken?.cancel()
        return
      }
      activeUpdateCancellation = result.cancellationToken ?? null
      void result.downloadPromise?.catch(logUpdateCheckError)
    })
    .catch(logUpdateCheckError)
}

function checkConfiguredChannel(channel: UpdateChannel) {
  const channelChanged = channel !== currentChannel
  if (channelChanged) {
    activeUpdateCancellation?.cancel()
    activeUpdateCancellation = null
    activeUpdateVersion = null
    autoUpdater.autoInstallOnAppQuit = false
    if (
      currentStatus.type === 'available' ||
      currentStatus.type === 'downloading' ||
      currentStatus.type === 'downloaded'
    ) {
      setStatus({ type: 'idle' })
    }
  }
  configureUpdateChannel(channel)
  const generation = ++checkGeneration
  const configured = configureUpdaterFeed(autoUpdater, channel)
  if (!configured) {
    runUpdaterCheck(generation)
    return
  }
  void configured
    .then(() => {
      if (generation === checkGeneration) runUpdaterCheck(generation)
    })
    .catch(logUpdateCheckError)
}

export function checkForUpdates(channel?: UpdateChannel): void {
  if (updatesDisabled()) {
    logger.info('Skipping update check', { channel: BUILD_CHANNEL, dev: is.dev })
    return
  }
  if (channel || !readAuthoritativeChannel) {
    checkConfiguredChannel(channel ?? currentChannel)
    return
  }
  void readAuthoritativeChannel().then(checkConfiguredChannel).catch(logUpdateCheckError)
}

export function installUpdate(): void {
  if (
    currentStatus.type !== 'downloaded' ||
    !isVersionEligibleForChannel(currentStatus.version, currentChannel)
  ) {
    logger.warn('Ignoring install request without a channel-eligible downloaded update')
    return
  }
  autoUpdater.quitAndInstall(false, true)
}

export function initAutoUpdater(
  channel: UpdateChannel,
  readChannel?: () => Promise<UpdateChannel>,
): void {
  if (updatesDisabled()) {
    logger.info('Auto-updater disabled', { channel: BUILD_CHANNEL, dev: is.dev })
    return
  }

  configureUpdateChannel(channel)
  readAuthoritativeChannel = readChannel ?? null
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null // We use our own logger

  autoUpdater.on('checking-for-update', () => {
    logger.info('Checking for update')
    setStatus({ type: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    if (!isVersionEligibleForChannel(info.version, currentChannel)) {
      activeUpdateVersion = null
      autoUpdater.autoInstallOnAppQuit = false
      logger.warn('Ignoring update available for a superseded channel', {
        channel: currentChannel,
        version: info.version,
      })
      return
    }
    activeUpdateVersion = info.version
    logger.info('Update available', { version: info.version })
    setStatus({ type: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    activeUpdateVersion = null
    logger.info('No update available')
    setStatus({ type: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    if (!activeUpdateVersion) return
    setStatus({
      type: 'downloading',
      version: activeUpdateVersion,
      percent: Math.round(progress.percent),
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    if (!isVersionEligibleForChannel(info.version, currentChannel)) {
      activeUpdateCancellation = null
      activeUpdateVersion = null
      autoUpdater.autoInstallOnAppQuit = false
      logger.warn('Ignoring update downloaded for a superseded channel', {
        channel: currentChannel,
        version: info.version,
      })
      return
    }
    activeUpdateCancellation = null
    activeUpdateVersion = null
    autoUpdater.autoInstallOnAppQuit = true
    logger.info('Update downloaded', { version: info.version })
    setStatus({ type: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (error) => {
    activeUpdateCancellation = null
    activeUpdateVersion = null
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
  checkGeneration += 1
  activeUpdateCancellation?.cancel()
  activeUpdateCancellation = null
  activeUpdateVersion = null
  readAuthoritativeChannel = null
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}
