/**
 * Starts a built OpenWaggle Electrobun app for automation (screenshots, perf harnesses, live QA,
 * `bun run dev:debug`) and connects Playwright to its renderer over CDP. Every scripted launch comes
 * through here (scripts/standards/desktop-automation.ts), so it always:
 *
 * - sets OPENWAGGLE_AUTOMATION=1: the main window stays hidden and no OS UI appears
 *   (src/main/adapters/electrobun/electrobun-automation.ts);
 * - points HOME, the Pi agent directory and userData at scratch directories: overriding userData
 *   alone still reads the user's global MCP servers and Pi sign-ins;
 * - renders the hidden main window with the bundled CEF (OPENWAGGLE_QA_MAIN_WINDOW_RENDERER=cef,
 *   src/main/adapters/electrobun/electrobun-main-window.ts) and opens CEF's DevTools endpoint on the
 *   port it is given (ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT, vendor/electrobun patch 0006). A system
 *   webview has no CDP endpoint.
 *
 * The launcher forwards its arguments to the main process; inputs that must reach the app before
 * its first line runs still travel as `OPENWAGGLE_*` variables.
 *
 * CEF runs one browser process per cache directory, and Electrobun keeps that under the app's
 * identifier in the OS app-data folder (`~/Library/Application Support/<identifier>/<env>/CEF` on
 * macOS), not under HOME. A launch while the same build already runs hands its window to that
 * process and exits, so `waitForRendererTarget` reports it instead of waiting.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { type Browser, chromium, type Page } from '@playwright/test'
import { electrobunLauncher } from '../electrobun-payload'
import { discoverElectrobunApps } from '../native-platform-floor-targets'
import { buildSafeAppEnvironment } from '../safe-app-environment'
import { forwardLines, type PipedChildProcess } from './child-output-lines'

type LaunchPlatform = 'darwin' | 'linux' | 'win32'

/** The port `bun run dev:debug` and the electron-qa skill attach to. */
export const DEV_DEBUG_CDP_PORT = 9223

const SCRATCH_HOME_DIRECTORY = 'home'
const LOCALHOST = '127.0.0.1'
const EPHEMERAL_PORT = 0
const CDP_POLL_MS = 200
const DEFAULT_LAUNCH_TIMEOUT_MS = 120_000
const STOP_GRACE_MS = 5_000
const STOP_POLL_MS = 100
const LOG_TAIL_LINES = 20
const RENDERER_PAGE_SUFFIX = '/index.html'
/** What CEF logs when another process already owns the app's cache directory. */
const CEF_HANDOFF_LINE = 'Opening in existing browser session'

export interface ScratchProfileInput {
  readonly userDataDir: string
  /** A scratch HOME for the app; defaults to `<userDataDir>/home`. */
  readonly homeDir?: string
  /** A scratch Pi agent directory; defaults to `<home>/.pi/agent`. */
  readonly piAgentDir?: string
}

export function electrobunAppHome(input: ScratchProfileInput) {
  const home = input.homeDir ?? path.join(input.userDataDir, SCRATCH_HOME_DIRECTORY)
  return { home, piAgentDir: input.piAgentDir ?? path.join(home, '.pi', 'agent') }
}

/** The variables that render the hidden main window with CEF and open its DevTools endpoint. */
export function cefDevToolsEnvironment(port: number) {
  return {
    OPENWAGGLE_AUTOMATION: '1',
    OPENWAGGLE_QA_MAIN_WINDOW_RENDERER: 'cef',
    ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT: String(port),
  }
}

/**
 * The app's environment: the safe inherited baseline, the caller's fixture variables, then the
 * automation, home and storage controls, which a fixture never overrides.
 */
