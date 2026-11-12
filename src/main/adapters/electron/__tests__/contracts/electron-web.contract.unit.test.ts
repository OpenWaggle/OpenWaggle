import { describe, it } from 'vitest'
import type { PortContract } from '../../../../ports/desktop-shell/__tests__/contracts/port-contract'
import type { RendererSurface } from '../../../../ports/desktop-shell/renderer-surfaces'
import { browserPreviewViewsContract } from '../../../../ports/desktop-shell/__tests__/contracts/browser-preview-views.contract'
import { ipcMainTransportContract } from '../../../../ports/desktop-shell/__tests__/contracts/ipc-main-transport.contract'
import { networkFetchContract } from '../../../../ports/desktop-shell/__tests__/contracts/network-fetch.contract'
import { rendererSurfacesContract } from '../../../../ports/desktop-shell/__tests__/contracts/renderer-surfaces.contract'
import { trustedOriginsContract } from '../../../../ports/desktop-shell/__tests__/contracts/trusted-origins.contract'
import { webSecurityContract } from '../../../../ports/desktop-shell/__tests__/contracts/web-security.contract'
import { prepareElectronShell } from './electron-shell'

/** One test per contract case, each against a freshly prepared Electron shell. */
function runContract<Harness>(contract: PortContract<Harness>, setup: () => Promise<Harness>) {
  describe(`${contract.port} contract (Electron)`, () => {
    it.for(Object.entries(contract.cases))('%s', async ([, check]) => check(await setup()))
  })
}

/** A fresh Electron shell plus pages (`WebContents`) to send from, close and inspect. */
async function preparePages() {
  const shell = await prepareElectronShell()
  const { electronRendererSurfaces } = await import('../../electron-renderer-surfaces')
  const pages = new Map<number, ReturnType<typeof shell.electron.createWebContents>>()
  const openPage = () => {
    const contents = shell.electron.createWebContents()
    pages.set(contents.id, contents)
    return contents.id
  }
  const surfaceOf = (id: number): RendererSurface => {
    const surface = electronRendererSurfaces.fromId(id)
    if (!surface) throw new Error(`No page ${id}`)
    return surface
  }
  return {
    ...shell,
    electronRendererSurfaces,
    openPage,
    surfaceOf,
    closePage: (id: number) => pages.get(id)?.destroy(),
    page: (id: number) => {
      const contents = pages.get(id)
      if (!contents) throw new Error(`No page ${id}`)
      return contents
    },
  }
}

runContract(ipcMainTransportContract, async () => {
  const { electron, openPage } = await preparePages()
  const { electronIpcMainTransport } = await import('../../electron-ipc-main-transport')
  const sender = (id: number) => ({ sender: electron.module.webContents.fromId(id) })
  return {
    subject: electronIpcMainTransport,
    openPage,
    invokeFromPage: async (id, channel, ...args) => {
      const handler = electron.ipcState.handlers.get(channel)
      if (!handler) throw new Error(`No handler for ${channel}`)
      return handler(sender(id), ...args)
    },
    sendFromPage: (id, channel, ...args) =>
      electron.ipcState.listeners.get(channel)?.(sender(id), ...args),
  }
})

runContract(rendererSurfacesContract, async () => {
  const { electronRendererSurfaces, openPage, closePage, page } = await preparePages()
  return {
    subject: electronRendererSurfaces,
    openPage,
    closePage,
    receivedByPage: (id) => page(id).sent,
  }
})

runContract(trustedOriginsContract, async () => {
  const { electron } = await prepareElectronShell()
  const { electronTrustedOrigins } = await import('../../electron-trusted-origins')
  return {
    subject: electronTrustedOrigins,
    request: async (url) => {
      const handler = electron.protocolState.handlers.get(new URL(url).protocol.slice(0, -1))
      if (!handler) return new Response(null, { status: 404 })
      return handler(new Request(url))
    },
  }
})

runContract(networkFetchContract, async () => {
  const { electron } = await prepareElectronShell()
  const { electronNetworkFetch } = await import('../../electron-network-fetch')
  return {
    subject: electronNetworkFetch,
    sent: () => electron.netState.fetched,
    fetchAsExtension: (url) => electron.module.net.fetch(url),
  }
})

runContract(webSecurityContract, async () => {
  const { openPage, surfaceOf, closePage, page } = await preparePages()
  const { electronWebSecurity } = await import('../../electron-web-security')
  return {
    subject: electronWebSecurity,
    openPage: () => surfaceOf(openPage()),
    closePage: (surface) => closePage(surface.id),
    clearedOrigins: (surface) => page(surface.id).session.clearedOrigins,
  }
})

runContract(browserPreviewViewsContract, async () => {
  const { openPage, surfaceOf, closePage } = await preparePages()
  const { electronBrowserPreviewViews } = await import('../../electron-browser-preview-views')
  return {
    subject: electronBrowserPreviewViews,
    closedPage: () => {
      const id = openPage()
      const surface = surfaceOf(id)
      closePage(id)
      return surface
    },
  }
})
