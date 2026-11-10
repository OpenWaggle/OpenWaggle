import type { MenuItemConstructorOptions } from 'electron'
import { Menu } from 'electron'
import type { DesktopMenusShape, ShellMenuItem } from '../../ports/desktop-shell/menus'
import { electronWindowOf } from './electron-window-policy'

function menuTemplate(items: readonly ShellMenuItem[]): MenuItemConstructorOptions[] {
  return items.map((item) => ({
    ...(item.type === undefined ? {} : { type: item.type }),
    ...(item.label === undefined ? {} : { label: item.label }),
    ...(item.role === undefined ? {} : { role: item.role }),
    ...(item.accelerator === undefined ? {} : { accelerator: item.accelerator }),
    ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
    ...(item.submenu === undefined ? {} : { submenu: menuTemplate(item.submenu) }),
    ...(item.click === undefined ? {} : { click: item.click }),
  }))
}

export const electronMenus: DesktopMenusShape = {
  setApplicationMenu: (items) =>
    Menu.setApplicationMenu(items === null ? null : Menu.buildFromTemplate(menuTemplate(items))),
  popupContextMenu: (window, items) => {
    const owner = electronWindowOf(window)
    const menu = Menu.buildFromTemplate(menuTemplate(items))
    // `Menu.popup` is blocked under automation; without a window it opens over the focused one.
    menu.popup(owner ? { window: owner } : {})
  },
}
