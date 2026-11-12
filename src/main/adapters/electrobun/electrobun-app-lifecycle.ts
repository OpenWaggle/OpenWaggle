import path from 'node:path'
import { PRODUCT_NAME } from '@shared/build-identity-runtime'
import { spawnDetachedProcess } from '../../detached-process'
import { liveProcessEnvironment } from '../../env'
import type { AppLifecycleShape } from '../../ports/desktop-shell/app-lifecycle'
import type { CancellableShellEvent, Unsubscribe } from '../../ports/desktop-shell/shell-events'
import { electrobunBootShell } from './electrobun-boot-shell'
import { isElectrobunDesktopApp, loadElectrobun } from './electrobun-sdk'
import { pendingForwardedLaunch } from './electrobun-single-instance'
import { emitShellEvent, onShellEvent } from './electrobun-shell-events'

type QuitListener = (event: CancellableShellEvent) => void

const beforeQuitListeners = new Set<QuitListener>()
const willQuitListeners = new Set<() => void>()
const state: {
  completing: boolean
  relaunch: boolean
  nativeQuitRouted: boolean
  /** Installs a downloaded update in place of the final exit (`quitToInstallUpdate`). */
  install: (() => Promise<void>) | null
} = { completing: false, relaunch: false, nativeQuitRouted: false, install: null }
const RELAUNCH_POLL_SECONDS = 0.2

function listen<Listener>(listeners: Set<Listener>, listener: Listener): Unsubscribe {
  const entry = listener
  listeners.add(entry)
  return () => {
    listeners.delete(entry)
  }
}

/** The launcher that starts this app again: the executable beside the bundled `bun`. */
function relaunchCommand() {
  const binary = path.dirname(process.execPath)
  const pid = String(process.pid)
  if (process.platform === 'win32') {
    const launcher = path.join(binary, 'launcher.exe')
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue; Start-Process -FilePath '${launcher.replaceAll("'", "''")}'`,
      ],
    }
  }
  const target =
    process.platform === 'darwin'
      ? `open -n "${path.resolve(binary, '../..').replaceAll('"', '\\"')}"`
      : `"${path.join(binary, 'launcher').replaceAll('"', '\\"')}"`
  return {
    command: '/bin/sh',
    args: [
      '-c',
      `while kill -0 ${pid} 2>/dev/null; do sleep ${String(RELAUNCH_POLL_SECONDS)}; done; exec ${target}`,
    ],
  }
}

function startRelaunch() {
  const launch = relaunchCommand()
  spawnDetachedProcess({ ...launch, environment: liveProcessEnvironment() }).unref()
}

/** Ends the process once every listener let the quit through. */
function completeQuit() {
  for (const listener of [...willQuitListeners]) listener()
  state.completing = true
  const { install } = state
  if (install) {
    // The update's helper starts the new version, so the app never relaunches itself here. An
    // install that quit already makes this exit a no-op; one that stopped short still quits.
    void install().finally(() => electrobunBootShell.exit(0))
    return
  }
  if (state.relaunch && electrobunBootShell.isPackaged()) startRelaunch()
  electrobunBootShell.exit(0)
}

function quit() {
  let held = false
  const event: CancellableShellEvent = {
    preventDefault: () => {
      held = true
    },
  }
  for (const listener of [...beforeQuitListeners]) listener(event)
  if (held) return
  // A launch that lost the single-instance lock quits once the owner has its argv.
  const forwarding = pendingForwardedLaunch()
  if (forwarding) void forwarding.then(completeQuit)
  else completeQuit()
}

/**
 * Quits through the port's protocol and then installs a downloaded update instead of exiting.
 * Electrobun's install asks its `before-quit` handlers for approval before it starts the helper
 * that swaps the bundle, and `routeNativeQuits` vetoes every request it did not expect, which
 * cancelled the install: it runs once the protocol has completed, when the veto lets it through.
 */
export function quitToInstallUpdate(install: () => Promise<void>) {
  state.install = install
  quit()
}

/**
 * Electrobun asks its own `before-quit` handlers when the user quits from the menu, the Dock or
 * the system, and its hook cannot wait. OpenWaggle vetoes that request and runs the port's
 * protocol instead, which may hold the quit for async shutdown and then quit again.
 */
async function routeNativeQuits() {
  if (state.nativeQuitRouted || !isElectrobunDesktopApp()) return
  state.nativeQuitRouted = true
  const sdk = await loadElectrobun()
  sdk.events.on('before-quit', (event: { response: { allow: boolean } | undefined }) => {
    if (state.completing) return
    event.response = { allow: false }
    setTimeout(quit, 0)
  })
  // macOS: a Dock click or reopening the app.
  sdk.events.on('reopen', () => emitShellEvent('activate'))
}

/**
 * The app's lifecycle on Electrobun (ADR 0064). `whenReady` loads the SDK in the desktop app;
 * the Session Host and the CLI are ready at once. Quitting follows the port's protocol on every
 * path, including Electrobun's own quit requests.
 */
export const electrobunAppLifecycle: AppLifecycleShape = {
  version: electrobunBootShell.version,
  name: () => PRODUCT_NAME,
  isPackaged: electrobunBootShell.isPackaged,
  whenReady: async () => {
    if (isElectrobunDesktopApp()) await routeNativeQuits()
  },
  quit,
  exit: electrobunBootShell.exit,
  relaunch: () => void (state.relaunch = true),
  onBeforeQuit: (listener) => listen(beforeQuitListeners, listener),
  onWillQuit: (listener) => listen(willQuitListeners, listener),
  onWindowAllClosed: (listener) => onShellEvent('window-all-closed', listener),
  onActivate: (listener) => onShellEvent('activate', listener),
  onBeforeQuitForUpdate: (listener) => onShellEvent('before-quit-for-update', listener),
  commandLine: electrobunBootShell.commandLine,
  // The system webviews composite on their own, and a process without windows draws nothing.
  disableHardwareAcceleration: () => undefined,
}
