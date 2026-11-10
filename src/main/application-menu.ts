import { appLifecycle } from './desktop-shell/app-lifecycle'
import { desktopMenus } from './desktop-shell/desktop-menus'
import type { ShellMenuItem } from './ports/desktop-shell/menus'

function buildDevViewMenu(): ShellMenuItem[] {
  if (appLifecycle.isPackaged()) {
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

export function configureApplicationMenu(appName: string, enabled = true) {
  if (!enabled) {
    desktopMenus.setApplicationMenu(null)
    return
  }
  const devViewMenu = buildDevViewMenu()
  if (process.platform === 'darwin') {
    desktopMenus.setApplicationMenu([
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
    ])
    return
  }

  desktopMenus.setApplicationMenu(devViewMenu.length > 0 ? devViewMenu : null)
}