export function buildElectrobunAppEnvironment(
  input: ScratchProfileInput & {
    readonly cdpPort: number
    readonly environment?: Readonly<Record<string, string>>
  },
) {
  const home = electrobunAppHome(input)
  const appControls = {
    HOME: home.home,
    USERPROFILE: home.home,
    PI_CODING_AGENT_DIR: home.piAgentDir,
    OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
    OPENWAGGLE_USER_DATA_DIR: input.userDataDir,
    ...cefDevToolsEnvironment(input.cdpPort),
  }
  return { ...buildSafeAppEnvironment(appControls), ...input.environment, ...appControls }
}

/**
 * Chromium's mock keychain (and Linux's basic password store) keeps the app, and the Session Host it
 * forwards the switches to, off the user's credential store. Automation mode already does on
 * Electrobun (src/main/adapters/electrobun/electrobun-secure-storage.ts); the switches keep a Host
 * the app starts on the same footing.
 */
export function credentialStoreArguments(platform: NodeJS.Platform = process.platform) {
  return ['--use-mock-keychain', ...(platform === 'linux' ? ['--password-store=basic'] : [])]
}

function launchPlatform(platform: NodeJS.Platform): LaunchPlatform {
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') return platform
  throw new Error(`OpenWaggle has no Electrobun build for ${platform}.`)
}

/**
 * The launcher of an app: a `.app` bundle or an unpacked Linux or Windows app directory, or, with no
 * path, the build `bun run package:app` left in this checkout (`out/electrobun`).
 */
export async function resolveElectrobunLauncher(
  appPath?: string,
  platform: NodeJS.Platform = process.platform,
) {
  const target = launchPlatform(platform)
  const [root] = appPath === undefined ? await discoverElectrobunApps(target) : [appPath]
  if (root === undefined) throw new Error('No Electrobun app to launch.')
  const launcher = await electrobunLauncher(path.resolve(root), target)
  if (launcher === null) throw new Error(`${root} has no Electrobun launcher.`)
  return path.join(path.resolve(root), launcher)
}

export function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(EPHEMERAL_PORT, LOCALHOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : EPHEMERAL_PORT
      server.close(() => resolve(port))
    })
  })
}

type AppProcess = PipedChildProcess

export interface LaunchedElectrobunApp {
  readonly child: AppProcess
  readonly spawnedAt: number
  readonly cdpPort: number
  readonly logLines: string[]
}

export interface ElectrobunLaunchInput extends ScratchProfileInput {
  readonly launcher: string
  readonly cdpPort: number
  readonly cwd?: string
  /** Arguments the launcher forwards to the main process. */
  readonly appArguments?: readonly string[]
  /** Test-only child environment overrides applied after the safe inherited baseline. */
  readonly environment?: Readonly<Record<string, string>>
  /** Each line the app writes to stdout or stderr. */
  readonly onLine?: (line: string) => void
}

/**
 * Starts the launcher in its own process group (so `stopElectrobunApp` stops the CEF helpers with
 * it), collecting its output.
 */
export async function startElectrobunApp(
  input: ElectrobunLaunchInput,
): Promise<LaunchedElectrobunApp> {
  // Tools the app starts expect the home and Pi agent directories to exist.
  await fs.mkdir(electrobunAppHome(input).piAgentDir, { recursive: true })
  const spawnedAt = Date.now()
  const child = spawn(
    input.launcher,
    [...credentialStoreArguments(), ...(input.appArguments ?? [])],
    {
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      env: buildElectrobunAppEnvironment(input),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  const logLines: string[] = []
  const onLine = (line: string) => {
    logLines.push(line)
    input.onLine?.(line)
  }
  forwardLines(child.stdout, onLine)
  forwardLines(child.stderr, onLine)
  return { child, spawnedAt, cdpPort: input.cdpPort, logLines }
}

function hasExited(child: AppProcess) {
  return child.exitCode !== null || child.signalCode !== null
}

function signalApp(child: AppProcess, signal: NodeJS.Signals) {
  if (child.pid === undefined || hasExited(child)) return
  try {
    // The launcher leads its own process group on macOS and Linux; on Windows it has no group.
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal)
  } catch {
    // Already gone.
  }
}

/** Stops an app this script started: SIGTERM, then SIGKILL after a grace period. */
export async function stopElectrobunApp(app: LaunchedElectrobunApp) {
  signalApp(app.child, 'SIGTERM')
  const deadline = Date.now() + STOP_GRACE_MS
  while (!hasExited(app.child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS))
  }
  signalApp(app.child, 'SIGKILL')
}

