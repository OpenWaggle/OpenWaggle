import { homeDirectoryFromRendererArguments } from '@shared/home-directory-argument'
import { invoke, on, rendererArguments } from './electron-transport'

const homeDirectory = homeDirectoryFromRendererArguments(rendererArguments())

/**
 * The window's startup state and Retry (A-F2), the home directory main passed for display paths,
 * and the first launch's notice about the Electron build's data, kept beside api.ts for its line
 * budget.
 */
export const startupApi = {
  getHomeDirectory: () => homeDirectory,
  getStartupStatus: invoke('app:get-startup-status'),
  retryStartup: invoke('app:retry-startup'),
  onStartupStatusChanged: on('app:startup-status-changed'),
  getElectronMigrationNotice: invoke('electron-migration:get-notice'),
  continueElectronSecretsMigration: invoke('electron-migration:continue-secrets'),
  skipElectronSecretsMigration: invoke('electron-migration:skip-secrets'),
}
