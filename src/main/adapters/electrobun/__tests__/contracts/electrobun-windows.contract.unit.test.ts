import { describe, it } from 'vitest'
import type { PortContract } from '../../../../ports/desktop-shell/__tests__/contracts/port-contract'
import { desktopWindowsContract } from '../../../../ports/desktop-shell/__tests__/contracts/desktop-windows.contract'
import { prepareElectrobunShell } from './electrobun-shell'

/** One test per contract case, each against a freshly prepared Electrobun shell. */
function runContract<Harness>(contract: PortContract<Harness>, setup: () => Promise<Harness>) {
  describe(`${contract.port} contract (Electrobun)`, () => {
    it.for(Object.entries(contract.cases))('%s', async ([, check]) => check(await setup()))
  })
}

runContract(desktopWindowsContract, async () => {
  const { electrobun, enterAutomation } = await prepareElectrobunShell()
  const { openAppWindow } = await import('../../electrobun-window-policy')
  const { electrobunDesktopWindows } = await import('../../electrobun-desktop-windows')
  const nativeWindow = (id: number) => {
    const window = electrobun.webview.windows.get(id)
    if (!window) throw new Error(`No window ${String(id)}`)
    return window
  }
  return {
    subject: electrobunDesktopWindows,
    openWindow: () =>
      openAppWindow(
        { hidden: true },
        { openLink: () => undefined, devTools: false, logicalUrl: (url) => url },
      ),
    isVisible: (window) => nativeWindow(window.id).isVisible(),
    minimize: (window) => nativeWindow(window.id).minimize(),
    enterAutomation,
  }
})
