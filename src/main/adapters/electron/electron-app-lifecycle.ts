import { app, autoUpdater } from 'electron'
import type { AppLifecycleShape } from '../../ports/desktop-shell/app-lifecycle'
import type { CancellableShellEvent, Unsubscribe } from '../../ports/desktop-shell/shell-events'

function subscribe(
  add: (handler: () => void) => void,
  remove: (handler: () => void) => void,
  listener: () => void,
): Unsubscribe {
  const handler = () => listener()
  add(handler)
  return () => remove(handler)
}

export const electronAppLifecycle: AppLifecycleShape = {
  version: () => app.getVersion(),
  name: () => app.name,
  isPackaged: () => app.isPackaged,
  whenReady: () => app.whenReady().then(() => undefined),
  quit: () => app.quit(),
  exit: (code) => (code === undefined ? app.exit() : app.exit(code)),
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
  commandLine: {
    hasSwitch: (name) => app.commandLine.hasSwitch(name),
    getSwitchValue: (name) => app.commandLine.getSwitchValue(name),
    appendSwitch: (name, value) =>
      value === undefined
        ? app.commandLine.appendSwitch(name)
        : app.commandLine.appendSwitch(name, value),
  },
  disableHardwareAcceleration: () => app.disableHardwareAcceleration(),
}
