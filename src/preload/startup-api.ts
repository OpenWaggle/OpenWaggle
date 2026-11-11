import { homeDirectoryFromRendererArguments } from '@shared/home-directory-argument'
import { trustedOriginBasesFromRendererArguments } from '@shared/trusted-origin-bases-argument'
import { invoke, on, rendererArguments } from './electron-transport'

const homeDirectory = homeDirectoryFromRendererArguments(rendererArguments())
const trustedOriginBases = trustedOriginBasesFromRendererArguments(rendererArguments())

function passedTrustedOriginBases() {
  if (trustedOriginBases === null) {
    throw new Error('The main process passed this window no trusted origin bases.')
  }
  return trustedOriginBases
}

/**
 * The window's startup state and Retry (A-F2), what main passed the window (the home directory
 * for display paths and the trusted origin bases), and the first launch's notice about the
 * Electron build's data. Kept beside api.ts for its line budget.
 */
export const startupApi = {
  getHomeDirectory: () => homeDirectory,
  getTrustedOriginBases: passedTrustedOriginBases,
  getStartupStatus: invoke('app:get-startup-status'),
  retryStartup: invoke('app:retry-startup'),
  onStartupStatusChanged: on('app:startup-status-changed'),
  getElectronMigrationNotice: invoke('electron-migration:get-notice'),
  continueElectronSecretsMigration: invoke('electron-migration:continue-secrets'),
  skipElectronSecretsMigration: invoke('electron-migration:skip-secrets'),
}
