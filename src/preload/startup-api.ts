import { homeDirectoryFromRendererArguments } from '@shared/home-directory-argument'
import { invoke, on } from './electron-transport'

const homeDirectory = homeDirectoryFromRendererArguments(process.argv)

/**
 * The window's startup state and Retry (A-F2), and the home directory main passed for display
 * paths, kept beside api.ts for its line budget.
 */
export const startupApi = {
  getHomeDirectory: () => homeDirectory,
  getStartupStatus: invoke('app:get-startup-status'),
  retryStartup: invoke('app:retry-startup'),
  onStartupStatusChanged: on('app:startup-status-changed'),
}
