import { APP_ID } from '@shared/build-identity-runtime'
import { app } from 'electron'
import { invokeConfiguredHostUi } from './application/gui-session-command-router'
import { describeError } from './error-description'
import { createLogger } from './logger'

const logger = createLogger('main/index')

let started: { readonly dispose: () => void; readonly isInstalling: () => boolean } | null = null

/**
 * Starts the desktop app's updater once the main window exists. It is imported lazily to keep it
 * off the startup path, and it re-reads the Update channel from the Session Host before checks.
 */
export async function startGuiAutoUpdater() {
  try {
    const { disposeAutoUpdater, initAutoUpdater, isInstallingUpdate } = await import('./updater')
    started = { dispose: disposeAutoUpdater, isInstalling: isInstallingUpdate }
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
  return started?.isInstalling() === true
}
