import { BUILD_CHANNEL, PRODUCT_NAME } from '@shared/build-identity-runtime'
import { app } from 'electron'
import type { AppPathsShape } from '../../ports/desktop-shell/app-paths'
import { prepareChromiumProfile } from './electron-web-profile'

/**
 * Electron derives `userData` from `app.getName()`. Released builds keep the canonical name
 * (`openwaggle`, the package name), so the existing install base is not orphaned; Dev builds are
 * renamed to their own product name so a stale local or worktree build can never read or
 * overwrite the installed release's Sessions, settings or credentials (ADR 0032).
 */
export const electronAppPaths: AppPathsShape = {
  applyBuildIdentity: () => {
    if (BUILD_CHANNEL === 'dev') app.setName(PRODUCT_NAME)
  },
  userData: () => app.getPath('userData'),
  logs: () => app.getPath('logs'),
  appData: () => app.getPath('appData'),
  appRoot: () => app.getAppPath(),
  setUserData: (directory) => app.setPath('userData', directory),
  setLogs: (directory) => app.setAppLogsPath(directory),
  setWebProfileData: (directory) =>
    prepareChromiumProfile(
      directory,
      (sessionData) => app.setPath('sessionData', sessionData),
      app.commandLine,
    ),
}
