import { app, autoUpdater } from 'electron'
import type { AppLifecycleShape } from '../../ports/desktop-shell/app-lifecycle'
import type { CancellableShellEvent } from '../../ports/desktop-shell/shell-events'
import { electronBootShell } from './electron-boot-shell'

/**
 * Chromium switches for a windowless process (the Session Host). It draws nothing and makes few
 * requests through Chromium, yet Chromium starts a GPU process (software compositing) and a
 * network service process for it, about 90 MB resident and two processes on macOS. Both run in
 * the process itself instead; a crash there was already the Host's own.
 */
export const WINDOWLESS_PROCESS_SWITCHES: readonly (readonly [string, string?])[] = [
  ['in-process-gpu'],
  ['enable-features', 'NetworkServiceInProcess2'],
]

function runWindowless() {
  app.disableHardwareAcceleration()
  for (const [name, value] of WINDOWLESS_PROCESS_SWITCHES) {
    electronBootShell.commandLine.appendSwitch(name, value)
  }
}

function subscribe(
  add: (handler: () => void) => void,
  remove: (handler: () => void) => void,
  listener: () => void,
) {
  const handler = () => listener()
  add(handler)
  return () => remove(handler)
}

export const electronAppLifecycle: AppLifecycleShape = {
  version: electronBootShell.version,
  name: () => app.name,
  isPackaged: electronBootShell.isPackaged,
  whenReady: () => app.whenReady().then(() => undefined),
  quit: () => app.quit(),
  exit: electronBootShell.exit,
  relaunch: () => app.relaunch(),
  onBeforeQuit: (listener) => {
    const handler = (event: CancellableShellEvent) => listener(event)
    app.on('before-quit', handler)
    return () => {
      app.off('before-quit', handler)
    }
  },
  onWillQuit: (listener) =>
    subscribe(
      (handler) => app.on('will-quit', handler),
      (handler) => app.off('will-quit', handler),
      listener,
    ),
  onWindowAllClosed: (listener) =>
    subscribe(
      (handler) => app.on('window-all-closed', handler),
      (handler) => app.off('window-all-closed', handler),
      listener,
    ),
  onActivate: (listener) =>
    subscribe(
      (handler) => app.on('activate', handler),
      (handler) => app.off('activate', handler),
      listener,
    ),
  onBeforeQuitForUpdate: (listener) =>
    subscribe(
      (handler) => autoUpdater.on('before-quit-for-update', handler),
      (handler) => autoUpdater.off('before-quit-for-update', handler),
      listener,
    ),
  commandLine: electronBootShell.commandLine,
  disableHardwareAcceleration: runWindowless,
}
