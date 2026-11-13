/**
 * What a bench launch proves about a running packaged app, over its DevTools endpoint and its CLI.
 * Shell-neutral: it drives the renderer through `window.api` and reads CDP's target list, which
 * Electron and CEF both serve.
 *
 * - the window reaches startup status `ready`;
 * - a Run against a local fake OpenAI provider finishes through `openwaggle run`, and its Session
 *   opens in the window;
 * - a terminal opens (Mod+J) and echoes what is typed into it;
 * - a Browser preview opens and the DevTools endpoint lists its page.
 */
import http from 'node:http'
import type { Browser, Page } from '@playwright/test'
import { chromium } from '@playwright/test'
import { isTitleRequest, startFakeProvider } from '../perf/lib/fake-openai-provider'

const POLL_MS = 250
const CDP_POLL_MS = 200
const SHELL_PROMPT_MS = 3000
const LOOPBACK = '127.0.0.1'
const HTTP_OK = 200
const TAIL_CHARS = 4000
const PREVIEW_BOUNDS = { x: 480, y: 120, width: 640, height: 480 }
const PREVIEW_TITLE = 'ow-preview-proof'
export const FAKE_ANSWER = 'The answer is 42, from the bench fake provider.'
const TERMINAL_MARKER = 'ow-terminal-proof'
/** The typed command and the shell's answer: split on the marker, that is three pieces. */
const MARKER_PIECES_WHEN_ECHOED = 2
const SESSION_ID_PATTERN = /started Session ([0-9a-f-]{36})/u
const RENDERER_URL = /^openwaggle:\/\/app\/|\/index\.html(?:[?#]|$)/u

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function waitUntil<T>(
  what: string,
  timeoutMs: number,
  read: () => Promise<T | null | undefined | false>,
  pollMs = POLL_MS,
) {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const value = await read()
      if (value !== null && value !== undefined && value !== false) return value
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await delay(pollMs)
  }
  throw new Error(`Timed out after ${String(timeoutMs)} ms waiting for ${what} ${lastError}`)
}

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
  return Array.isArray(targets) ? targets.filter(isDevToolsTarget) : []
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

export async function waitForStartupReady(page: Page, timeoutMs: number) {
  await waitUntil('startup status ready', timeoutMs, async () => {
    const status = await page.evaluate(async () => (await window.api.getStartupStatus()).state)
    if (status === 'failed') throw new Error('The app reported a failed startup.')
    return status === 'ready'
  })
}

export function startBenchFakeProvider() {
  return startFakeProvider(async (request, stream) => {
    stream.text(isTitleRequest(request) ? 'Bench run' : FAKE_ANSWER)
  })
}

export interface CliResult {
  readonly status: number | null
  readonly output: string
  readonly ms: number
}

type Cli = (args: readonly string[]) => Promise<CliResult>

/** One Run through `openwaggle run`, then its Session opened in the window. */
export async function proveFakeProviderRun(input: {
  readonly cli: Cli
  readonly page: Page
  readonly project: string
  readonly model: string
  readonly timeoutMs: number
}) {
  const run = await input.cli([
    'run',
    '--project',
    input.project,
    '--model',
    input.model,
    '--text',
    'What is the answer?',
  ])
  if (run.status !== 0) {
    throw new Error(`openwaggle run exited ${String(run.status)}:\n${run.output}`)
  }
  const sessionId = SESSION_ID_PATTERN.exec(run.output)?.[1]
  if (sessionId === undefined) throw new Error(`openwaggle run named no Session:\n${run.output}`)
  await input.page.evaluate((id) => {
    window.location.hash = `#/sessions/${id}`
  }, sessionId)
  await waitUntil('the Session to show the answer', input.timeoutMs, () =>
    input.page.evaluate((answer) => document.body.innerText.includes(answer), FAKE_ANSWER),
  )
  return { sessionId, runMs: run.ms }
}

/** Opens the terminal with Mod+J and waits for the shell to echo the typed marker back. */
export async function proveTerminal(page: Page, timeoutMs: number) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyJ' : 'Control+KeyJ')
  await waitUntil('the terminal', timeoutMs, () =>
    page.evaluate(() => document.querySelector('.xterm-helper-textarea') !== null),
  )
  await delay(SHELL_PROMPT_MS)
  await page.focus('.xterm-helper-textarea')
  await page.keyboard.insertText(`echo ${TERMINAL_MARKER}`)
  await page.keyboard.press('Enter')
  const text = await waitUntil('the terminal to echo', timeoutMs, async () => {
    const current = await page.evaluate(() => document.querySelector('.xterm')?.textContent ?? '')
    return current.split(TERMINAL_MARKER).length > MARKER_PIECES_WHEN_ECHOED ? current : null
  })
  return { echoed: true, tail: text.slice(-TAIL_CHARS) }
}

function serveFixturePage() {
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
