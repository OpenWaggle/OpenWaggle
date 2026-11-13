/**
 * The Electrobun bench run against the window users run (electrobun-bench-run.ts). macOS renders
 * it with WKWebView, which has no DevTools endpoint (`WINDOW_DEVTOOLS`), so the window and backend
 * times come from the startup marks, the turn runs through the CLI, and its Session opens in the
 * window from a second launch with the Session link, which hands it to the running app as a clicked
 * link does. The CDP proofs (terminal, Browser preview, screenshots) run in the package proof,
 * which renders the window with CEF to reach it.
 */
import path from 'node:path'
import {
  LAUNCHER_CHOSEN_CDP_PORT,
  type LaunchedElectrobunApp,
  startElectrobunApp,
  stopElectrobunApp,
} from '../support/electrobun-app-launch'
import { appCli, type LaunchContext } from '../electrobun/ci/app-launch'
import { createProject, runFakeProviderTurn, waitUntil } from '../electrobun/ci/app-proof'
import {
  type InstalledApp,
  processesNaming,
  stopProcessesUnder,
} from '../electrobun/ci/installed-app'
import { FAKE_MODEL_REFERENCE } from '../perf/lib/fake-openai-provider'
import { sampleAppMemory } from './app-processes'
import type { BenchRun } from './bench-stats'
import { startupMarksSince, WINDOW_SHOWN_MARK } from './startup-marks'

export const IDLE_MS = 10_000
export const HOST_EXIT_TIMEOUT_MS = 15_000
const LINK_HANDOFF_TIMEOUT_MS = 30_000
const LOG_TAIL_LINES = 20
/** The main process's mark when the window's startup status turned `ready`. */
const BACKEND_READY_MARK = 'startup-status-ready'
/** Whether the bench reaches the window over CDP; macOS's WKWebView window has no endpoint. */
export const WINDOW_DEVTOOLS = process.platform !== 'darwin'

export function step(message: string) {
  console.log(`bench: ${message}`)
}

export function memory(app: InstalledApp, pid: number | undefined) {
  return sampleAppMemory({
    rootPids: pid === undefined ? [] : [pid],
    installPaths: [app.installRoot],
  })
}

export function hostRunning(app: InstalledApp) {
  return processesNaming([app.installRoot]).some((row) =>
    row.command.includes('session-host-internal'),
  )
}

function hasExited(app: LaunchedElectrobunApp) {
  return app.child.exitCode !== null || app.child.signalCode !== null
}

/** Starts the app with no DevTools endpoint and waits for its window and backend marks. */
async function launchWithoutDevTools(context: LaunchContext, appArguments?: readonly string[]) {
  const logs = path.join(context.profile, 'logs')
  const app = await startElectrobunApp({
    launcher: context.app.launcher,
    cdpPort: LAUNCHER_CHOSEN_CDP_PORT,
    windowDevTools: false,
    userDataDir: context.profile,
    ...(context.environment === undefined ? {} : { environment: context.environment }),
    ...(appArguments === undefined ? {} : { appArguments }),
    onLine: (line) => console.log(`[app] ${line}`),
  })
  try {
    const marks = await waitUntil(
      'the window and startup status ready',
      context.timeoutMs,
      async () => {
        if (hasExited(app)) {
          throw new Error(
            `The app exited before it was ready: ${app.logLines.slice(-LOG_TAIL_LINES).join(' | ')}`,
          )
        }
        const current = startupMarksSince(logs, app.spawnedAt)
        return WINDOW_SHOWN_MARK in current && BACKEND_READY_MARK in current ? current : null
      },
    )
    return {
      app,
      spawnToRendererMs: marks[WINDOW_SHOWN_MARK] ?? 0,
      spawnToReadyMs: marks[BACKEND_READY_MARK] ?? 0,
    }
  } catch (error) {
    await stopElectrobunApp(app)
    stopProcessesUnder(context.app.installRoot)
    throw error
  }
}

/** Opens a Session link in the running app the way a click does: a second launch hands it over. */
async function openSessionLink(context: LaunchContext, sessionId: string) {
  const second = await startElectrobunApp({
    launcher: context.app.launcher,
    cdpPort: LAUNCHER_CHOSEN_CDP_PORT,
    windowDevTools: false,
    userDataDir: context.profile,
    ...(context.environment === undefined ? {} : { environment: context.environment }),
    appArguments: [`openwaggle://sessions/${sessionId}`],
    onLine: (line) => console.log(`[link] ${line}`),
  })
  await waitUntil('the link launch to hand over and quit', LINK_HANDOFF_TIMEOUT_MS, async () =>
    hasExited(second),
  ).catch(async (error: unknown) => {
    await stopElectrobunApp(second)
    throw error
  })
}

async function stopWithoutDevTools(context: LaunchContext, app: LaunchedElectrobunApp) {
  await stopElectrobunApp(app)
  await appCli(context, LAUNCHER_CHOSEN_CDP_PORT)(['host', 'stop']).catch(() => undefined)
  stopProcessesUnder(context.app.installRoot)
  await waitUntil(
    'the Session Host to exit',
    HOST_EXIT_TIMEOUT_MS,
    async () => !hostRunning(context.app),
  ).catch(() => undefined)
}

/** One bench run against the WKWebView window: marks, the CLI and a handed-over Session link. */
export async function measureWithoutDevTools(context: LaunchContext, profile: string) {
  const logs = path.join(profile, 'logs')
  const cold = await launchWithoutDevTools(context)
  step(
    `cold: window ${String(cold.spawnToRendererMs)} ms, backend ${String(cold.spawnToReadyMs)} ms`,
  )
  let coldSample: BenchRun['cold']
  let sessionId: string
  try {
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
    const idle = memory(context.app, cold.app.child.pid)
    const run = await runFakeProviderTurn({
      cli: appCli(context, LAUNCHER_CHOSEN_CDP_PORT),
      project: await createProject(path.join(profile, 'project')),
      model: FAKE_MODEL_REFERENCE,
    })
    sessionId = run.sessionId
    await openSessionLink(context, sessionId)
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
    coldSample = {
      windowReadyMs: cold.spawnToRendererMs,
      backendReadyMs: cold.spawnToReadyMs,
      marks: startupMarksSince(logs, cold.app.spawnedAt),
      idle,
      afterTurn: memory(context.app, cold.app.child.pid),
      runMs: run.runMs,
    }
  } finally {
    await stopWithoutDevTools(context, cold.app)
  }
  const warm = await launchWithoutDevTools(context, [`openwaggle://sessions/${sessionId}`])
  step(
    `warm: window ${String(warm.spawnToRendererMs)} ms, backend ${String(warm.spawnToReadyMs)} ms`,
  )
  try {
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
    const run: BenchRun = {
      cold: coldSample,
      warm: {
        windowReadyMs: warm.spawnToRendererMs,
        backendReadyMs: warm.spawnToReadyMs,
        marks: startupMarksSince(logs, warm.app.spawnedAt),
        idle: memory(context.app, warm.app.child.pid),
      },
    }
    return { run, proof: null }
  } finally {
    await stopWithoutDevTools(context, warm.app)
  }
}
