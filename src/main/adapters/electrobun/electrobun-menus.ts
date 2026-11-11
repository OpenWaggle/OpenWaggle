import type { ApplicationMenuItemConfig } from 'electrobun/main'
import type {
  DesktopMenusShape,
  ShellMenuItem,
  ShellMenuRole,
} from '../../ports/desktop-shell/menus'
import { assertDesktopUiAllowed } from './electrobun-automation'
import { type ElectrobunSdk, electrobun } from './electrobun-sdk'

/** Port roles Electrobun performs natively, by its own role name. */
const NATIVE_ROLES: Partial<Record<ShellMenuRole, string>> = {
  about: 'about',
  hide: 'hide',
  hideOthers: 'hideOthers',
  unhide: 'showAll',
  quit: 'quit',
  undo: 'undo',
  redo: 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  selectAll: 'selectAll',
  togglefullscreen: 'toggleFullScreen',
}

interface WebviewRole {
  readonly label: string
  readonly accelerator: string
  readonly run: (webview: {
    executeJavascript: (js: string) => void
    toggleDevTools: () => void
  }) => void
}

/**
 * Roles Electrobun has no native item for act on the focused window's webview. The system
 * webviews have no cache-bypassing reload, so Force Reload reloads.
 */
const WEBVIEW_ROLES: Partial<Record<ShellMenuRole, WebviewRole>> = {
  reload: {
    label: 'Reload',
    accelerator: 'CmdOrCtrl+R',
    run: (webview) => webview.executeJavascript('location.reload()'),
  },
  forceReload: {
    label: 'Force Reload',
    accelerator: 'CmdOrCtrl+Shift+R',
    run: (webview) => webview.executeJavascript('location.reload()'),
  },
  toggleDevTools: {
    label: 'Toggle Developer Tools',
    accelerator: 'Alt+CmdOrCtrl+I',
    run: (webview) => webview.toggleDevTools(),
  },
}

const ACTION_PREFIX = 'openwaggle-menu-'

interface MenuEvent {
  readonly data?: { readonly action?: string; readonly id?: number }
}

const state: {
  subscribed: boolean
  focusedWindowId: number | null
  nextAction: number
  actions: Map<string, () => void>
} = { subscribed: false, focusedWindowId: null, nextAction: 0, actions: new Map() }

function runAction(event: MenuEvent) {
  const action = event.data?.action
  if (action) state.actions.get(action)?.()
}

function subscribe(sdk: ElectrobunSdk) {
  if (state.subscribed) return
  state.subscribed = true
  sdk.events.on('application-menu-clicked', runAction)
  sdk.events.on('context-menu-clicked', runAction)
  sdk.events.on('focus', (event: MenuEvent) => {
    state.focusedWindowId = event.data?.id ?? state.focusedWindowId
  })
}

function actionFor(click: () => void) {
  state.nextAction += 1
  const action = `${ACTION_PREFIX}${String(state.nextAction)}`
  state.actions.set(action, click)
  return action
}

function onFocusedWebview(sdk: ElectrobunSdk, role: WebviewRole) {
  return () => {
    if (state.focusedWindowId === null) return
    role.run(sdk.BrowserWindow.getById(state.focusedWindowId).webview)
  }
}

function toConfig(sdk: ElectrobunSdk, item: ShellMenuItem): ApplicationMenuItemConfig {
  if (item.type === 'separator') return { type: 'separator' }
  const common = {
    ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
    ...(item.accelerator === undefined ? {} : { accelerator: item.accelerator }),
    ...(item.submenu ? { submenu: item.submenu.map((child) => toConfig(sdk, child)) } : {}),
  }
  const nativeRole = item.role ? NATIVE_ROLES[item.role] : undefined
  if (nativeRole) {
    return { ...common, role: nativeRole, ...(item.label ? { label: item.label } : {}) }
  }
  const webviewRole = item.role ? WEBVIEW_ROLES[item.role] : undefined
  if (webviewRole) {
    return {
      accelerator: webviewRole.accelerator,
      ...common,
      label: item.label ?? webviewRole.label,
      action: actionFor(onFocusedWebview(sdk, webviewRole)),
    }
  }
  return {
    ...common,
    label: item.label ?? '',
    ...(item.click ? { action: actionFor(item.click) } : {}),
  }
}

/**
 * Electrobun's application and context menus (ADR 0064). A clicked item reaches its `click`
 * through the menu's action id. Removing the application menu installs an empty one, which drops
 * its shortcuts as Electron's `null` menu does.
 */
export const electrobunMenus: DesktopMenusShape = {
  setApplicationMenu: (items) => {
    const sdk = electrobun()
    subscribe(sdk)
    state.actions.clear()
    sdk.ApplicationMenu.setApplicationMenu(items ? items.map((item) => toConfig(sdk, item)) : [])
  },
  popupContextMenu: (_window, items) => {
    assertDesktopUiAllowed('menu.popup')
    const sdk = electrobun()
    subscribe(sdk)
    sdk.ContextMenu.showContextMenu(items.map((item) => toConfig(sdk, item)))
  },
}
