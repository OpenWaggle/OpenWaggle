import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import { UPDATER_TIMING } from '@shared/constants/time'
import { type UpdateChannel, updaterFeedChannel } from '@shared/types/update-channel'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { updateEngine } from './desktop-shell/update-engine'
import { createLogger } from './logger'
import type { UpdateFeedSelection } from './update-feed'
import { configureUpdaterFeed, isVersionEligibleForChannel } from './update-feed'
import * as install from './update-install-tracker'
import { getUpdateStatus, setUpdateStatus as setStatus } from './update-status'

export { isInstallingUpdate } from './update-install-tracker'
export { getUpdateStatus, setUpdateWaitingForRuns } from './update-status'

const logger = createLogger('updater')

const isDevBuild = () => !appLifecycle.isPackaged()

function updatesDisabled() {
  return isDevBuild() || BUILD_CHANNEL === 'dev'
}

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

function configureUpdateChannel(channel: UpdateChannel) {
  currentChannel = channel
  // Channels widen eligibility but never downgrade (the engine forbids it).
  updateEngine.configure({
    feedChannel: updaterFeedChannel(channel),
    allowPrerelease: channel !== 'stable',
  })
}

function logUpdateCheckError(error: unknown) {
  logger.error('Update check failed', { message: updateCheckErrorMessage(error) })
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

async function runUpdaterCheck(generation: number, selection: UpdateFeedSelection) {
  if (selection.type === 'no-release') return setStatus({ type: 'not-available' })
  const result = await updateEngine.checkForUpdates()
  if (!result) return
  if (generation !== checkGeneration) {
    result.cancelDownload()
    await waitForDownload(result.download)
    return
  }
  if (!isVersionEligibleForChannel(result.version, currentChannel)) {
    result.cancelDownload()
    activeUpdateCancellation = null
    activeUpdateVersion = null
    updateEngine.cancelInstallOnQuit()
    setStatus({ type: 'not-available' })
    await waitForDownload(result.download)
    return
  }
  activeUpdateCancellation = { cancel: result.cancelDownload }
  await waitForDownload(result.download)
}

function startUpdaterCheck(channel: UpdateChannel, generation: number) {
  let operation: Promise<void>
  try {
    operation = configureUpdaterFeed({ setFeedURL: updateEngine.setFeed }, channel).then(
      (selection) => {
        if (generation !== checkGeneration) return
        acceptUpdaterEvents = true
        return runUpdaterCheck(generation, selection)
      },
    )
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
    updateEngine.cancelInstallOnQuit()
    const status = getUpdateStatus().type
    if (status === 'available' || status === 'downloading' || status === 'downloaded') {
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

export function checkForUpdates(channel?: UpdateChannel) {
  if (updatesDisabled()) {
    logger.info('Skipping update check', { channel: BUILD_CHANNEL, dev: isDevBuild() })
    return
  }
  if (install.isInstallingUpdate()) return
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

export async function installUpdate() {
  const downloaded = getUpdateStatus()
  if (downloaded.type !== 'downloaded') {
    logger.warn('Ignoring install request without a channel-eligible downloaded update')
    return
  }
  const requestedVersion = downloaded.version
  const requestGeneration = updateCheckRequestGeneration
  updateEngine.cancelInstallOnQuit()
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
  const current = getUpdateStatus()
  if (
    requestGeneration !== updateCheckRequestGeneration ||
    current.type !== 'downloaded' ||
    current.version !== requestedVersion
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
  // The app is quitting from here: no check may change the status or start a download.
  checkGeneration += 1
  acceptUpdaterEvents = false
  await install.beginUpdateInstall(requestedVersion)
  updateEngine.quitAndInstall({ silent: true, relaunch: true }) // as pingdotgg/t3code does
}

export function initAutoUpdater(
  channel: UpdateChannel,
  readChannel?: () => Promise<UpdateChannel>,
  environment?: install.UpdaterInstallEnvironment,
) {
  if (updatesDisabled()) {
    logger.info('Auto-updater disabled', { channel: BUILD_CHANNEL, dev: isDevBuild() })
    return
  }

  install.resetUpdateInstall(environment ?? null)
  configureUpdateChannel(channel)
  readAuthoritativeChannel = readChannel ?? null
  acceptUpdaterEvents = true
  updateEngine.setAutoDownload(true)
  // Installation must always pass through installUpdate so the shared Session Host
  // channel is re-read immediately before quitAndInstall.
  updateEngine.cancelInstallOnQuit()

  updateEngine.onCheckingForUpdate(() => {
    if (!acceptUpdaterEvents) return
    logger.info('Checking for update')
    setStatus({ type: 'checking' })
  })

  updateEngine.onUpdateAvailable((version) => {
    if (!acceptUpdaterEvents) return
    if (!isVersionEligibleForChannel(version, currentChannel)) {
      activeUpdateVersion = null
      updateEngine.cancelInstallOnQuit()
      logger.warn('Ignoring update available for a superseded channel', {
        channel: currentChannel,
        version,
      })
      return
    }
    activeUpdateVersion = version
    logger.info('Update available', { version })
    setStatus({ type: 'available', version })
  })

  updateEngine.onUpdateNotAvailable(() => {
    if (!acceptUpdaterEvents) return
    activeUpdateVersion = null
    logger.info('No update available')
    setStatus({ type: 'not-available' })
  })

  updateEngine.onDownloadProgress((percent) => {
    if (!acceptUpdaterEvents) return
    if (!activeUpdateVersion) return
    setStatus({
      type: 'downloading',
      version: activeUpdateVersion,
      percent: Math.round(percent),
    })
  })

  updateEngine.onUpdateDownloaded((version) => {
    if (!acceptUpdaterEvents) return
    if (!isVersionEligibleForChannel(version, currentChannel)) {
      activeUpdateCancellation = null
      activeUpdateVersion = null
      updateEngine.cancelInstallOnQuit()
      logger.warn('Ignoring update downloaded for a superseded channel', {
        channel: currentChannel,
        version,
      })
      return
    }
    activeUpdateCancellation = null
    activeUpdateVersion = null
    updateEngine.cancelInstallOnQuit()
    logger.info('Update downloaded', { version })
    setStatus(install.downloadedUpdateStatus(version))
  })

  updateEngine.onError((error) => {
    // Squirrel.Mac unpacks and verifies the update only after Restart to update.
    if (install.failUpdateInstall(error)) return
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

export function disposeAutoUpdater() {
  // The app is quitting; an install in progress stays in progress for the quit to release the Host.
  install.stopUpdateInstallWatchdog()
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
