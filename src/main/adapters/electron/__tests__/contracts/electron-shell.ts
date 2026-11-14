import type * as AutomationPolicy from '../../../../desktop-automation-policy'
import { vi } from 'vitest'

/**
 * Prepares a fresh Electron shell for one contract test: a clean fake of `electron` and
 * `electron-updater`, and a switch for non-disruptive automation. Import the adapter under test
 * after calling it (`await import('../../electron-dialogs')`), so it binds to this fake.
 */
export async function prepareElectronShell() {
  vi.resetModules()
  const { fakeElectron } = await import('./fake-electron')
  const { fakeElectronUpdater } = await import('./fake-electron-ui')
  const electron = fakeElectron()
  const updater = fakeElectronUpdater()
  const automation = { on: false }
  vi.doMock('electron', () => ({ ...electron.module, default: electron.module }))
  vi.doMock('electron-updater', () => ({ ...updater.module, default: updater.module }))
  vi.doMock('../../../../desktop-automation-policy', async (importOriginal) => ({
    ...(await importOriginal<typeof AutomationPolicy>()),
    isAutomationMode: () => automation.on,
  }))
  const windowPolicy = await import('../../electron-window-policy')
  return {
    electron,
    updater,
    windowPolicy,
    /** Switches automation on and installs the window policy, as startup does under it. */
    enterAutomation: () => {
      automation.on = true
      windowPolicy.installAutomationDesktopUiBlockers()
    },
  }
}
