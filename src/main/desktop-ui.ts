import { spawn } from 'node:child_process'
import { closeSync, openSync, readdirSync } from 'node:fs'
import { devNull } from 'node:os'
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

export function showItemInFolder(targetPath: string) {
  return Electron.shell.showItemInFolder(targetPath)
}

export function trashItem(targetPath: string) {
  return Electron.shell.trashItem(targetPath)
}

const MAX_DETACHED_DESCRIPTOR = 65_535
const LAST_CONTROL_DESCRIPTOR = 4
const STANDARD_IO_DESCRIPTOR_COUNT = 3

function isolatedLinuxStdio(ownedDescriptors: number[]): Array<'ignore' | number> {
  let nullDescriptor = openSync(devNull, 'r+')
  ownedDescriptors.push(nullDescriptor)
  let lastDescriptor = LAST_CONTROL_DESCRIPTOR
  for (const entry of [...readdirSync('/proc/self/fd'), String(nullDescriptor)]) {
    const descriptor = Number(entry)
    if (
      !/^\d+$/u.test(entry) ||
      !Number.isSafeInteger(descriptor) ||
      descriptor > MAX_DETACHED_DESCRIPTOR
    ) {
      throw new Error(
        'Cannot isolate detached process descriptors: invalid or excessive descriptor.',
      )
    }
    lastDescriptor = Math.max(lastDescriptor, descriptor)
  }
  // libuv duplicates low source FDs above stdio_count for every higher destination.
  // Reserve a high source through the holes instead, avoiding transient EMFILE even
  // when the existing snapshot is sparse and close to the process descriptor limit.
  while (nullDescriptor < lastDescriptor) {
    nullDescriptor = openSync(devNull, 'r+')
    ownedDescriptors.push(nullDescriptor)
  }
  // Cover holes too: another native thread can reuse one before spawn. A descriptor
  // opened above this synchronous snapshot remains a Node spawn API limitation.
  return Array.from({ length: lastDescriptor + 1 }, (_, index) =>
    index < STANDARD_IO_DESCRIPTOR_COUNT ? 'ignore' : nullDescriptor,
  )
}

function launchDetachedProcess(input: {
  readonly command: string
  readonly args: readonly string[]
  readonly environment: Readonly<Record<string, string | undefined>>
}) {
  return new Promise<void>((resolve, reject) => {
    // Linux Electron can retain client pipes and Chromium sockets even with UV_IGNORE.
    // Replace the parent snapshot before exec; never close the new Host's own handles.
    const ownedDescriptors: number[] = []
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(input.command, [...input.args], {
        detached: true,
        stdio: process.platform === 'linux' ? isolatedLinuxStdio(ownedDescriptors) : 'ignore',
        windowsHide: true,
        env: { ...input.environment },
      })
    } finally {
      for (const descriptor of ownedDescriptors) closeSync(descriptor)
    }
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
  return launchDetachedProcess(input)
}

export function launchExternalApplication(command: string, args: readonly string[]): Promise<void> {
  assertExternalApplicationLaunchAllowed()
  return launchDetachedProcess({ command, args, environment: getSafeChildEnv() })
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
