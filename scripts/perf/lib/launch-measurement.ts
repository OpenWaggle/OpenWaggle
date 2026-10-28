import type { PerfApp } from './perf-app'
import type { PerfProfile } from './perf-profile'
import { readRendererBoot } from './perf-page'
import { delay, type LaunchMode, withRunningApp } from './running-app'

export type { LaunchMode } from './running-app'

export interface LaunchMeasurementOptions {
  readonly mode: LaunchMode
  readonly templateUserData?: string
  readonly templateHome?: string
  readonly sessionListText: string | null
  readonly timeoutMs: number
  readonly warmHostIdleMs: number
  readonly settleMs: number
  /** Runs on the fresh profile before launch, such as seeding a warm compile cache. */
  readonly prepareProfile?: (profile: PerfProfile) => Promise<void>
}

function sinceSpawn(spawnedAt: number, timeOrigin: number, rendererMs: number | null | undefined) {
  return typeof rendererMs === 'number' ? Math.round(timeOrigin + rendererMs - spawnedAt) : null
}

/** When the main process logged the mark, after spawn; its own `elapsedMs` starts later. */
function markArrival(marks: readonly { label: string; arrivedMs: number }[], label: string) {
  return marks.find((candidate) => candidate.label === label)?.arrivedMs ?? null
}

function afterNavigation(value: number | null) {
  return value === null ? null : Math.round(value)
}

/**
 * One launch of the app on a throwaway profile: main-process startup marks, then, on the
 * renderer clock, first paint, the shell, the Session list, the chat surface and LCP.
 */
export function measureLaunch(app: PerfApp, options: LaunchMeasurementOptions) {
  return withRunningApp(app, options, async ({ launched, page, instrumentedFromStart }) => {
    await delay(options.settleMs)
    const boot = await readRendererBoot(page, instrumentedFromStart)
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
      lcpAfterNavigationMs: afterNavigation(boot.largestContentfulPaint),
      // The window may open before the Host is ready (decision 3), so LCP is also given from spawn.
      lcpSinceSpawnMs: sinceSpawn(spawnedAt, boot.timeOrigin, boot.largestContentfulPaint),
      domContentLoadedAfterNavigationMs: afterNavigation(boot.domContentLoaded),
      rendererLongTaskMs: Math.round(boot.longTaskMs),
      marks,
    }
  })
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
  'lcpSinceSpawnMs',
  'domContentLoadedAfterNavigationMs',
  'rendererLongTaskMs',
] as const
