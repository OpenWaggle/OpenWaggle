import { EventEmitter } from 'node:events'
import type { RendererSurface } from '../../../../ports/desktop-shell/renderer-surfaces'
import type { fakeElectrobunWebview } from './fake-electrobun-webview'

/**
 * The Browser preview's part of the fake `electrobun/main`: owner pages, each an app page in its
 * own window (fake-electrobun-webview.ts), seen as the renderer surface a preview's owner is. The
 * preview adapter finds the owner's window through `BrowserView.getById(surface.id).windowId` and
 * watches it close through the SDK's global `close` event, as the webview fake reports it.
 */
export function fakeElectrobunBrowserPreview(webview: ReturnType<typeof fakeElectrobunWebview>) {
  function openOwnerPage() {
    const window = new webview.module.BrowserWindow({ url: 'views://main/index.html' })
    const page = new EventEmitter()
    let destroyed = false
    page.once('destroyed', () => {
      destroyed = true
    })
    const surface: RendererSurface = Object.assign(page, {
      id: window.webviewId,
      isDestroyed: () => destroyed || !webview.views.has(window.webviewId),
      getURL: () => 'views://main/index.html',
      send: () => undefined,
      focus: () => undefined,
    })
    return {
      surface,
      window,
      close: () => {
        window.close()
        page.emit('destroyed')
      },
    }
  }

  return { openOwnerPage }
}
