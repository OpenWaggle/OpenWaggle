import type {
  BaseWindow,
  BaseWindowConstructorOptions,
  BrowserWindow,
  BrowserWindowConstructorOptions,
  MenuItemConstructorOptions,
  MessageBoxOptions,
  NativeImage,
  Notification as NativeNotification,
  OpenDialogOptions,
  SaveDialogOptions,
  WebContents,
  WebFrameMain,
} from 'electron'
import * as Electron from 'electron'
import { launchDetachedProcess } from './detached-process'
import { env, getSafeChildEnv } from './env'
import { launchWindowsHeadlessProcess } from './windows-headless-process'

export class AutomationDesktopUiError extends Error {
  constructor(api: string) {
    super(`Blocked native desktop UI during non-disruptive automation: ${api}`)
    this.name = 'AutomationDesktopUiError'
  }
}

export function isAutomationMode() {
  return env.OPENWAGGLE_AUTOMATION === '1'
}

export function assertExternalApplicationLaunchAllowed() {
  if (isAutomationMode()) {
    throw new AutomationDesktopUiError('external-application.launch')
  }
}

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

export function getAllBrowserWindows() {
  return Electron.BrowserWindow.getAllWindows()
}

export function browserWindowFromWebContents(webContents: WebContents) {
  return Electron.BrowserWindow.fromWebContents(webContents)
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

export function openExternal(url: string) {
  return Electron.shell.openExternal(url)
}

export function openPath(targetPath: string) {
  return Electron.shell.openPath(targetPath)
}

export function revealPath(targetPath: string) {
  Electron.shell.showItemInFolder(targetPath)
}

export function showItemInFolder(targetPath: string) {
  return Electron.shell.showItemInFolder(targetPath)
}

export function trashItem(targetPath: string) {
  return Electron.shell.trashItem(targetPath)
}

/**
 * Launch an OpenWaggle-owned process that is guaranteed not to create native UI.
 *
 * Unlike external applications, a headless authority such as the Session Host must remain
 * available during non-disruptive automation. Keeping detached process creation here makes that
 * exception explicit and preserves the repository's fail-closed desktop UI boundary.
 */
export function launchHeadlessBackgroundProcess(input: {
  readonly command: string
  readonly args: readonly string[]
  readonly environment: Readonly<Record<string, string | undefined>>
}): Promise<void> {
  if (process.platform === 'win32') return launchWindowsHeadlessProcess(input)
  return launchDetachedProcess(input)
}

export function launchExternalApplication(command: string, args: readonly string[]): Promise<void> {
  assertExternalApplicationLaunchAllowed()
  return launchDetachedProcess({ command, args, environment: getSafeChildEnv() })
}

export function showErrorBox(title: string, content: string) {
  Electron.dialog.showErrorBox(title, content)
}

export function showMessageBox(ownerWindow: BaseWindow | null, options: MessageBoxOptions) {
  return ownerWindow
    ? Electron.dialog.showMessageBox(ownerWindow, options)
    : Electron.dialog.showMessageBox(options)
}

export function showOpenDialog(ownerWindow: BaseWindow | null, options: OpenDialogOptions) {
  return ownerWindow
    ? Electron.dialog.showOpenDialog(ownerWindow, options)
    : Electron.dialog.showOpenDialog(options)
}

export function showSaveDialog(ownerWindow: BaseWindow | null, options: SaveDialogOptions) {
  return ownerWindow
    ? Electron.dialog.showSaveDialog(ownerWindow, options)
    : Electron.dialog.showSaveDialog(options)
}

export interface NativeNotificationOptions {
  /** Replaces a delivered notification with the same id (macOS, Windows). */
  readonly id: string
  readonly groupId: string
  readonly title: string
  readonly body: string
  /** Suppress the operating system's own sound. */
  readonly silent: boolean
  /** Keep it on screen until clicked (Windows drops clicks once it moves to the Action Center). */
  readonly requireInteraction?: boolean
}

export interface NativeNotificationHandlers {
  readonly onClick?: () => void
  readonly onShow?: () => void
  readonly onFailed?: (error: string) => void
}

export function nativeNotificationsSupported() {
  return !isAutomationMode() && Electron.Notification.isSupported()
}

/**
 * Show an operating-system notification (ADR 0062). Returns null when the system cannot show one
 * or the run is automated, which never reaches the desktop.
 */
export function showNativeNotification(
  options: NativeNotificationOptions,
  handlers: NativeNotificationHandlers = {},
): NativeNotification | null {
  if (!nativeNotificationsSupported()) return null
  const notification = new Electron.Notification({
    id: options.id,
    groupId: options.groupId,
    title: options.title,
    body: options.body,
    silent: options.silent,
    ...(options.requireInteraction ? { timeoutType: 'never' as const } : {}),
  })
  if (handlers.onClick) notification.on('click', handlers.onClick)
  if (handlers.onShow) notification.on('show', handlers.onShow)
  if (handlers.onFailed) {
    const onFailed = handlers.onFailed
    notification.on('failed', (_event, error) => onFailed(error))
  }
  notification.show()
  return notification
}

/** Remove a delivered notification from Notification Center (macOS keeps it otherwise). */
export function removeDeliveredNativeNotification(id: string) {
  if (isAutomationMode() || process.platform !== 'darwin') return
  Electron.Notification.remove(id)
}

/** The Dock (macOS) or launcher (Linux, where supported) count; 0 hides it. */
export function setApplicationBadgeCount(count: number) {
  if (isAutomationMode()) return
  Electron.app.setBadgeCount(count)
}

/** The Windows taskbar overlay; null removes it. */
export function setWindowOverlayIcon(
  window: BrowserWindow,
  image: NativeImage | null,
  description: string,
) {
  if (isAutomationMode()) return
  window.setOverlayIcon(image, description)
}

export function nativeImageFromBitmap(pixels: Buffer, width: number, height: number) {
  return Electron.nativeImage.createFromBitmap(pixels, { width, height })
}

export function getFocusedBrowserWindow() {
  return Electron.BrowserWindow.getFocusedWindow()
}

/** The system alert sound, for a System default Notification sound with nothing shown. */
export function playSystemAlertSound() {
  if (isAutomationMode()) return
  Electron.shell.beep()
}

/** Opens the operating system's notification settings, where it has a page for them. */
export function openSystemNotificationSettings() {
  const url =
    process.platform === 'darwin'
      ? 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'
      : process.platform === 'win32'
        ? 'ms-settings:notifications'
        : null
  if (!url || isAutomationMode()) return Promise.resolve()
  return Electron.shell.openExternal(url)
}
