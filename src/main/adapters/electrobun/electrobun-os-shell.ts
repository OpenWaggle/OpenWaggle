import type { OsShellShape } from '../../ports/desktop-shell/os-shell'
import { assertDesktopUiAllowed, desktopUiAllowed } from './electrobun-automation'
import { systemBeep } from './electrobun-native-helpers'
import { electrobun } from './electrobun-sdk'

/**
 * Electrobun's `Utils` hands URLs and files to the operating system (ADR 0064). It answers only
 * whether the system took them, so a refusal becomes Electron's error text or rejection.
 */
export const electrobunOsShell: OsShellShape = {
  openExternal: async (url) => {
    await desktopUiAllowed('shell.openExternal')
    if (!electrobun().Utils.openExternal(url)) {
      throw new Error(`The system could not open ${url}.`)
    }
  },
  openPath: async (targetPath) => {
    await desktopUiAllowed('shell.openPath')
    return electrobun().Utils.openPath(targetPath) ? '' : `Failed to open path: ${targetPath}`
  },
  showItemInFolder: (targetPath) => {
    assertDesktopUiAllowed('shell.showItemInFolder')
    electrobun().Utils.showItemInFolder(targetPath)
  },
  trashItem: async (targetPath) => {
    await desktopUiAllowed('shell.trashItem')
    if (!electrobun().Utils.moveToTrash(targetPath)) {
      throw new Error(`The system could not move ${targetPath} to the Trash.`)
    }
  },
  beep: () => {
    assertDesktopUiAllowed('shell.beep')
    systemBeep()
  },
}
