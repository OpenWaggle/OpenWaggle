/**
 * One bench run of the installed Electrobun app (scripts/bench/electron-bench.ts `--shell
 * electrobun`), the same steps as the Electron run (electron-bench-run.ts): a cold launch on a new
 * scratch profile with idle memory, one fake-provider turn and after-turn memory, then a warm launch
 * of the same profile. The warm launch carries the turn's Session link, which the launcher hands to
 * the main process (vendor/electrobun patch 0006), and the window opens it. It drives the app with
 * the package proof's launcher and proofs (scripts/electrobun/ci/).

 *
 * macOS measures its WKWebView window without CDP (electrobun-bench-native-window.ts).
 */
import fs from 'node:fs'
import path from 'node:path'
import { electrobunAppHome } from '../support/electrobun-app-launch'
import { appCli, type LaunchContext, startApp, stopApp } from '../electrobun/ci/app-launch'
import {
  createProject,
  proveFakeProviderRun,
  proveTerminal,
  screenshot,
  startCiFakeProvider,
  waitUntil,
} from '../electrobun/ci/app-proof'
import { proveBrowserPreview } from '../electrobun/ci/preview-proof'
import { install, installedApp } from '../electrobun/ci/installed-app'
import { directoryBytes } from '../electrobun-probe-host'
import { configureFakeProvider, FAKE_MODEL_REFERENCE } from '../perf/lib/fake-openai-provider'
import { STARTUP_TIMINGS_ENVIRONMENT_VARIABLE } from '../../src/main/session-host/session-host-launch-command'
import type { BenchRun } from './bench-stats'
import {
  HOST_EXIT_TIMEOUT_MS,
  hostRunning,
  IDLE_MS,
  measureWithoutDevTools,
  memory,
  step,
  WINDOW_DEVTOOLS,
} from './electrobun-bench-native-window'
import { startupMarksSince } from './startup-marks'

const LAUNCH_TIMEOUT_MS = 120_000
/** What a user downloads to install: the DMG, the Windows installer and its zip, the AppImage. */
const FRESH_INSTALL_ARTIFACT = /\.dmg$|-x64\.exe$|-setup\.zip$|\.AppImage$/u

/**
 * The installed app in the shape the Electron install writes (electron-installed-app.ts). With
 * `launcher`, the app the package proof already installed from `release` (electrobun-package.yml).
 */
export async function installElectrobunApp(release: string, launcher?: string) {
  const app = launcher === undefined ? (await install(release)).app : installedApp(launcher)
  const downloads: Record<string, number> = {}
  for (const file of fs.readdirSync(release).sort()) {
    if (FRESH_INSTALL_ARTIFACT.test(file)) {
      downloads[file] = fs.statSync(path.join(release, file)).size
    }
  }
  return {
    launcher: app.launcher,
    installRoot: app.installRoot,
    installedBytes: directoryBytes(app.installRoot),
    downloads,
  }
}

/** Quits the window, stops the Host, then waits for it to exit, as the Electron run does. */
async function stop(context: LaunchContext, connected: Awaited<ReturnType<typeof startApp>>) {
  await stopApp(context, connected.app)
  await waitUntil(
    'the Session Host to exit',
    HOST_EXIT_TIMEOUT_MS,
    async () => !hostRunning(context.app),
  ).catch(() => undefined)
}

/** Copies the run's app and Host logs, which hold their startup timings, next to the results. */
function keepLogs(profile: string, directory: string | undefined, index: number) {
  const logs = path.join(profile, 'logs')
  if (!directory || !fs.existsSync(logs)) return
  fs.cpSync(logs, path.join(directory, `run-${String(index)}`), { recursive: true })
}

export async function measureElectrobunRun(input: {
  readonly launcher: string
  readonly root: string
  readonly index: number
  readonly prove: boolean
  readonly screenshots: string | undefined
  readonly logs: string | undefined
}) {
  const profile = path.join(input.root, `run-${String(input.index)}`)
  fs.mkdirSync(profile, { recursive: true })
  const context: LaunchContext = {
    app: installedApp(input.launcher),
    profile,
    screenshots: input.screenshots ?? null,
    timeoutMs: LAUNCH_TIMEOUT_MS,
    environment: { [STARTUP_TIMINGS_ENVIRONMENT_VARIABLE]: '1' },
  }
  const logs = path.join(profile, 'logs')
  const provider = await startCiFakeProvider()
  await configureFakeProvider(
    electrobunAppHome({ userDataDir: profile }).piAgentDir,
    provider.baseUrl,
  )
  try {
    if (!WINDOW_DEVTOOLS) return await measureWithoutDevTools(context, profile)
    const cold = await startApp(context)
    step(
      `run ${String(input.index)} cold: renderer ${String(cold.spawnToRendererMs)} ms, backend ${String(cold.spawnToReadyMs)} ms`,
    )
    let proof: unknown = null
    let coldSample: BenchRun['cold']
    let sessionId: string
    try {
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
      const idle = memory(context.app, cold.app.child.pid)
      const run = await proveFakeProviderRun({
        cli: appCli(context, cold.app.cdpPort),
        page: cold.app.page,
        project: await createProject(path.join(profile, 'project')),
        model: FAKE_MODEL_REFERENCE,
        timeoutMs: LAUNCH_TIMEOUT_MS,
      })
      sessionId = run.sessionId
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
      const afterTurn = memory(context.app, cold.app.child.pid)
      await screenshot(cold.app.page, context.screenshots, `run-${String(input.index)}-session.png`)
      if (input.prove) {
        const terminal = await proveTerminal(cold.app.page, LAUNCH_TIMEOUT_MS)
        step('the terminal echoed')
        const preview = await proveBrowserPreview({
          app: cold.app,
          sessionId,
          screenshots: context.screenshots,
          timeoutMs: LAUNCH_TIMEOUT_MS,
        })
        step('the Browser preview is a DevTools target')
        proof = { terminal, preview }
      }
      coldSample = {
        windowReadyMs: cold.spawnToRendererMs,
        backendReadyMs: cold.spawnToReadyMs,
        marks: startupMarksSince(logs, cold.app.spawnedAt),
        idle,
        afterTurn,
        runMs: run.runMs,
      }
    } finally {
      await stop(context, cold)
    }
    const warmContext = { ...context, appArguments: [`openwaggle://sessions/${sessionId}`] }
    const warm = await startApp(warmContext)
    step(
      `run ${String(input.index)} warm: renderer ${String(warm.spawnToRendererMs)} ms, backend ${String(warm.spawnToReadyMs)} ms`,
    )
    try {
      await waitUntil('the window to open the Session link', LAUNCH_TIMEOUT_MS, () =>
        warm.app.page.evaluate((id) => window.location.href.includes(id), sessionId),
      )
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
      return { run, proof }
    } finally {
      await stop(warmContext, warm)
    }
  } finally {
    await provider.close()
    keepLogs(profile, input.logs, input.index)
  }
}
