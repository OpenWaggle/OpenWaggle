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
let updateCheckRequestGeneration = 0
let checkGeneration = 0
let activeUpdateCancellation: { cancel: () => void } | null = null
let activeUpdateVersion: string | null = null
let activeCheckPromise: Promise<void> | null = null
let queuedUpdateCheck: { readonly channel: UpdateChannel; readonly generation: number } | null =
  null
let acceptUpdaterEvents = true

function autoInstallOnQuitForPlatform() {
  // MacUpdater dispatches its public download event before Squirrel.Mac stages the zip.
  // Keeping this disabled means channel changes can invalidate a downloaded zip before
  // the explicit Restart action asks Squirrel to stage and install that exact version.
  return process.platform !== 'darwin'
}

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

function updateCheckErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function reportUpdateCheckError(error: unknown, generation: number) {
  logUpdateCheckError(error)
  if (generation !== checkGeneration) return
  setStatus({ type: 'error', message: updateCheckErrorMessage(error) })
}

async function waitForDownload(downloadPromise: Promise<unknown> | null | undefined) {
  try {
    await downloadPromise
  } catch (error) {
    logUpdateCheckError(error)
  }
}

async function runUpdaterCheck(generation: number) {
  const result = await autoUpdater.checkForUpdates()
  if (!result?.isUpdateAvailable) return
  if (generation !== checkGeneration) {
    result.cancellationToken?.cancel()
    await waitForDownload(result.downloadPromise)
    return
  }
  if (!isVersionEligibleForChannel(result.updateInfo.version, currentChannel)) {
    result.cancellationToken?.cancel()
    activeUpdateCancellation = null
    activeUpdateVersion = null
    autoUpdater.autoInstallOnAppQuit = false
    setStatus({ type: 'not-available' })
    await waitForDownload(result.downloadPromise)
    return
  }
  activeUpdateCancellation = result.cancellationToken ?? null
  await waitForDownload(result.downloadPromise)
}

function startUpdaterCheck(channel: UpdateChannel, generation: number) {
  let operation: Promise<void>
  try {
    const configured = configureUpdaterFeed(autoUpdater, channel)
    operation = configured
      ? configured.then(() => {
          if (generation !== checkGeneration) return
          acceptUpdaterEvents = true
          return runUpdaterCheck(generation)
        })
      : (() => {
          acceptUpdaterEvents = true
          return runUpdaterCheck(generation)
        })()
  } catch (error) {
    reportUpdateCheckError(error, generation)
    return
  }
  const tracked = operation
    .catch((error: unknown) => reportUpdateCheckError(error, generation))
    .finally(() => {
      if (activeCheckPromise !== tracked) return
      activeCheckPromise = null
      const queued = queuedUpdateCheck
      queuedUpdateCheck = null
      if (queued?.generation === checkGeneration) {
        startUpdaterCheck(queued.channel, queued.generation)
      }
    })
  activeCheckPromise = tracked
}

function checkConfiguredChannel(channel: UpdateChannel) {
  const channelChanged = channel !== currentChannel
  if (channelChanged) {
    activeUpdateCancellation?.cancel()
    activeUpdateCancellation = null
    activeUpdateVersion = null
    acceptUpdaterEvents = false
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
  if (activeCheckPromise) {
    queuedUpdateCheck = { channel, generation }
    return
  }
  startUpdaterCheck(channel, generation)
}

export function checkForUpdates(channel?: UpdateChannel): void {
  if (updatesDisabled()) {
    logger.info('Skipping update check', { channel: BUILD_CHANNEL, dev: is.dev })
    return
  }
  const requestGeneration = ++updateCheckRequestGeneration
  if (channel || !readAuthoritativeChannel) {
    checkConfiguredChannel(channel ?? currentChannel)
    return
  }
  void readAuthoritativeChannel()
    .then((authoritativeChannel) => {
      if (requestGeneration !== updateCheckRequestGeneration) return
      checkConfiguredChannel(authoritativeChannel)
    })
    .catch((error: unknown) => {
      logUpdateCheckError(error)
      if (requestGeneration !== updateCheckRequestGeneration) return
      setStatus({ type: 'error', message: updateCheckErrorMessage(error) })
    })
}

export async function installUpdate(): Promise<void> {
  if (currentStatus.type !== 'downloaded') {
    logger.warn('Ignoring install request without a channel-eligible downloaded update')
    return
  }
  const requestedVersion = currentStatus.version
  const requestGeneration = updateCheckRequestGeneration
  autoUpdater.autoInstallOnAppQuit = false
  let authoritativeChannel = currentChannel
  if (readAuthoritativeChannel) {
    try {
      authoritativeChannel = await readAuthoritativeChannel()
    } catch (error) {
      logUpdateCheckError(error)
      setStatus({ type: 'error', message: updateCheckErrorMessage(error) })
      return
    }
  }
  if (
    requestGeneration !== updateCheckRequestGeneration ||
    currentStatus.type !== 'downloaded' ||
    currentStatus.version !== requestedVersion
  ) {
    logger.warn('Ignoring install request after updater state changed')
    return
  }
  if (authoritativeChannel !== currentChannel) {
    checkGeneration += 1
    activeUpdateCancellation?.cancel()
    activeUpdateCancellation = null
    activeUpdateVersion = null
    acceptUpdaterEvents = false
    configureUpdateChannel(authoritativeChannel)
  }
  if (!isVersionEligibleForChannel(requestedVersion, authoritativeChannel)) {
    setStatus({ type: 'not-available' })
    logger.warn('Ignoring install request for an update outside the authoritative channel')
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
  acceptUpdaterEvents = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = autoInstallOnQuitForPlatform()
  autoUpdater.logger = null // We use our own logger

  autoUpdater.on('checking-for-update', () => {
    if (!acceptUpdaterEvents) return
    logger.info('Checking for update')
    setStatus({ type: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    if (!acceptUpdaterEvents) return
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
    if (!acceptUpdaterEvents) return
    activeUpdateVersion = null
    logger.info('No update available')
    setStatus({ type: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    if (!acceptUpdaterEvents) return
    if (!activeUpdateVersion) return
    setStatus({
      type: 'downloading',
      version: activeUpdateVersion,
      percent: Math.round(progress.percent),
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    if (!acceptUpdaterEvents) return
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
    autoUpdater.autoInstallOnAppQuit = autoInstallOnQuitForPlatform()
    logger.info('Update downloaded', { version: info.version })
    setStatus({ type: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (error) => {
    if (!acceptUpdaterEvents) return
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
  updateCheckRequestGeneration += 1
  checkGeneration += 1
  activeUpdateCancellation?.cancel()
  activeUpdateCancellation = null
  activeUpdateVersion = null
  activeCheckPromise = null
  queuedUpdateCheck = null
  acceptUpdaterEvents = false
  readAuthoritativeChannel = null
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}
