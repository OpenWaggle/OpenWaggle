import { describe, it, vi } from 'vitest'
import type { PortContract } from '../../../../ports/desktop-shell/__tests__/contracts/port-contract'
import { ipcMainTransportContract } from '../../../../ports/desktop-shell/__tests__/contracts/ipc-main-transport.contract'
import { rendererSurfacesContract } from '../../../../ports/desktop-shell/__tests__/contracts/renderer-surfaces.contract'
import { trustedOriginsContract } from '../../../../ports/desktop-shell/__tests__/contracts/trusted-origins.contract'
import { webSecurityContract } from '../../../../ports/desktop-shell/__tests__/contracts/web-security.contract'
import { memoryRememberedPorts } from '../loopback-test-support'
import { prepareElectrobunShell } from './electrobun-shell'

vi.mock('../../../../desktop-shell/app-paths', () => ({
  appPaths: { userData: () => '/nonexistent-user-data' },
}))

/** One test per contract case, each against a freshly prepared Electrobun shell. */
function runContract<Harness>(contract: PortContract<Harness>, setup: () => Promise<Harness>) {
  describe(`${contract.port} contract (Electrobun)`, () => {
    it.for(Object.entries(contract.cases))('%s', async ([, check]) => check(await setup()))
  })
}

runContract(trustedOriginsContract, async () => {
  const { createLoopbackTrustedOrigins } = await import('../../electrobun-trusted-origins')
  return {
    subject: createLoopbackTrustedOrigins({ rememberedPorts: memoryRememberedPorts() }),
    // A page's request reaches the real loopback server, as the webview's would.
    request: (url) => fetch(url),
  }
})

/** A fresh Electrobun shell plus app pages (webviews of hidden windows) to drive and inspect. */
async function preparePages() {
  const shell = await prepareElectrobunShell()
  const { openAppWindow } = await import('../../electrobun-window-policy')
  const { electrobunRendererSurfaces } = await import('../../electrobun-renderer-surfaces')
  const openPage = () =>
    openAppWindow(
      { hidden: true },
      { openLink: () => undefined, devTools: false, logicalUrl: (url) => url },
    ).webContents.id
  const view = (id: number) => shell.electrobun.webview.webviewOf(id)
  const surfaceOf = (id: number) => {
    const surface = electrobunRendererSurfaces.fromId(id)
    if (!surface) throw new Error(`No page ${String(id)}`)
    return surface
  }
  const closePage = (id: number) => {
    const window = shell.electrobun.webview.windows.get(view(id).windowId)
    window?.close()
  }
  return { ...shell, electrobunRendererSurfaces, openPage, surfaceOf, closePage, view }
}

runContract(ipcMainTransportContract, async () => {
  const { openPage, view } = await preparePages()
  const { electrobunIpcMainTransport } = await import('../../electrobun-ipc-main-transport')
  return {
    subject: electrobunIpcMainTransport,
    openPage,
    // The page's own RPC, over the JSON wire, as the Electrobun preload sends.
    invokeFromPage: (id, channel, ...args) => view(id).page.invoke(channel, ...args),
    sendFromPage: (id, channel, ...args) => view(id).page.send(channel, ...args),
  }
})

runContract(rendererSurfacesContract, async () => {
  const { electrobunRendererSurfaces, openPage, closePage, view } = await preparePages()
  return {
    subject: electrobunRendererSurfaces,
    openPage,
    closePage,
    receivedByPage: (id) => view(id).page.received,
  }
})

runContract(webSecurityContract, async () => {
  const { openPage, surfaceOf, closePage } = await preparePages()
  const { createElectrobunWebSecurity } = await import('../../electrobun-web-security')
  const cleared: string[] = []
  return {
    subject: createElectrobunWebSecurity({ clearStorage: (origins) => cleared.push(...origins) }),
    openPage: () => surfaceOf(openPage()),
    closePage: (surface) => closePage(surface.id),
    // Storage is the frame hosts' servers', shared by every page of the app.
    clearedOrigins: () => cleared,
  }
})
