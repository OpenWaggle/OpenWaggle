import { homedir } from 'node:os'
import path from 'node:path'
import type { AppPathsShape } from '../../ports/desktop-shell/app-paths'
import {
  applicationDataRoot,
  electrobunBootShell,
  relocateUserData,
  userDataName,
} from './electrobun-boot-shell'

const PACKAGED_RESOURCES_DIRECTORY = 'resources'
const relocated: { logs: string | null } = { logs: null }

/** Electron's log directory: `~/Library/Logs/<name>` on macOS, `<userData>/logs` elsewhere. */
function logs() {
  if (relocated.logs !== null) return relocated.logs
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Logs', userDataName())
  return path.join(electrobunBootShell.userData(), 'logs')
}

/**
 * OpenWaggle's own directories on Electrobun (ADR 0064): the ones Electron resolved, never
 * Electrobun's `Utils.paths` (which add the identifier and channel).
 */
export const electrobunAppPaths: AppPathsShape = {
  applyBuildIdentity: electrobunBootShell.applyBuildIdentity,
  userData: electrobunBootShell.userData,
  logs,
  appData: () => applicationDataRoot(),
  appRoot: electrobunBootShell.appRoot,
  // The packaged layout: Resources/app/{package.json, out, node_modules, resources}.
  resources: () => path.join(electrobunBootShell.appRoot(), PACKAGED_RESOURCES_DIRECTORY),
  setUserData: relocateUserData,
  setLogs: (directory) => void (relocated.logs = directory),
  // The system webviews keep their own profile per app identifier (WKWebView, WebView2,
  // WebKitGTK) and Electrobun places CEF's; neither can be moved, and OpenWaggle keeps nothing
  // of its own there. The preview partitions are Electrobun `partition`s.
  setWebProfileData: () => undefined,
}
