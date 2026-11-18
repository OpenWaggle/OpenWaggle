import { shell } from 'electron'
import type { OsShellShape } from '../../ports/desktop-shell/os-shell'

/** Electron's `shell`, looked up per call so the automation blockers apply. */
export const electronOsShell: OsShellShape = {
  openExternal: (url) => shell.openExternal(url),
  openPath: (targetPath) => shell.openPath(targetPath),
  showItemInFolder: (targetPath) => shell.showItemInFolder(targetPath),
  trashItem: (targetPath) => shell.trashItem(targetPath),
  beep: () => shell.beep(),
}
