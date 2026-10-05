import { APP_ID } from '@shared/build-identity-runtime'
import { app, autoUpdater as nativeAutoUpdater } from 'electron'
import { invokeConfiguredHostUi } from './application/gui-session-command-router'
import { describeError } from './error-description'
import { createLogger } from './logger'

const logger = createLogger('gui-auto-updater')

let started: { readonly dispose: () => void; readonly releasesHost: () => boolean } | null = null

/**
 * Starts the desktop app's updater once the main window exists. It is imported lazily to keep it
 * off the startup path, and it re-reads the Update channel from the Session Host before checks.
 */
export async function startGuiAutoUpdater() {
  try {
    const { disposeAutoUpdater, initAutoUpdater } = await import('./updater')
    const { markUpdateQuit, shouldReleaseHostOnQuit } = await import('./update-install-tracker')
    started = { dispose: disposeAutoUpdater, releasesHost: shouldReleaseHostOnQuit }
    // Squirrel.Mac and the Windows installer announce the quit they start, even one that comes
    // after the install watchdog gave up waiting.
    nativeAutoUpdater.on('before-quit-for-update', markUpdateQuit)
    const { getSettings, hydrateSettingsStoreFromHost } = await import('./store/settings')
    initAutoUpdater(
      getSettings().updateChannel,
      async () => {
        const settings = await invokeConfiguredHostUi('settings:get', [])
        if (!settings.handled) throw new Error('Attached GUI lost its Session Host settings route.')
        hydrateSettingsStoreFromHost(settings.result)
        return getSettings().updateChannel
      },
      {
        userDataDirectory: app.getPath('userData'),
        currentVersion: app.getVersion(),
        bundleIdentifier: APP_ID,
      },
    )
  } catch (error) {
    logger.warn('Failed to initialize auto-updater', describeError(error))
  }
}

export function disposeGuiAutoUpdater() {
  started?.dispose()
}

/** Whether this quit installs an update, so it must also release the Session Host (ADR 0047). */
export function isGuiInstallingUpdate() {
  return started?.releasesHost() === true
}
