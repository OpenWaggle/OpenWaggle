/**
 * The Browser preview part of the package proof (app-proof.ts): a preview of a local page opens,
 * CEF lists the page as a DevTools target, and the app's own screenshot of it, which goes through
 * the preview's DevTools target on the port the app learned at launch, has a size.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import type { ConnectedElectrobunApp } from '../../support/electrobun-app-launch'
import { waitUntil } from './app-proof'
import { ensureBrowserEngineWithin } from './browser-engine-proof'

const PREVIEW_BOUNDS = { x: 480, y: 120, width: 640, height: 480 }
const PREVIEW_TITLE = 'ow-preview-proof'
const HTTP_OK = 200
const LOOPBACK = '127.0.0.1'

export function serveFixturePage() {
  const server = http.createServer((_request, response) => {
    response.writeHead(HTTP_OK, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>${PREVIEW_TITLE}</title><h1>${PREVIEW_TITLE}</h1>`)
  })
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    server.listen(0, LOOPBACK, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ url: `http://${LOOPBACK}:${String(port)}/`, close: () => server.close() })
    })
  })
}

interface DevToolsTarget {
  readonly type?: unknown
  readonly url?: unknown
  readonly title?: unknown
  readonly webSocketDebuggerUrl?: unknown
}

function isDevToolsTarget(value: unknown): value is DevToolsTarget {
  return typeof value === 'object' && value !== null
}

async function devToolsTargets(port: number) {
  const response = await fetch(`http://${LOOPBACK}:${String(port)}/json/list`)
  const targets: unknown = await response.json()
  return (Array.isArray(targets) ? targets.filter(isDevToolsTarget) : []) satisfies DevToolsTarget[]
}

const CDP_SCREENSHOT_TIMEOUT_MS = 15_000

/**
 * A PNG of a DevTools target through its own CDP socket. Playwright's connection made before the
 * preview existed does not list the preview's page, so the proof asks the target directly.
 */
function captureTarget(target: DevToolsTarget, file: string) {
  const url = target.webSocketDebuggerUrl
  if (typeof url !== 'string') return Promise.resolve(null)
  return new Promise<string | null>((resolve) => {
    const socket = new WebSocket(url)
    const timer = setTimeout(() => {
      socket.close()
      resolve(null)
    }, CDP_SCREENSHOT_TIMEOUT_MS)
    const finish = (result: string | null) => {
      clearTimeout(timer)
      socket.close()
      resolve(result)
    }
    socket.addEventListener('open', () =>
      socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: {} })),
    )
    socket.addEventListener('message', (event) => {
      const reply: unknown = JSON.parse(String(event.data))
      const result =
        typeof reply === 'object' && reply !== null && 'result' in reply ? reply.result : null
      const data =
        typeof result === 'object' && result !== null && 'data' in result ? result.data : null
      if (typeof data !== 'string') return finish(null)
      fs.writeFileSync(file, Buffer.from(data, 'base64'))
      finish(file)
    })
    socket.addEventListener('error', () => finish(null))
  })
}

/** Opens a Browser preview of a local page and waits for CEF to list it as a DevTools target. */
export async function proveBrowserPreview(input: {
  readonly app: ConnectedElectrobunApp
  readonly sessionId: string
  readonly screenshots: string | null
  readonly timeoutMs: number
}) {
  const fixture = await serveFixturePage()
  const previewId = 'ci-smoke-preview'
  // A renderer opens previews for the owners it registered, as a Session's panel does.
  const ownerKey = `ci-smoke:${input.sessionId}`
  try {
    // A fresh macOS install downloads the CEF component first, as the preview panel does.
    const browserEngine = await ensureBrowserEngineWithin(input.app.page, input.timeoutMs)
    await input.app.page.evaluate(
      async (key) => window.api.registerBrowserPreviewOwner(key),
      ownerKey,
    )
    const opened = await input.app.page.evaluate(
      async (request) => window.api.openBrowserPreview(request),
      {
        previewId,
        ownerKey,
        profileId: 'default',
        url: fixture.url,
        bounds: PREVIEW_BOUNDS,
        visible: true,
      },
    )
    const target = await waitUntil('the preview DevTools target', input.timeoutMs, async () =>
      (await devToolsTargets(input.app.cdpPort)).find(
        (candidate) => typeof candidate.url === 'string' && candidate.url.startsWith(fixture.url),
      ),
    )
    // The app's own screenshot goes through the preview's DevTools target on the port the app
    // learned at launch, so it proves the app's CDP, not only the harness's.
    const captured = await input.app.page.evaluate(
      async (id) => window.api.captureBrowserPreviewScreenshot(id),
      previewId,
    )
    if (captured.width <= 0 || captured.height <= 0) {
      throw new Error(
        `The app's preview screenshot is ${String(captured.width)}x${String(captured.height)}.`,
      )
    }
    const shot =
      input.screenshots === null
        ? null
        : await captureTarget(target, path.join(input.screenshots, 'browser-preview.png'))
    await input.app.page
      .evaluate(
        async ({ id, key }) => {
          await window.api.closeBrowserPreview(id)
          await window.api.unregisterBrowserPreviewOwner(key)
        },
        { id: previewId, key: ownerKey },
      )
      .catch(() => undefined)
    return {
      url: fixture.url,
      target,
      openedTitle: opened.title,
      appScreenshot: { width: captured.width, height: captured.height },
      screenshot: shot,
      browserEngine,
    }
  } finally {
    fixture.close()
  }
}
