import type {
  BaseWindowConstructorOptions,
  BrowserWindow,
  BrowserWindowConstructorOptions,
  MenuItemConstructorOptions,
  WebContents,
  WebFrameMain,
} from 'electron'
import * as Electron from 'electron'
import { AutomationDesktopUiError, isAutomationMode } from '../../desktop-automation-policy'
import type { DesktopWindow } from '../../ports/desktop-shell/desktop-windows'
import type { RendererSurface } from '../../ports/desktop-shell/renderer-surfaces'

function blockedAsyncMethod(api: string) {
  return () => Promise.reject(new AutomationDesktopUiError(api))
}

function blockedSyncMethod(api: string) {
  return () => {
    throw new AutomationDesktopUiError(api)
  }
}

function replaceMethod(target: object, method: string, replacement: unknown) {
  Object.defineProperty(target, method, {
    configurable: true,
    value: replacement,
    writable: true,
  })
}

/**
 * Fail closed before any application service can escape into native desktop UI.
 *
 * Tests may deliberately replace one blocked Electron method after startup to
 * supply a deterministic response. Without that explicit stub, every native
 * dialog, external application launch, reveal, focus, or sound attempt fails.
 */
export function installAutomationDesktopUiBlockers() {
  if (!isAutomationMode()) return

  const NativeBrowserWindow = Electron.BrowserWindow

  const blockedAsyncApis = [
    [Electron.dialog, 'showCertificateTrustDialog'],
    [Electron.dialog, 'showMessageBox'],
    [Electron.dialog, 'showOpenDialog'],
    [Electron.dialog, 'showSaveDialog'],
    [Electron.shell, 'openExternal'],
    [Electron.shell, 'openPath'],
    [Electron.shell, 'trashItem'],
  ] as const
  const blockedSyncApis = [
    [Electron.dialog, 'showErrorBox'],
    [Electron.dialog, 'showMessageBoxSync'],
    [Electron.dialog, 'showOpenDialogSync'],
    [Electron.dialog, 'showSaveDialogSync'],
    [Electron.shell, 'beep'],
    [Electron.shell, 'showItemInFolder'],
  ] as const

  for (const [target, method] of blockedAsyncApis) {
    replaceMethod(
      target,
      method,
      blockedAsyncMethod(`${target === Electron.dialog ? 'dialog' : 'shell'}.${method}`),
    )
  }
  for (const [target, method] of blockedSyncApis) {
    replaceMethod(
      target,
      method,
      blockedSyncMethod(`${target === Electron.dialog ? 'dialog' : 'shell'}.${method}`),
    )
  }

  for (const method of ['focus', 'restore', 'show', 'showInactive'] as const) {
    replaceMethod(
      NativeBrowserWindow.prototype,
      method,
      blockedSyncMethod(`BrowserWindow.${method}`),
    )
  }
  const NativeBaseWindow = Electron.BaseWindow
  for (const method of ['focus', 'restore', 'show', 'showInactive'] as const) {
    replaceMethod(NativeBaseWindow.prototype, method, blockedSyncMethod(`BaseWindow.${method}`))
  }
  replaceMethod(Electron.Menu.prototype, 'popup', blockedSyncMethod('Menu.popup'))
  replaceMethod(Electron.Notification.prototype, 'show', blockedSyncMethod('Notification.show'))
  // Electron exposes both window classes as non-configurable module properties,
  // so their constructors cannot be safely replaced. Core construction is
  // confined statically to the hidden-by-default helpers below, while the native
  // prototypes still reject every subsequent reveal or focus attempt at runtime.
}

export function createBaseWindow(options: BaseWindowConstructorOptions) {
  return new Electron.BaseWindow({
    ...options,
    ...(isAutomationMode() ? { show: false } : {}),
  })
}

export function createBrowserWindow(options: BrowserWindowConstructorOptions) {
  return new Electron.BrowserWindow({
    ...options,
    ...(isAutomationMode()
      ? {
          show: false,
          // Exercise foreground rendering without revealing an OS window.
          // Hidden Chromium otherwise reduces animation frames to 1 Hz on Linux.
          webPreferences: { ...options.webPreferences, backgroundThrottling: false },
        }
      : {}),
  })
}

export function revealBrowserWindowInactive(window: BrowserWindow) {
  if (isAutomationMode()) throw new AutomationDesktopUiError('BrowserWindow.showInactive')
  window.showInactive()
}

export function revealWindow(window: BrowserWindow) {
  if (isAutomationMode()) throw new AutomationDesktopUiError('BrowserWindow.show')
  window.show()
}

export function focusWindow(window: BrowserWindow) {
  if (isAutomationMode()) throw new AutomationDesktopUiError('BrowserWindow.focus')
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export function browserWindowFromWebContents(webContents: WebContents) {
  return Electron.BrowserWindow.fromWebContents(webContents)
}

/** Electron's own object behind a renderer surface; in this adapter they are the same object. */
export function electronWebContentsOf(surface: RendererSurface): WebContents | null {
  return Electron.webContents.fromId(surface.id) ?? null
}

/** Electron's window behind a desktop window. */
export function electronWindowOf(window: DesktopWindow): BrowserWindow | null {
  return Electron.BrowserWindow.fromId(window.id)
}

/** Every Electron `WebContents` is a renderer surface; this only proves it to the compiler. */
export function rendererSurfaceOf(contents: WebContents): RendererSurface {
  return contents
}

/** Every Electron `BrowserWindow` is a desktop window; this only proves it to the compiler. */
export function desktopWindowOf(window: BrowserWindow): DesktopWindow {
  return window
}

export function popupWebContentsMenu(
  window: BrowserWindow,
  contents: WebContents,
  template: MenuItemConstructorOptions[],
  frame: WebFrameMain | null,
) {
  const menu = Electron.Menu.buildFromTemplate(template)
  // Editing roles must target the guest, even when the host composer had focus.
  contents.focus()
  menu.popup({ window, ...(frame ? { frame } : {}) })
  return menu
}
