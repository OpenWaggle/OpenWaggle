import type { BrowserWindow, WindowOptionsType } from 'electrobun/main'
import { isAutomationMode } from '../../desktop-automation-policy'
import type { DesktopWindow } from '../../ports/desktop-shell/desktop-windows'
import type { RendererSurface } from '../../ports/desktop-shell/renderer-surfaces'
import { assertDesktopUiAllowed } from './electrobun-automation'
import {
  type AppWebviewLink,
  type AppWebviewOptions,
  createAppWebviewLink,
  type ElectrobunRendererSurface,
} from './electrobun-renderer-surfaces'
import { electrobun } from './electrobun-sdk'
import { emitShellEvent } from './electrobun-shell-events'

/**
 * The only place the Electrobun shell constructs, shows or focuses a window (ADR 0064,
 * `scripts/standards/electron-automation.ts`). Under non-disruptive automation every window is
 * created hidden and never activates, and showing or focusing one throws
 * `AutomationDesktopUiError`.
 *
 * A `DesktopWindow`'s id is the Electrobun `BrowserWindow` id and its page's surface id the
 * Electrobun webview id, so other adapters (the browser preview) attach views by `windowId`.
 */
type AppRpc = AppWebviewLink['rpc']
type AppWindow = BrowserWindow<AppRpc>
export type AppWindowOptions = Partial<Omit<WindowOptionsType<AppRpc>, 'rpc'>>

class ElectrobunDesktopWindow implements DesktopWindow {
  closed = false
  constructor(
    readonly window: AppWindow,
    readonly webContents: ElectrobunRendererSurface,
  ) {}
  get id() {
    return this.window.id
  }
  isDestroyed() {
    return this.closed
  }
}

const openWindows = new Map<number, ElectrobunDesktopWindow>()
const focusState: { id: number | null } = { id: null }

function trackWindow(window: AppWindow, surface: ElectrobunRendererSurface) {
  const tracked = new ElectrobunDesktopWindow(window, surface)
  openWindows.set(window.id, tracked)
  window.on('focus', () => {
    focusState.id = window.id
  })
  window.on('blur', () => {
    if (focusState.id === window.id) focusState.id = null
  })
  window.on('close', () => {
    tracked.closed = true
    openWindows.delete(window.id)
    if (focusState.id === window.id) focusState.id = null
    surface.markDestroyed()
    // Electrobun quits on its own only when told to; the app decides (`window-all-closed`).
    if (openWindows.size === 0) emitShellEvent('window-all-closed')
  })
  return tracked
}

/**
 * Opens an app window on `options.url` with the app's RPC, hidden unless `options.hidden` is
 * false and automation is off. Its page becomes a renderer surface.
 */
export function openAppWindow(options: AppWindowOptions, webview: AppWebviewOptions) {
  const link = createAppWebviewLink()
  const window = new (electrobun().BrowserWindow)({
    ...options,
    rpc: link.rpc,
    ...(isAutomationMode() ? { hidden: true, activate: false } : {}),
  })
  return trackWindow(window, link.attach(window.webview, webview))
}

export function appWindowOf(window: DesktopWindow): AppWindow | null {
  const tracked = openWindows.get(window.id)
  return tracked && !tracked.closed ? tracked.window : null
}

export function allDesktopWindows(): readonly DesktopWindow[] {
  return [...openWindows.values()]
}

export function focusedDesktopWindow(): DesktopWindow | null {
  return focusState.id === null ? null : (openWindows.get(focusState.id) ?? null)
}

export function desktopWindowOfSurface(surface: RendererSurface): DesktopWindow | null {
  for (const tracked of openWindows.values()) {
    if (tracked.webContents.id === surface.id) return tracked
  }
  return null
}

export function revealWindow(window: AppWindow) {
  assertDesktopUiAllowed('BrowserWindow.show')
  window.show()
}

export function revealWindowInactive(window: AppWindow) {
  assertDesktopUiAllowed('BrowserWindow.showInactive')
  window.showInactive()
}

export function focusWindow(window: AppWindow) {
  assertDesktopUiAllowed('BrowserWindow.focus')
  if (window.isMinimized()) window.unminimize()
  window.show()
  window.activate()
  // Electrobun reports the focus change asynchronously; the app asked for it, so it holds now.
  focusState.id = window.id
}