interface DevToolsTarget {
  readonly type?: unknown
  readonly url?: unknown
}

async function rendererTargetListed(port: number) {
  try {
    const response = await fetch(`http://${LOCALHOST}:${String(port)}/json/list`)
    if (!response.ok) return false
    const targets: unknown = await response.json()
    return (
      Array.isArray(targets) && targets.some((target: DevToolsTarget) => isRendererUrl(target.url))
    )
  } catch {
    return false
  }
}

function isRendererUrl(url: unknown) {
  if (typeof url !== 'string') return false
  const withoutQuery = url.split(/[?#]/u)[0] ?? ''
  return withoutQuery.endsWith(RENDERER_PAGE_SUFFIX)
}

/** The app's main renderer page among a CDP browser's pages. */
export function rendererPage(browser: Browser) {
  return browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => isRendererUrl(page.url()))
}

/** Waits until the app's DevTools endpoint lists its renderer page. */
export async function waitForRendererTarget(app: LaunchedElectrobunApp, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (hasExited(app.child)) {
      if (app.logLines.some((line) => line.includes(CEF_HANDOFF_LINE))) {
        throw new Error(
          'The app handed its window to a running copy of the same build (CEF allows one process per app identifier). Quit that copy, or launch another build.',
        )
      }
      throw new Error(
        `The app exited (${String(app.child.exitCode ?? app.child.signalCode)}) before its renderer opened: ${app.logLines.slice(-LOG_TAIL_LINES).join(' | ')}`,
      )
    }
    if (await rendererTargetListed(app.cdpPort)) return
    await new Promise((resolve) => setTimeout(resolve, CDP_POLL_MS))
  }
  throw new Error(
    `No renderer page on CDP port ${String(app.cdpPort)} after ${String(timeoutMs)} ms: ${app.logLines.slice(-LOG_TAIL_LINES).join(' | ')}`,
  )
}

export interface ConnectedElectrobunApp extends LaunchedElectrobunApp {
  readonly browser: Browser
  readonly page: Page
  /** Disconnects Playwright, then stops the app. */
  readonly close: () => Promise<void>
}

/** Connects Playwright to a started app's renderer page. */
export async function connectElectrobunApp(
  app: LaunchedElectrobunApp,
  timeoutMs: number = DEFAULT_LAUNCH_TIMEOUT_MS,
): Promise<ConnectedElectrobunApp> {
  await waitForRendererTarget(app, timeoutMs)
  const browser = await chromium.connectOverCDP(`http://${LOCALHOST}:${String(app.cdpPort)}`)
  const deadline = Date.now() + timeoutMs
  let page = rendererPage(browser)
  while (page === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CDP_POLL_MS))
    page = rendererPage(browser)
  }
  if (page === undefined) {
    await browser.close().catch(() => undefined)
    throw new Error('Playwright saw no renderer page on the app DevTools endpoint.')
  }
  const close = async () => {
    await browser.close().catch(() => undefined)
    await stopElectrobunApp(app)
  }
  return { ...app, browser, page, close }
}

/** Starts an app hidden and connects Playwright to its renderer; stops it if that fails. */
export async function launchElectrobunApp(
  input: Omit<ElectrobunLaunchInput, 'cdpPort'> & {
    readonly cdpPort?: number
    readonly timeoutMs?: number
  },
) {
  const cdpPort = input.cdpPort ?? (await freePort())
  const started = await startElectrobunApp({ ...input, cdpPort })
  try {
    return await connectElectrobunApp(started, input.timeoutMs)
  } catch (error) {
    await stopElectrobunApp(started)
    throw error
  }
}
