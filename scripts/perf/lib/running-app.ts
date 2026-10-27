import type { Browser, Page } from '@playwright/test'
import { freePort, type LaunchedApp, launchApp, type PerfApp, stopProcessGroup } from './perf-app'
import { type BootConditions, connectRenderer, waitForMilestones } from './perf-page'
import { type CdpClient, connectInspector } from './main-inspector'
import { createPerfProfile, disposePerfProfile, type PerfProfile, profileEnvironment } from './perf-profile'

export type LaunchMode = 'cold' | 'warm'

export interface RunningAppOptions {
  readonly mode: LaunchMode
  readonly templateUserData?: string
  readonly templateHome?: string
  readonly projectPath?: string
  readonly sessionListText: string | null
  readonly timeoutMs: number
  /** How long a pre-started Host idles before the warm launch. */
  readonly warmHostIdleMs: number
  /** Attach the Node inspector to the GUI main process (for IPC accounting). */
  readonly mainInspector?: boolean
  readonly environment?: Readonly<Record<string, string>>
  /** Called with the fresh profile before anything starts, to add fixtures such as models. */
  readonly prepareProfile?: (profile: PerfProfile) => Promise<void>
}

export interface RunningApp {
  readonly profile: PerfProfile
  readonly launched: LaunchedApp
  readonly browser: Browser
  readonly page: Page
  readonly instrumentedFromStart: boolean
  readonly inspector: CdpClient | null
}

const LOADING_CHAT_TEXT = 'Loading chat'
const HOST_START_TIMEOUT_MS = 60_000
const LOG_TAIL_LINES = 5

export function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** `openwaggle host start` returns once the profile's Host listens, then leaves it running. */
export async function startHost(app: PerfApp, profile: PerfProfile, environment: Readonly<Record<string, string>> = {}) {
  const started = launchApp(app, profileEnvironment(profile, environment), ['--use-mock-keychain', 'host', 'start'])
  const exit = new Promise<number | null>((resolve) => started.child.once('exit', resolve))
  const code = await Promise.race([exit, delay(HOST_START_TIMEOUT_MS).then(() => -1)])
  if (code !== 0) {
    await stopProcessGroup(started.child)
    throw new Error(`host start exited with ${String(code)}: ${started.logLines.slice(-LOG_TAIL_LINES).join(' | ')}`)
  }
}

async function launchGui(app: PerfApp, profile: PerfProfile, options: RunningAppOptions) {
  const port = await freePort()
  const inspectorPort = options.mainInspector ? await freePort() : null
  const launched = launchApp(app, profileEnvironment(profile, options.environment), [
    ...(inspectorPort ? [`--inspect=${String(inspectorPort)}`] : []),
    '--use-mock-keychain',
    `--remote-debugging-port=${String(port)}`,
    '--openwaggle-startup-timings',
  ])
  return { launched, port, inspectorPort }
}

/**
 * Launches the app on a throwaway profile (optionally cloned from a template), waits until the
 * shell, the chat surface and, when asked, the Session list are visible, then hands the running
 * app to `use`. Everything it started is stopped and the profile removed afterwards.
 */
export async function withRunningApp<Result>(
  app: PerfApp,
  options: RunningAppOptions,
  use: (running: RunningApp) => Promise<Result>,
) {
  const profile = await createPerfProfile({
    label: `${app.label}-${options.mode}`,
    ...(options.templateUserData ? { templateUserData: options.templateUserData } : {}),
    ...(options.templateHome ? { templateHome: options.templateHome } : {}),
    ...(options.projectPath ? { projectPath: options.projectPath } : {}),
  })
  let launched: LaunchedApp | null = null
  let browser: Browser | null = null
  let inspector: CdpClient | null = null
  try {
    await options.prepareProfile?.(profile)
    if (options.mode === 'warm') {
      await startHost(app, profile, options.environment)
      await delay(options.warmHostIdleMs)
    }
    const gui = await launchGui(app, profile, options)
    launched = gui.launched
    const conditions: BootConditions = { sessionListText: options.sessionListText, loadingText: LOADING_CHAT_TEXT }
    const connected = await connectRenderer(gui.port, options.timeoutMs, conditions)
    browser = connected.browser
    const wanted = ['shell', 'chatReady', ...(options.sessionListText ? ['sessionList'] : [])]
    await waitForMilestones(connected.page, wanted, options.timeoutMs)
    if (gui.inspectorPort) inspector = await connectInspector(gui.inspectorPort, options.timeoutMs)
    return await use({ profile, launched, browser, page: connected.page, instrumentedFromStart: connected.instrumentedFromStart, inspector })
  } finally {
    inspector?.close()
    await browser?.close().catch(() => undefined)
    if (launched) await stopProcessGroup(launched.child)
    // OWPERF_KEEP_PROFILE=1 keeps the stopped profile (logs, database) for diagnosis.
    await disposePerfProfile(profile, process.env.OWPERF_KEEP_PROFILE === '1')
    if (process.env.OWPERF_KEEP_PROFILE === '1') process.stderr.write(`kept ${profile.root}\n`)
  }
}
