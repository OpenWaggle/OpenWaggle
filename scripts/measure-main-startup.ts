import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Browser, type Page } from '@playwright/test'

const STARTUP_TIMINGS_SWITCH = 'openwaggle-startup-timings'
const TEMP_DIR_PREFIX = 'openwaggle-startup-'
const LOCALHOST = '127.0.0.1'
const LOCALHOST_RENDERER_MARKER = 'localhost:'
const OPENWAGGLE_PROTOCOL_PREFIX = 'openwaggle://'
const OPTION_RUNS = '--runs'
const OPTION_TIMEOUT_MS = '--timeout-ms'
const OPTION_PORT = '--port'
const DEFAULT_RUNS = 1
const DEFAULT_TIMEOUT_MS = 60_000
const CDP_POLL_INTERVAL_MS = 250
const POST_READY_LOG_DRAIN_MS = 500
const PROCESS_EXIT_TIMEOUT_MS = 5_000
const BROWSER_CLOSE_TIMEOUT_MS = 5_000
const CLEANUP_RETRY_COUNT = 5
const CLEANUP_RETRY_DELAY_MS = 250
const RECENT_LOG_LINE_COUNT = 80
const JSON_INDENT_SPACES = 2
const TIMING_PRECISION = 1
const DECIMAL_RADIX = 10
const CLI_ARGS_START_INDEX = 2
const EPHEMERAL_PORT = 0
const ZERO = 0
const FIRST_CAPTURE_GROUP = 1
const SECOND_CAPTURE_GROUP = 2
const FAILURE_EXIT_CODE = 1
const STARTUP_TIMING_PATTERN = /Startup timing.*label: '([^']+)'.*elapsedMs: ([0-9.]+)/

type ElectronDevChildProcess = ChildProcessByStdio<null, Readable, Readable>

interface CliOptions {
  readonly runs: number
  readonly timeoutMs: number
  readonly port: number | null
}

interface StartupTiming {
  readonly label: string
  readonly elapsedMs: number
}

interface StartupRunResult {
  readonly run: number
  readonly cdpReadyMs: number
  readonly apiReadyMs: number
  readonly url: string
  readonly mainTimings: readonly StartupTiming[]
}

function parsePositiveInteger(raw: string, optionName: string) {
  const value = Number.parseInt(raw, DECIMAL_RADIX)
  if (!Number.isInteger(value) || value <= ZERO) {
    throw new Error(`${optionName} must be a positive integer.`)
  }
  return value
}

function readNumberOption(args: readonly string[], optionName: string, fallback: number) {
  const prefix = `${optionName}=`
  const match = args.find((arg) => arg.startsWith(prefix))
  return match ? parsePositiveInteger(match.slice(prefix.length), optionName) : fallback
}

function readOptionalNumberOption(args: readonly string[], optionName: string) {
  const prefix = `${optionName}=`
  const match = args.find((arg) => arg.startsWith(prefix))
  return match ? parsePositiveInteger(match.slice(prefix.length), optionName) : null
}

function readCliOptions(): CliOptions {
  const args = process.argv.slice(CLI_ARGS_START_INDEX)
  return {
    runs: readNumberOption(args, OPTION_RUNS, DEFAULT_RUNS),
    timeoutMs: readNumberOption(args, OPTION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    port: readOptionalNumberOption(args, OPTION_PORT),
  }
}

function elapsedMs(startedAt: number) {
  return Number((performance.now() - startedAt).toFixed(TIMING_PRECISION))
}

async function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(EPHEMERAL_PORT, LOCALHOST, () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        server.close(() => resolve(address.port))
        return
      }
      server.close(() => reject(new Error('Could not allocate a startup measurement port.')))
    })
  })
}

function appendRecentLines(lines: string[], chunk: Buffer) {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line.trim().length === ZERO) {
      continue
    }
    lines.push(line)
    while (lines.length > RECENT_LOG_LINE_COUNT) {
      lines.shift()
    }
  }
}

function parseStartupTiming(line: string): StartupTiming | null {
  const match = line.match(STARTUP_TIMING_PATTERN)
  const label = match?.[FIRST_CAPTURE_GROUP]
  const elapsed = match?.[SECOND_CAPTURE_GROUP]
  if (!label || !elapsed) {
    return null
  }
  return { label, elapsedMs: Number.parseFloat(elapsed) }
}

function collectStartupTimings(lines: readonly string[]) {
  return lines.flatMap((line) => {
    const timing = parseStartupTiming(line)
    return timing ? [timing] : []
  })
}

function createElectronEnv(userDataDir: string): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
    OPENWAGGLE_USER_DATA_DIR: userDataDir,
  }
  delete childEnv.ELECTRON_RUN_AS_NODE
  return childEnv
}

