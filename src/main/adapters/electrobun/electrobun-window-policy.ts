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
  readonly window: AppWindow
  readonly webContents: ElectrobunRendererSurface
  constructor(window: AppWindow, webContents: ElectrobunRendererSurface) {
    this.window = window
    this.webContents = webContents
  }
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

/** A 1-pixel window on Windows has no client area (120x0), where CEF creates no view. */
const BACKGROUND_WINDOW_FRAME = { x: 0, y: 0, width: 320, height: 240 } as const

/**
 * Opens a window that is never shown or tracked as a desktop window: a host for background views
 * (the Browser preview's profile maintenance pages). Returns its id.
 */
export function openBackgroundWindow(options: { readonly title: string; readonly html: string }) {
  const frame = BACKGROUND_WINDOW_FRAME
  return new (electrobun().BrowserWindow)({ ...options, frame, hidden: true, activate: false }).id
}

export function appWindowOf(window: DesktopWindow) {
  const tracked = openWindows.get(window.id)
  return tracked && !tracked.closed ? tracked.window : null
}

export function allDesktopWindows() {
  return [...openWindows.values()]
}

export function focusedDesktopWindow() {
  return focusState.id === null ? null : (openWindows.get(focusState.id) ?? null)
}

export function desktopWindowOfSurface(surface: RendererSurface) {
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
