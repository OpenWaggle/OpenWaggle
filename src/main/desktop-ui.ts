import type {
  MessageBoxRequest,
  OpenDialogRequest,
  SaveDialogRequest,
} from './ports/desktop-shell/dialogs'
import type { DesktopBitmap, DesktopWindow } from './ports/desktop-shell/desktop-windows'
import type { RendererSurface } from './ports/desktop-shell/renderer-surfaces'
import type {
  SystemNotificationHandlers,
  SystemNotificationRequest,
} from './ports/desktop-shell/system-notifications'
import {
  AutomationDesktopUiError,
  assertExternalApplicationLaunchAllowed,
  isAutomationMode,
} from './desktop-automation-policy'
import { desktopDialogs } from './desktop-shell/dialogs'
import { desktopWindows } from './desktop-shell/desktop-windows'
import { osShell } from './desktop-shell/os-shell'
import { systemIntegration } from './desktop-shell/system-integration'
import { systemNotifications } from './desktop-shell/system-notifications'
import { launchDetachedProcess } from './detached-process'
import { getSafeChildEnv } from './env'
import { launchWindowsHeadlessProcess } from './windows-headless-process'

/**
 * The audited desktop UI boundary of the main process. Everything OS-visible goes through here,
 * on top of the desktop shell ports, so the non-disruptive automation policy
 * (`desktop-automation-policy.ts`) applies to every call: under automation each one fails closed
 * or does nothing.
 */
export { AutomationDesktopUiError, isAutomationMode }

export function getAllBrowserWindows() {
  return desktopWindows.all()
}

export function getFocusedBrowserWindow() {
  return desktopWindows.focused()
}

export function browserWindowFromWebContents(surface: RendererSurface) {
  return desktopWindows.fromSurface(surface)
}

/** Brings the main window to the front; automation never touches the screen. */
export function focusExistingWindow() {
  if (isAutomationMode()) return
  const existingWindow = getAllBrowserWindows()[0]
  if (existingWindow) desktopWindows.focus(existingWindow)
}

export function openExternal(url: string) {
  return osShell.openExternal(url)
}

export function openPath(targetPath: string) {
  return osShell.openPath(targetPath)
}

export function revealPath(targetPath: string) {
  osShell.showItemInFolder(targetPath)
}

export function showItemInFolder(targetPath: string) {
  return osShell.showItemInFolder(targetPath)
}

export function trashItem(targetPath: string) {
  return osShell.trashItem(targetPath)
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
}) {
  if (process.platform === 'win32') return launchWindowsHeadlessProcess(input)
  return launchDetachedProcess(input)
}

export function launchExternalApplication(command: string, args: readonly string[]) {
  assertExternalApplicationLaunchAllowed()
  return launchDetachedProcess({ command, args, environment: getSafeChildEnv() })
}

export function showErrorBox(title: string, content: string) {
  desktopDialogs.showErrorBox(title, content)
}

export function showMessageBox(ownerWindow: DesktopWindow | null, options: MessageBoxRequest) {
  return desktopDialogs.showMessageBox(ownerWindow, options)
}

export function showOpenDialog(ownerWindow: DesktopWindow | null, options: OpenDialogRequest) {
  return desktopDialogs.showOpenDialog(ownerWindow, options)
}

export function showSaveDialog(ownerWindow: DesktopWindow | null, options: SaveDialogRequest) {
  return desktopDialogs.showSaveDialog(ownerWindow, options)
}

export type NativeNotificationOptions = SystemNotificationRequest
export type NativeNotificationHandlers = SystemNotificationHandlers

export function nativeNotificationsSupported() {
  return systemNotifications.isSupported()
}

/**
 * Show an operating-system notification (ADR 0062). Returns null when the system cannot show one
 * or the run is automated, which never reaches the desktop.
 */
export function showNativeNotification(
  options: NativeNotificationOptions,
  handlers: NativeNotificationHandlers = {},
) {
  return systemNotifications.show(options, handlers)
}

/** Remove a delivered notification from Notification Center (macOS keeps it otherwise). */
export function removeDeliveredNativeNotification(id: string) {
  systemNotifications.removeDelivered(id)
}

/** The Dock (macOS) or launcher (Linux, where supported) count; 0 hides it. */
export function setApplicationBadgeCount(count: number) {
  if (isAutomationMode()) return
  systemIntegration.setBadgeCount(count)
}

/** The Windows taskbar overlay; null removes it. */
export function setWindowOverlayIcon(
  window: DesktopWindow,
  bitmap: DesktopBitmap | null,
  description: string,
) {
  if (isAutomationMode()) return
  desktopWindows.setOverlayIcon(window, bitmap, description)
}

/** The system alert sound, for a System default Notification sound with nothing shown. */
export function playSystemAlertSound() {
  if (isAutomationMode()) return
  osShell.beep()
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
  return osShell.openExternal(url)
}
