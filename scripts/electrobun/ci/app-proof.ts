/**
 * What scripts/electrobun/ci/smoke.ts proves about a running packaged app, over CEF's DevTools
 * endpoint (scripts/support/electrobun-app-launch.ts) and the app's own CLI:
 *
 * - the main window reaches startup status `ready`;
 * - the Session Host starts and answers `host status`;
 * - a Run against a local fake OpenAI provider finishes through `openwaggle run`, and its Session
 *   opens in the window;
 * - a terminal opens (Mod+J) and echoes what is typed into it;
 * - a Browser preview opens and CEF lists its page as a DevTools target.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { isTitleRequest, startFakeProvider } from '../../perf/lib/fake-openai-provider'
import type { ConnectedElectrobunApp } from '../../support/electrobun-app-launch'

const POLL_MS = 250
const CLI_OUTPUT_TAIL = 4000
const SCREEN = { width: 1280, height: 800 }
const PREVIEW_BOUNDS = { x: 480, y: 120, width: 640, height: 480 }
const SHELL_PROMPT_MS = 3000
const LOOPBACK = '127.0.0.1'
export const FAKE_ANSWER = 'The answer is 42, from the CI fake provider.'
export const TERMINAL_MARKER = 'ow-terminal-proof'
const PREVIEW_TITLE = 'ow-preview-proof'
const HTTP_OK = 200
/** The typed command and the shell's answer: split on the marker, that is three pieces. */
const MARKER_PIECES_WHEN_ECHOED = 2
const SESSION_ID_PATTERN = /started Session ([0-9a-f-]{36})/u

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function waitUntil<T>(
  what: string,
  timeoutMs: number,
  read: () => Promise<T | null | undefined | false>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const value = await read()
      if (value !== null && value !== undefined && value !== false) return value
    } catch (error) {
      lastError = error instanceof Error ? error.message : JSON.stringify(error)
    }
    await delay(POLL_MS)
  }
  throw new Error(
    `Timed out after ${String(timeoutMs)} ms waiting for ${what}${lastError === '' ? '' : `: ${lastError}`}`,
  )
}

export async function waitForStartupReady(page: Page, timeoutMs: number) {
  await waitUntil('startup status ready', timeoutMs, async () => {
    const status = await page.evaluate(async () => (await window.api.getStartupStatus()).state)
    if (status === 'failed') throw new Error('The app reported a failed startup.')
    return status === 'ready'
  })
}

export async function screenshot(page: Page, directory: string | null, name: string) {
  if (directory === null) return null
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, name)
  await page.setViewportSize(SCREEN).catch(() => undefined)
  await page.screenshot({ path: file })
  return file
}

export interface CliResult {
  readonly status: number | null
  readonly output: string
  readonly ms: number
}

/** Runs the app directory with its bundled Bun, as the installed `openwaggle` CLI does. */
export function runAppCli(input: {
  readonly bun: string
  readonly appRoot: string
  readonly args: readonly string[]
  readonly environment: NodeJS.ProcessEnv
  readonly timeoutMs: number
}): Promise<CliResult> {
  const started = Date.now()
  const child = spawn(input.bun, [input.appRoot, ...input.args], {
    env: input.environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  const collect = (chunk: Buffer) => {
    output = `${output}${chunk.toString('utf8')}`.slice(-CLI_OUTPUT_TAIL)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const timer = setTimeout(() => child.kill(), input.timeoutMs)
  return new Promise((resolve) => {
    child.once('exit', (status) => {
      clearTimeout(timer)
      resolve({ status, output, ms: Date.now() - started })
    })
  })
}

type Cli = (args: readonly string[]) => Promise<CliResult>

function requireSuccess(what: string, result: CliResult) {
  if (result.status !== 0) {
    throw new Error(`${what} exited ${String(result.status)}:\n${result.output}`)
  }
  return result
}

export async function proveSessionHost(cli: Cli) {
  const start = requireSuccess('host start', await cli(['host', 'start']))
  const status = requireSuccess('host status', await cli(['host', 'status', '--json']))
  return { startMs: start.ms, status: status.output.trim().slice(-CLI_OUTPUT_TAIL) }
}

/** A git project for the Run, so it opens as a normal repository would. */
export async function createProject(directory: string) {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'README.md'), '# CI smoke project\n')
  const git = (args: readonly string[]) =>
    new Promise<void>((resolve) => {
      spawn('git', ['-C', directory, ...args], { stdio: 'ignore' }).once('exit', () => resolve())
    })
  await git(['init', '-q'])
  await git(['add', '.'])
  await git(['-c', 'user.name=ci', '-c', 'user.email=ci@example.com', 'commit', '-qm', 'init'])
  return directory
}

export async function startCiFakeProvider() {
  return startFakeProvider(async (request, stream) => {
    stream.text(isTitleRequest(request) ? 'CI smoke' : FAKE_ANSWER)
  })
}

/** One Run through `openwaggle run`, then its Session opened in the window. */
export async function proveFakeProviderRun(input: {
  readonly cli: Cli
  readonly page: Page
  readonly project: string
  readonly model: string
  readonly timeoutMs: number
}) {
  const run = requireSuccess(
    'openwaggle run',
    await input.cli([
      'run',
      '--project',
      input.project,
      '--model',
      input.model,
      '--text',
      'What is the answer?',
    ]),
  )
  const sessionId = SESSION_ID_PATTERN.exec(run.output)?.[1]
  if (sessionId === undefined) throw new Error(`openwaggle run named no Session:\n${run.output}`)
  if (!run.output.includes('42')) {
    throw new Error(`The Run did not print the answer:\n${run.output}`)
  }
  await input.page.evaluate((id) => {
    window.location.hash = `#/sessions/${id}`
  }, sessionId)
  await waitUntil('the Session to show the answer', input.timeoutMs, () =>
    input.page.evaluate((answer) => document.body.innerText.includes(answer), FAKE_ANSWER),
  )
  return { sessionId, runMs: run.ms }
}

function terminalText(page: Page) {
  return page.evaluate(() => document.querySelector('.xterm')?.textContent ?? '')
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
    const current = await terminalText(page)
    return current.split(TERMINAL_MARKER).length > MARKER_PIECES_WHEN_ECHOED ? current : null
  })
  return { echoed: true, tail: text.slice(-CLI_OUTPUT_TAIL) }
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

interface DevToolsTarget {
  readonly type?: unknown
  readonly url?: unknown
  readonly title?: unknown
}

function isDevToolsTarget(value: unknown): value is DevToolsTarget {
  return typeof value === 'object' && value !== null
}

async function devToolsTargets(port: number): Promise<DevToolsTarget[]> {
  const response = await fetch(`http://${LOOPBACK}:${String(port)}/json/list`)
  const targets: unknown = await response.json()
  return Array.isArray(targets) ? targets.filter(isDevToolsTarget) : []
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
    const previewPage = input.app.browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => page.url().startsWith(fixture.url))
    const shot =
      previewPage === undefined || input.screenshots === null
        ? null
        : await previewPage
            .screenshot({ path: path.join(input.screenshots, 'browser-preview.png') })
            .then(() => path.join(input.screenshots ?? '', 'browser-preview.png'))
            .catch(() => null)
    await input.app.page
      .evaluate(
        async ({ id, key }) => {
          await window.api.closeBrowserPreview(id)
          await window.api.unregisterBrowserPreviewOwner(key)
        },
        { id: previewId, key: ownerKey },
      )
      .catch(() => undefined)
    return { url: fixture.url, target, openedTitle: opened.title, screenshot: shot }
  } finally {
    fixture.close()
  }
}
