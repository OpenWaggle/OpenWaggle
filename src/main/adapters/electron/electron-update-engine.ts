import { type AppUpdater, autoUpdater } from 'electron-updater'
import type { UpdateEngineShape } from '../../ports/desktop-shell/update-engine'

/**
 * electron-updater. Its `autoUpdater` getter creates the platform updater on first use, so every
 * method reads it when called and nothing touches it at import.
 */
function updater() {
  return autoUpdater
}

function subscribe(event: Parameters<AppUpdater['on']>[0], handler: (...args: never[]) => void) {
  updater().on(event, handler)
  return () => {
    updater().off(event, handler)
  }
}

export const electronUpdateEngine: UpdateEngineShape = {
  configure: ({ feedChannel, allowPrerelease }) => {
    const engine = updater()
    engine.channel = feedChannel
    engine.allowPrerelease = allowPrerelease
    // The channel setter enables downgrade support. OpenWaggle channels may widen
    // eligibility, but they must never replace a newer installed version with an older one.
    engine.allowDowngrade = false
    engine.logger = null
  },
  setAutoDownload: (autoDownload) => {
    updater().autoDownload = autoDownload
  },
  setFeed: (feed) => updater().setFeedURL(feed),
  cancelInstallOnQuit: () => {
    updater().autoInstallOnAppQuit = false
  },
  checkForUpdates: () =>
    updater()
      .checkForUpdates()
      .then((result) =>
        result?.isUpdateAvailable
          ? {
              version: result.updateInfo.version,
              download: result.downloadPromise ?? null,
              cancelDownload: () => result.cancellationToken?.cancel(),
            }
          : null,
      ),
  quitAndInstall: ({ silent, relaunch }) => updater().quitAndInstall(silent, relaunch),
  onCheckingForUpdate: (listener) => subscribe('checking-for-update', () => listener()),
  onUpdateAvailable: (listener) =>
    subscribe('update-available', (info: { readonly version: string }) => listener(info.version)),
  onUpdateNotAvailable: (listener) => subscribe('update-not-available', () => listener()),
  onDownloadProgress: (listener) =>
    subscribe('download-progress', (progress: { readonly percent: number }) =>
      listener(progress.percent),
    ),
  onUpdateDownloaded: (listener) =>
    subscribe('update-downloaded', (info: { readonly version: string }) => listener(info.version)),
  onError: (listener) => subscribe('error', (error: Error) => listener(error)),
}
