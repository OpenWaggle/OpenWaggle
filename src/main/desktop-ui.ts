import { spawn } from 'node:child_process'
import type {
  BaseWindow,
  BaseWindowConstructorOptions,
  BrowserWindowConstructorOptions,
  MessageBoxOptions,
  OpenDialogOptions,
  SaveDialogOptions,
  WebContents,
} from 'electron'
import * as Electron from 'electron'
import { env, getSafeChildEnv } from './env'

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
    ...(isAutomationMode() ? { show: false } : {}),
  })
}

export function getAllBrowserWindows() {
  return Electron.BrowserWindow.getAllWindows()
}

export function browserWindowFromWebContents(webContents: WebContents) {
  return Electron.BrowserWindow.fromWebContents(webContents)
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

export function launchExternalApplication(command: string, args: readonly string[]): Promise<void> {
  assertExternalApplicationLaunchAllowed()
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: getSafeChildEnv(),
    })
    const handleError = (error: Error) => {
      child.removeListener('spawn', handleSpawn)
      reject(error)
    }
    const handleSpawn = () => {
      child.removeListener('error', handleError)
      child.unref()
      resolve()
    }
    child.once('error', handleError)
    child.once('spawn', handleSpawn)
  })
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
