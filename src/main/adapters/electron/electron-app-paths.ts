import { app } from 'electron'
import type { AppPathsShape } from '../../ports/desktop-shell/app-paths'
import { electronBootShell } from './electron-boot-shell'
import { prepareChromiumProfile } from './electron-web-profile'

/** Electron's `app` paths; the build identity is `electronBootShell`'s. */
export const electronAppPaths: AppPathsShape = {
  applyBuildIdentity: electronBootShell.applyBuildIdentity,
  userData: electronBootShell.userData,
  logs: () => app.getPath('logs'),
  appData: () => app.getPath('appData'),
  appRoot: electronBootShell.appRoot,
  resources: () => process.resourcesPath,
  setUserData: (directory) => app.setPath('userData', directory),
  setLogs: (directory) => app.setAppLogsPath(directory),
  setWebProfileData: (directory) =>
    prepareChromiumProfile(
      directory,
      (sessionData) => app.setPath('sessionData', sessionData),
      app.commandLine,
    ),
}
