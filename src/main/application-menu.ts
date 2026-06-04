import { is } from '@electron-toolkit/utils'
import { type BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

const DEVTOOLS_SHORTCUT_CODE = 'KeyI'

function buildDevViewMenu(): MenuItemConstructorOptions[] {
  if (!is.dev) {
    return []
  }

  return [
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        {
          role: 'toggleDevTools',
          accelerator: 'CommandOrControl+Alt+I',
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]
}

export function configureApplicationMenu(appName: string) {
  const devViewMenu = buildDevViewMenu()
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: appName,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
          ],
        },
        ...devViewMenu,
      ]),
    )
    return
  }

  Menu.setApplicationMenu(devViewMenu.length > 0 ? Menu.buildFromTemplate(devViewMenu) : null)
}

function isDevToolsShortcut(input: Electron.Input) {
  return (
    input.type === 'keyDown' &&
    input.code === DEVTOOLS_SHORTCUT_CODE &&
    ((input.meta && input.alt) || (input.control && input.shift))
  )
}

function toggleDevTools(window: BrowserWindow) {
  if (!is.dev) {
    return
  }

  if (window.webContents.isDevToolsOpened()) {
    window.webContents.closeDevTools()
    return
  }

  window.webContents.openDevTools({ mode: 'undocked' })
}

export function installDevToolsShortcut(window: BrowserWindow) {
  if (!is.dev) {
    return
  }

  window.webContents.on('before-input-event', (event, input) => {
    if (!isDevToolsShortcut(input)) {
      return
    }

    event.preventDefault()
    toggleDevTools(window)
  })
}
