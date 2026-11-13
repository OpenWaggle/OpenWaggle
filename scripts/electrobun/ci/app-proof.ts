/**
 * What scripts/electrobun/ci/smoke.ts proves about a running packaged app, over CEF's DevTools
 * endpoint (scripts/support/electrobun-app-launch.ts) and the app's own CLI:
 *
 * - the main window reaches startup status `ready`;
 * - the Session Host starts and answers `host status`;
 * - a Run against a local fake OpenAI provider finishes through `openwaggle run`, and its Session
 *   opens in the window;
 * - a terminal opens (Mod+J) and echoes what is typed into it;
 * - a Browser preview opens and CEF lists its page as a DevTools target (preview-proof.ts).
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { isTitleRequest, startFakeProvider } from '../../perf/lib/fake-openai-provider'

const POLL_MS = 250
const SCREEN = { width: 1280, height: 800 }
const CLI_OUTPUT_TAIL = 4000
const SHELL_PROMPT_MS = 3000
export const FAKE_ANSWER = 'The answer is 42, from the CI fake provider.'
export const TERMINAL_MARKER = 'ow-terminal-proof'
/** The typed command and the shell's answer: split on the marker, that is three pieces. */
const MARKER_PIECES_WHEN_ECHOED = 2
const SESSION_ID_PATTERN = /started Session ([0-9a-f-]{36})/u

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
      lastError = error instanceof Error ? error.message : JSON.stringify(error)
    }
    await delay(pollMs)
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
}) {
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
  }) satisfies Promise<CliResult>
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

/** One Run through `openwaggle run`: its Session id and how long the CLI took. */
export async function runFakeProviderTurn(input: {
  readonly cli: Cli
  readonly project: string
  readonly model: string
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
  return { sessionId, runMs: run.ms }
}

/** One Run through `openwaggle run`, then its Session opened in the window. */
export async function proveFakeProviderRun(input: {
  readonly cli: Cli
  readonly page: Page
  readonly project: string
  readonly model: string
  readonly timeoutMs: number
}) {
  const { sessionId, runMs } = await runFakeProviderTurn(input)
  await input.page.evaluate((id) => {
    window.location.hash = `#/sessions/${id}`
  }, sessionId)
  await waitUntil('the Session to show the answer', input.timeoutMs, () =>
    input.page.evaluate((answer) => document.body.innerText.includes(answer), FAKE_ANSWER),
  )
  return { sessionId, runMs }
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