function spawnElectronDev(port: number, userDataDir: string) {
  return spawn(
    'pnpm',
    [
      'exec',
      'electron-vite',
      'dev',
      '--',
      `--remote-debugging-port=${port}`,
      `--${STARTUP_TIMINGS_SWITCH}`,
    ],
    {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      env: createElectronEnv(userDataDir),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
}

async function waitForCdp(port: number, startedAt: number, timeoutMs: number) {
  const endpoint = `http://${LOCALHOST}:${port}/json/version`
  while (elapsedMs(startedAt) < timeoutMs) {
    try {
      const response = await fetch(endpoint)
      if (response.ok) {
        return elapsedMs(startedAt)
      }
    } catch {
      // Keep polling until Electron opens the debugging endpoint.
    }
    await delay(CDP_POLL_INTERVAL_MS)
  }
  throw new Error(`Timed out waiting for Electron CDP endpoint on port ${port}.`)
}

function isOpenWagglePage(page: Page) {
  const url = page.url()
  return url.includes(LOCALHOST_RENDERER_MARKER) || url.startsWith(OPENWAGGLE_PROTOCOL_PREFIX)
}

async function waitForOpenWagglePage(browser: Browser, timeoutMs: number) {
  const startedAt = performance.now()
  while (elapsedMs(startedAt) < timeoutMs) {
    for (const context of browser.contexts()) {
      const page = context.pages().find(isOpenWagglePage)
      if (page) {
        return page
      }
    }
    await delay(CDP_POLL_INTERVAL_MS)
  }
  throw new Error('Timed out waiting for the OpenWaggle renderer page.')
}

function waitForChildExit(child: ElectronDevChildProcess) {
  return new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })
}

function signalProcessGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (process.platform === 'win32' || !pid) {
    return false
  }

  try {
    process.kill(-pid, signal)
    return true
  } catch {
    return false
  }
}

async function stopChild(child: ElectronDevChildProcess) {
  const signalledGroup = signalProcessGroup(child.pid, 'SIGTERM')
  if (!signalledGroup && child.exitCode === null) {
    child.kill()
  }

  if (child.exitCode === null) {
    await Promise.race([waitForChildExit(child), delay(PROCESS_EXIT_TIMEOUT_MS)])
  } else {
    await delay(CLEANUP_RETRY_DELAY_MS)
  }
  if (child.exitCode === null) {
    signalProcessGroup(child.pid, 'SIGKILL')
    child.kill('SIGKILL')
    return
  }
  signalProcessGroup(child.pid, 'SIGKILL')
}

async function removeUserDataDir(userDataDir: string) {
  for (let attempt = 1; attempt <= CLEANUP_RETRY_COUNT; attempt += 1) {
    try {
      await rm(userDataDir, { force: true, recursive: true })
      return
    } catch {
      await delay(CLEANUP_RETRY_DELAY_MS)
    }
  }
  console.warn(`Could not remove temporary user data directory: ${userDataDir}`)
}

async function closeBrowser(browser: Browser | null) {
  if (!browser) {
    return
  }
  await Promise.race([browser.close(), delay(BROWSER_CLOSE_TIMEOUT_MS)]).catch(() => undefined)
}

async function measureRun(run: number, options: CliOptions): Promise<StartupRunResult> {
  const port = options.port ?? (await findFreePort())
  const userDataDir = await mkdtemp(path.join(tmpdir(), TEMP_DIR_PREFIX))
  const recentOutputLines: string[] = []
  const startedAt = performance.now()
  const child = spawnElectronDev(port, userDataDir)
  let browser: Browser | null = null

  child.stdout.on('data', (chunk: Buffer) => appendRecentLines(recentOutputLines, chunk))
  child.stderr.on('data', (chunk: Buffer) => appendRecentLines(recentOutputLines, chunk))

  try {
    const cdpReadyMs = await waitForCdp(port, startedAt, options.timeoutMs)
    browser = await chromium.connectOverCDP(`http://${LOCALHOST}:${port}`)
    const page = await waitForOpenWagglePage(browser, options.timeoutMs)
    await page.waitForFunction(
      'typeof window.api === "object" && typeof window.api.getSettings === "function"',
      undefined,
      {
        timeout: options.timeoutMs,
      },
    )
    await page.evaluate('window.api.getSettings()')
    const apiReadyMs = elapsedMs(startedAt)
    await delay(POST_READY_LOG_DRAIN_MS)
    return {
      run,
      cdpReadyMs,
      apiReadyMs,
      url: page.url(),
      mainTimings: collectStartupTimings(recentOutputLines),
    }
  } catch (error) {
    const recentOutput = recentOutputLines.join('\n')
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${recentOutput}`, {
      cause: error,
    })
  } finally {
    await stopChild(child)
    await closeBrowser(browser)
    await removeUserDataDir(userDataDir)
  }
}

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, ZERO) / values.length
}

async function main() {
  const options = readCliOptions()
  const results: StartupRunResult[] = []
  for (let run = 1; run <= options.runs; run += 1) {
    const result = await measureRun(run, options)
    results.push(result)
    console.info(
      `run ${run}: cdp=${result.cdpReadyMs}ms api=${result.apiReadyMs}ms url=${result.url}`,
    )
  }

  const summary = {
    runs: results,
    averageCdpReadyMs: Number(
      average(results.map((result) => result.cdpReadyMs)).toFixed(TIMING_PRECISION),
    ),
    averageApiReadyMs: Number(
      average(results.map((result) => result.apiReadyMs)).toFixed(TIMING_PRECISION),
    ),
  }
  console.info(JSON.stringify(summary, null, JSON_INDENT_SPACES))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = FAILURE_EXIT_CODE
})
