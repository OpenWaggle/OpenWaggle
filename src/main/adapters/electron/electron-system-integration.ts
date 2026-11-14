import { app, powerMonitor } from 'electron'
import type { SystemIntegrationShape } from '../../ports/desktop-shell/system-integration'
import { electronBootShell } from './electron-boot-shell'

/** The Windows AppUserModelID of an unpackaged build is its executable, as electron-toolkit does. */
function appUserModelId(id: string) {
  return app.isPackaged ? id : process.execPath
}

export const electronSystemIntegration: SystemIntegrationShape = {
  requestSingleInstanceLock: (additionalData) =>
    additionalData === undefined
      ? app.requestSingleInstanceLock()
      : app.requestSingleInstanceLock(additionalData),
  hasSingleInstanceLock: () => app.hasSingleInstanceLock(),
  releaseSingleInstanceLock: () => app.releaseSingleInstanceLock(),
  onSecondInstance: (listener) => {
    const handler = (
      _event: unknown,
      argv: string[],
      workingDirectory: string,
      additionalData: unknown,
    ) => listener({ argv, workingDirectory, additionalData })
    app.on('second-instance', handler)
    return () => {
      app.off('second-instance', handler)
    }
  },
  loginItemOpensAtLogin: (item) =>
    app.getLoginItemSettings({ path: item.path, args: [...item.args] }).openAtLogin,
  setLoginItemOpensAtLogin: (item, openAtLogin) =>
    app.setLoginItemSettings({ path: item.path, args: [...item.args], openAtLogin }),
  setBadgeCount: (count) => {
    app.setBadgeCount(count)
  },
  setActivationPolicy: electronBootShell.setActivationPolicy,
  setDockIcon: (iconPath) => app.dock?.setIcon(iconPath),
  setAppUserModelId: (id) => {
    if (process.platform === 'win32') app.setAppUserModelId(appUserModelId(id))
  },
  onResume: (listener) => {
    const handler = () => listener()
    powerMonitor.on('resume', handler)
    return () => {
      powerMonitor.off('resume', handler)
    }
  },
  setAsDefaultProtocolClient: (scheme) => app.setAsDefaultProtocolClient(scheme),
  onOpenUrl: (listener) => {
    const handler = (event: { readonly preventDefault: () => void }, url: string) =>
      listener(event, url)
    app.on('open-url', handler)
    return () => {
      app.off('open-url', handler)
    }
  },
  onProcessGone: (listener) => {
    const childGone = (
      _event: unknown,
      details: { readonly type: string; readonly reason: string },
    ) => listener({ process: details.type, reason: details.reason })
    const rendererGone = (
      _event: unknown,
      _contents: unknown,
      details: { readonly reason: string },
    ) => listener({ process: 'renderer', reason: details.reason })
    app.on('child-process-gone', childGone)
    app.on('render-process-gone', rendererGone)
    return () => {
      app.off('child-process-gone', childGone)
      app.off('render-process-gone', rendererGone)
    }
  },
}
