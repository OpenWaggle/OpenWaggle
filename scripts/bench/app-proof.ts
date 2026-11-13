/**
 * What a bench launch of the packaged Electron app proves beyond the shared proofs
 * (scripts/electrobun/ci/app-proof.ts: startup status, a fake-provider Run, a terminal): it finds
 * the renderer on Electron's DevTools endpoint, and its Browser preview's page among the endpoint's
 * targets, as Electron serves both on one port.
 */
import type { Browser, Page } from '@playwright/test'
import { chromium } from '@playwright/test'
import { waitUntil } from '../electrobun/ci/app-proof'
import { serveFixturePage } from '../electrobun/ci/preview-proof'

const CDP_POLL_MS = 200
const LOOPBACK = '127.0.0.1'
const PREVIEW_BOUNDS = { x: 480, y: 120, width: 640, height: 480 }
const RENDERER_URL = /^openwaggle:\/\/app\/|\/index\.html(?:[?#]|$)/u

interface DevToolsTarget {
  readonly type?: unknown
  readonly url?: unknown
  readonly title?: unknown
}

function isDevToolsTarget(value: unknown): value is DevToolsTarget {
  return typeof value === 'object' && value !== null
}

export async function devToolsTargets(port: number) {
  const response = await fetch(`http://${LOOPBACK}:${String(port)}/json/list`)
  const targets: unknown = await response.json()
  return (Array.isArray(targets) ? targets.filter(isDevToolsTarget) : []) satisfies DevToolsTarget[]
}

export function isRendererUrl(url: unknown) {
  return typeof url === 'string' && RENDERER_URL.test(url)
}

/** Waits until the DevTools endpoint lists the app's renderer page, polling like the Electrobun proof. */
export function waitForRendererTarget(port: number, timeoutMs: number, exited: () => boolean) {
  return waitUntil(
    'the renderer page on the DevTools endpoint',
    timeoutMs,
    async () => {
      if (exited()) throw new Error('The app exited before its renderer opened.')
      return (await devToolsTargets(port)).some((target) => isRendererUrl(target.url))
    },
    CDP_POLL_MS,
  )
}

/** Connects Playwright and finds the renderer page, reconnecting if the first attach saw none. */
export async function connectRenderer(port: number, timeoutMs: number) {
  return waitUntil(
    'a Playwright connection to the renderer',
    timeoutMs,
    async () => {
      const browser: Browser = await chromium.connectOverCDP(`http://${LOOPBACK}:${String(port)}`)
      const page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => isRendererUrl(candidate.url()))
      if (page !== undefined) return { browser, page }
      await browser.close().catch(() => undefined)
      return null
    },
    CDP_POLL_MS,
  )
}

/** Opens a Browser preview of a local page and waits for the DevTools endpoint to list it. */
export async function proveBrowserPreview(input: {
  readonly page: Page
  readonly cdpPort: number
  readonly sessionId: string
  readonly timeoutMs: number
}) {
  const fixture = await serveFixturePage()
  const previewId = 'bench-preview'
  const ownerKey = `bench:${input.sessionId}`
  try {
    await input.page.evaluate(async (key) => window.api.registerBrowserPreviewOwner(key), ownerKey)
    const opened = await input.page.evaluate(
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
      (await devToolsTargets(input.cdpPort)).find(
        (candidate) => typeof candidate.url === 'string' && candidate.url.startsWith(fixture.url),
      ),
    )
    await input.page
      .evaluate(
        async ({ id, key }) => {
          await window.api.closeBrowserPreview(id)
          await window.api.unregisterBrowserPreviewOwner(key)
        },
        { id: previewId, key: ownerKey },
      )
      .catch(() => undefined)
    return { url: fixture.url, targetTitle: target.title, openedTitle: opened.title }
  } finally {
    fixture.close()
  }
}
