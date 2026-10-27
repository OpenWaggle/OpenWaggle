import type { PerfApp } from './perf-app'
import { freePort, launchApp, stopProcessGroup } from './perf-app'
import { type BootConditions, connectRenderer, readRendererBoot, waitForMilestones } from './perf-page'
import { createPerfProfile, disposePerfProfile, type PerfProfile, profileEnvironment } from './perf-profile'

export type LaunchMode = 'cold' | 'warm'

export interface LaunchMeasurementOptions {
  readonly mode: LaunchMode
  readonly templateUserData?: string
  readonly templateHome?: string
  readonly sessionListText: string | null
  readonly timeoutMs: number
  /** How long a pre-started Host idles before the warm launch. */
  readonly warmHostIdleMs: number
  readonly settleMs: number
}

const LOADING_CHAT_TEXT = 'Loading chat'
const HOST_START_TIMEOUT_MS = 60_000
const LOG_TAIL_LINES = 5

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** `openwaggle host start` returns once the profile's Host listens, then leaves it running. */
async function startHost(app: PerfApp, profile: PerfProfile) {
  const started = launchApp(app, profileEnvironment(profile), ['--use-mock-keychain', 'host', 'start'])
  const exit = new Promise<number | null>((resolve) => started.child.once('exit', resolve))
  const code = await Promise.race([exit, delay(HOST_START_TIMEOUT_MS).then(() => -1)])
  if (code !== 0) {
    await stopProcessGroup(started.child)
    throw new Error(`host start exited with ${String(code)}: ${started.logLines.slice(-LOG_TAIL_LINES).join(' | ')}`)
  }
}

function sinceSpawn(spawnedAt: number, timeOrigin: number, rendererMs: number | null | undefined) {
  return typeof rendererMs === 'number' ? Math.round(timeOrigin + rendererMs - spawnedAt) : null
}

/** When the main process logged the mark, after spawn; its own `elapsedMs` starts later. */
function markArrival(marks: readonly { label: string; arrivedMs: number }[], label: string) {
  return marks.find((candidate) => candidate.label === label)?.arrivedMs ?? null
}

/**
 * One launch of the app on a throwaway profile: main-process startup marks, then, on the
 * renderer clock, first paint, the shell, the Session list, the chat surface and LCP. Everything
 * the launch started is stopped and the profile removed before it returns.
 */
export async function measureLaunch(app: PerfApp, options: LaunchMeasurementOptions) {
  const profile = await createPerfProfile({
    label: `${app.label}-${options.mode}`,
    ...(options.templateUserData ? { templateUserData: options.templateUserData } : {}),
    ...(options.templateHome ? { templateHome: options.templateHome } : {}),
  })
  let launched: ReturnType<typeof launchApp> | null = null
  let browser: Awaited<ReturnType<typeof connectRenderer>>['browser'] | null = null
  try {
    if (options.mode === 'warm') {
      await startHost(app, profile)
      await delay(options.warmHostIdleMs)
    }
    const port = await freePort()
    launched = launchApp(app, profileEnvironment(profile), [
      '--use-mock-keychain',
      `--remote-debugging-port=${String(port)}`,
      '--openwaggle-startup-timings',
    ])
    const conditions: BootConditions = {
      sessionListText: options.sessionListText,
      loadingText: LOADING_CHAT_TEXT,
    }
    const connected = await connectRenderer(port, options.timeoutMs, conditions)
    browser = connected.browser
    const wanted = ['shell', 'chatReady', ...(options.sessionListText ? ['sessionList'] : [])]
    await waitForMilestones(connected.page, wanted, options.timeoutMs)
    await delay(options.settleMs)
    const boot = await readRendererBoot(connected.page, connected.instrumentedFromStart)
    const { spawnedAt, marks } = launched
    const at = (milestone: string) => sinceSpawn(spawnedAt, boot.timeOrigin, boot.milestones[milestone])
    return {
      app: app.label,
      mode: options.mode,
      instrumentedFromStart: boot.instrumentedFromStart,
      windowCreatedMs: markArrival(marks, 'main-window-created'),
      hostListeningMs: markArrival(marks, 'session-host-listening'),
      navigationStartMs: Math.round(boot.timeOrigin - spawnedAt),
      firstPaintMs: sinceSpawn(spawnedAt, boot.timeOrigin, boot.firstContentfulPaint),
      shellVisibleMs: at('shell'),
      sessionListVisibleMs: options.sessionListText ? at('sessionList') : at('shell'),
      chatReadyMs: at('chatReady'),
      composerMs: at('composer'),
      lcpAfterNavigationMs: boot.largestContentfulPaint === null ? null : Math.round(boot.largestContentfulPaint),
      domContentLoadedAfterNavigationMs:
        boot.domContentLoaded === null ? null : Math.round(boot.domContentLoaded),
      rendererLongTaskMs: Math.round(boot.longTaskMs),
      marks,
    }
  } finally {
    await browser?.close().catch(() => undefined)
    if (launched) await stopProcessGroup(launched.child)
    await disposePerfProfile(profile)
  }
}

export const LAUNCH_METRICS = [
  'windowCreatedMs',
  'hostListeningMs',
  'navigationStartMs',
  'firstPaintMs',
  'shellVisibleMs',
  'sessionListVisibleMs',
  'chatReadyMs',
  'composerMs',
  'lcpAfterNavigationMs',
  'domContentLoadedAfterNavigationMs',
  'rendererLongTaskMs',
] as const
