import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { APP_ID, PRODUCT_NAME } from '@shared/build-identity-runtime'
import { getDesktopHelperChildEnv } from '../../env'
import type {
  LoginItem,
  SystemIntegrationShape,
} from '../../ports/desktop-shell/system-integration'
import type { CancellableShellEvent, Unsubscribe } from '../../ports/desktop-shell/shell-events'
import { electrobunBootShell } from './electrobun-boot-shell'
import { setMacOsDockBadge, setMacOsDockIcon } from './electrobun-native-helpers'
import { loadedElectrobun, whenElectrobunLoaded } from './electrobun-sdk'
import { emitShellEvent, onProcessGone, onShellEvent } from './electrobun-shell-events'
import { singleInstanceLock } from './electrobun-single-instance'
import {
  deleteRegistryValue,
  readRegistryString,
  writeRegistryString,
} from './electrobun-windows-registry'

/**
 * How the Electrobun app fits into the operating system (ADR 0064). Electrobun covers none of
 * this beyond macOS `open-url`, so each member is a small helper: the single-instance lock file
 * and socket, the Windows `Run` and `Classes` registry keys, a Linux URL-handler desktop entry,
 * the macOS Dock badge and icon through AppKit, and a wall-clock timer for wake from sleep.
 */
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const RESUME_CHECK_MS = 5_000
/** A timer gap this much longer than its interval means the system slept. */
const RESUME_GAP_MS = 30_000

function quoted(value: string) {
  return `"${value}"`
}

function loginItemCommand(item: LoginItem) {
  return [quoted(item.path), ...item.args.map((argument) => quoted(argument))].join(' ')
}

/**
 * Login items are a Windows matter here (background start uses a LaunchAgent on macOS and an
 * XDG autostart entry on Linux), so elsewhere the answer lives only for this process.
 */
const processLoginItems = new Map<string, boolean>()

function loginItemOpensAtLogin(item: LoginItem) {
  if (process.platform !== 'win32') return processLoginItems.get(loginItemCommand(item)) === true
  return readRegistryString(RUN_KEY, APP_ID) === loginItemCommand(item)
}

function setLoginItemOpensAtLogin(item: LoginItem, openAtLogin: boolean) {
  if (process.platform !== 'win32') {
    processLoginItems.set(loginItemCommand(item), openAtLogin)
    return
  }
  if (openAtLogin) writeRegistryString(RUN_KEY, APP_ID, loginItemCommand(item))
  else deleteRegistryValue(RUN_KEY, APP_ID)
}

/** The launcher the OS starts for a link: the executable beside the bundled `bun`. */
function launcherPath() {
  const launcher = process.platform === 'win32' ? 'launcher.exe' : 'launcher'
  return path.join(path.dirname(process.execPath), launcher)
}

function registerWindowsScheme(scheme: string) {
  const key = `HKCU\\Software\\Classes\\${scheme}`
  writeRegistryString(key, null, `URL:${scheme}`)
  writeRegistryString(key, 'URL Protocol', '')
  writeRegistryString(`${key}\\shell\\open\\command`, null, `${quoted(launcherPath())} "%1"`)
}

/** Linux: a hidden desktop entry claims the scheme for the launcher, and xdg-mime selects it. */
function registerLinuxScheme(scheme: string) {
  const entry = `${APP_ID}.${scheme}-handler.desktop`
  const directory = path.join(homedir(), '.local', 'share', 'applications')
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, entry),
    [
      '[Desktop Entry]',
      'Type=Application',
      `Name=${PRODUCT_NAME}`,
      `Exec=${quoted(launcherPath())} %u`,
      `MimeType=x-scheme-handler/${scheme};`,
      'NoDisplay=true',
      '',
    ].join('\n'),
  )
  execFileSync('xdg-mime', ['default', entry, `x-scheme-handler/${scheme}`], {
    env: getDesktopHelperChildEnv(),
    stdio: 'ignore',
  })
}

function setAsDefaultProtocolClient(scheme: string) {
  // An unpackaged build would claim links for the checkout's Bun; Electron's dev build did not.
  if (!electrobunBootShell.isPackaged()) return false
  try {
    if (process.platform === 'win32') registerWindowsScheme(scheme)
    if (process.platform === 'linux') registerLinuxScheme(scheme)
    // macOS: the bundle's CFBundleURLTypes (electrobun.config.ts `urlSchemes`) claim it.
    return true
  } catch {
    return false
  }
}

const resumeTimer: { handle: ReturnType<typeof setInterval> | null; last: number } = {
  handle: null,
  last: 0,
}

function watchForResume() {
  if (resumeTimer.handle !== null) return
  resumeTimer.last = Date.now()
  resumeTimer.handle = setInterval(() => {
    const now = Date.now()
    if (now - resumeTimer.last > RESUME_CHECK_MS + RESUME_GAP_MS) emitShellEvent('resume')
    resumeTimer.last = now
  }, RESUME_CHECK_MS)
  resumeTimer.handle.unref()
}

interface OpenUrlEvent {
  readonly data?: { readonly url?: string }
}

function onOpenUrl(listener: (event: CancellableShellEvent, url: string) => void) {
  const subscription: { stop: Unsubscribe | null; stopped: boolean } = {
    stop: null,
    stopped: false,
  }
  const handler = (event: OpenUrlEvent) => {
    const url = event.data?.url
    if (url) listener({ preventDefault: () => undefined }, url)
  }
  whenElectrobunLoaded((sdk) => {
    if (subscription.stopped) return
    sdk.events.on('open-url', handler)
    subscription.stop = () => sdk.events.off('open-url', handler)
  })
  return () => {
    subscription.stopped = true
    subscription.stop?.()
  }
}

export const electrobunSystemIntegration: SystemIntegrationShape = {
  ...singleInstanceLock(electrobunBootShell.userData),
  loginItemOpensAtLogin,
  setLoginItemOpensAtLogin,
  // The Dock badge exists on macOS; Windows shows the count as the taskbar overlay icon
  // (DesktopWindows.setOverlayIcon), and Linux desktops have no common badge.
  setBadgeCount: (count) => {
    if (process.platform === 'darwin' && loadedElectrobun()) setMacOsDockBadge(count)
  },
  setActivationPolicy: electrobunBootShell.setActivationPolicy,
  setDockIcon: (iconPath) => {
    if (process.platform === 'darwin' && loadedElectrobun()) setMacOsDockIcon(iconPath)
  },
  // Electrobun's launcher sets the process's AppUserModelID from the app identifier.
  setAppUserModelId: () => undefined,
  onResume: (listener) => {
    watchForResume()
    return onShellEvent('resume', listener)
  },
  setAsDefaultProtocolClient,
  onOpenUrl,
  onProcessGone,
}
