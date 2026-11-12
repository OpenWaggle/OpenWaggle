/**
 * One bench run of the installed Electron app (scripts/bench/electron-bench.ts): a cold launch on a
 * new scratch profile with idle memory, one fake-provider turn and after-turn memory, then a warm
 * launch of the same profile that opens the turn's Session from its link.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Browser, Page } from '@playwright/test'
import { configureFakeProvider, FAKE_MODEL_REFERENCE } from '../perf/lib/fake-openai-provider'
import { type AppMemory, listProcesses, sampleAppMemory } from './app-processes'
import {
  connectRenderer,
  proveBrowserPreview,
  proveFakeProviderRun,
  proveTerminal,
  startBenchFakeProvider,
  waitForRendererTarget,
  waitForStartupReady,
  waitUntil,
} from './app-proof'
import type { BenchRun } from './bench-stats'
import {
  createScratchProfile,
  freePort,
  type InstalledElectronApp,
  runAppCli,
  type ScratchProfile,
  type StartedApp,
  startElectronApp,
  stopElectronApp,
  stopProcessesUnder,
} from './electron-installed-app'

const IDLE_MS = 10_000
const LAUNCH_TIMEOUT_MS = 120_000
const CLI_TIMEOUT_MS = 180_000
const STARTUP_TIMING_PATTERN = /Startup timing.*label: '([^']+)'/u
const LOG_TAIL_LINES = 30
const HOST_EXIT_TIMEOUT_MS = 15_000
const APPIMAGE_MOUNT = /(\/tmp\/\.mount_[^/\s]+)/u

function step(message: string) {
  console.log(`bench: ${message}`)
}

interface Connected {
  readonly started: StartedApp
  readonly browser: Browser
  readonly page: Page
  readonly windowReadyMs: number
  readonly backendReadyMs: number
}

/** Where the app's processes run from: the install, plus an AppImage's mount directory. */
function installPaths(app: InstalledElectronApp) {
  if (!app.installRoot.endsWith('.AppImage')) return [app.installRoot]
  const mounts = listProcesses().flatMap((row) => {
    const mount = APPIMAGE_MOUNT.exec(row.command)?.[1]
    return mount === undefined ? [] : [mount]
  })
  return [app.installRoot, ...new Set(mounts)]
}

function marksAfterSpawn(started: StartedApp) {
  const marks: Record<string, number> = {}
  for (const line of started.logLines) {
    const label = STARTUP_TIMING_PATTERN.exec(line)?.[1]
    const uptime = /at ([0-9.]+) ms uptime/u.exec(line)?.[1]
    if (label !== undefined && uptime !== undefined && marks[label] === undefined) {
      marks[label] = Number(uptime)
    }
  }
  return marks
}

async function launch(
  app: InstalledElectronApp,
  profile: ScratchProfile,
  appArguments: readonly string[] = [],
): Promise<Connected> {
  const cdpPort = await freePort()
  const started = startElectronApp({ app, profile, cdpPort, appArguments })
  const exited = () => started.child.exitCode !== null || started.child.signalCode !== null
  try {
    await waitForRendererTarget(cdpPort, LAUNCH_TIMEOUT_MS, exited)
    const windowReadyMs = Date.now() - started.spawnedAt
    const { browser, page } = await connectRenderer(cdpPort, LAUNCH_TIMEOUT_MS)
    await waitForStartupReady(page, LAUNCH_TIMEOUT_MS)
    const backendReadyMs = Date.now() - started.spawnedAt
    return { started, browser, page, windowReadyMs, backendReadyMs }
  } catch (error) {
    await stopElectronApp(started)
    stopProcessesUnder(installPaths(app))
    throw new Error(`${String(error)}\n${started.logLines.slice(-LOG_TAIL_LINES).join('\n')}`, {
      cause: error,
    })
  }
}

function memory(app: InstalledElectronApp, connected: Connected): AppMemory {
  const pid = connected.started.child.pid
  return sampleAppMemory({
    rootPids: pid === undefined ? [] : [pid],
    installPaths: installPaths(app),
  })
}

function hostRunning(app: InstalledElectronApp) {
  const paths = installPaths(app).map((entry) => entry.toLowerCase())
  return listProcesses().some(
    (row) =>
      row.command.includes('session-host-internal') &&
      paths.some((entry) => row.command.toLowerCase().includes(entry)),
  )
}

/**
 * Quits the window, then stops the Host and waits for it to exit, as one that idles out does: a
 * Host killed mid-exit leaves its socket, and the next launch then skips the boot shim's Host
 * prelaunch for a profile no user has. Only what is still running after that is killed.
 */
async function stop(app: InstalledElectronApp, profile: ScratchProfile, connected: Connected) {
  await connected.browser.close().catch(() => undefined)
  await stopElectronApp(connected.started)
  await runAppCli(app, profile, ['host', 'stop'], CLI_TIMEOUT_MS).catch(() => undefined)
  await waitUntil(
    'the Session Host to exit',
    HOST_EXIT_TIMEOUT_MS,
    async () => !hostRunning(app),
  ).catch(() => undefined)
  stopProcessesUnder(installPaths(app))
}

function createProject(directory: string) {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'README.md'), '# Bench project\n')
  return directory
}

async function proveFeatures(page: Page, cdpPort: number, sessionId: string) {
  const terminal = await proveTerminal(page, LAUNCH_TIMEOUT_MS)
  step('the terminal echoed')
  const preview = await proveBrowserPreview({
    page,
    cdpPort,
    sessionId,
    timeoutMs: LAUNCH_TIMEOUT_MS,
  })
  step('the Browser preview is a DevTools target')
  return { terminal, preview }
}

async function screenshot(page: Page, directory: string | undefined, name: string) {
  if (directory === undefined) return
  fs.mkdirSync(directory, { recursive: true })
  await page.screenshot({ path: path.join(directory, name) }).catch(() => undefined)
}

/** Copies the run's app and Host logs, which hold their startup timings, next to the results. */
function keepLogs(profile: ScratchProfile, directory: string | undefined, index: number) {
  const logs = path.join(profile.userData, 'logs')
  if (!directory || !fs.existsSync(logs)) return
  fs.cpSync(logs, path.join(directory, `run-${String(index)}`), { recursive: true })
}

export async function measureRun(input: {
  readonly app: InstalledElectronApp
  readonly root: string
  readonly index: number
  readonly prove: boolean
  readonly screenshots: string | undefined
  readonly logs: string | undefined
}) {
  const { app } = input
  const profile = createScratchProfile(path.join(input.root, `run-${String(input.index)}`))
  const provider = await startBenchFakeProvider()
  await configureFakeProvider(profile.piAgentDir, provider.baseUrl)
  try {
    const cold = await launch(app, profile)
    step(
      `run ${String(input.index)} cold: window ${String(cold.windowReadyMs)} ms, backend ${String(cold.backendReadyMs)} ms`,
    )
    let proof: unknown = null
    let coldSample: BenchRun['cold']
    let sessionId: string
    try {
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
      const idle = memory(app, cold)
      const run = await proveFakeProviderRun({
        cli: (args) => runAppCli(app, profile, args, CLI_TIMEOUT_MS),
        page: cold.page,
        project: createProject(path.join(profile.root, 'project')),
        model: FAKE_MODEL_REFERENCE,
        timeoutMs: LAUNCH_TIMEOUT_MS,
      })
      sessionId = run.sessionId
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
      const afterTurn = memory(app, cold)
      await screenshot(cold.page, input.screenshots, `run-${String(input.index)}-session.png`)
      if (input.prove) proof = await proveFeatures(cold.page, cold.started.cdpPort, run.sessionId)
      if (input.prove) await screenshot(cold.page, input.screenshots, 'terminal-and-preview.png')
      coldSample = {
        windowReadyMs: cold.windowReadyMs,
        backendReadyMs: cold.backendReadyMs,
        marks: marksAfterSpawn(cold.started),
        idle,
        afterTurn,
        runMs: run.runMs,
      }
    } finally {
      await stop(app, profile, cold)
    }
    const warm = await launch(app, profile)
    step(
      `run ${String(input.index)} warm: window ${String(warm.windowReadyMs)} ms, backend ${String(warm.backendReadyMs)} ms`,
    )
    try {
      // A second launch with the Session's link hands it to the running window (single instance).
      await runAppCli(app, profile, ['--', `openwaggle://sessions/${sessionId}`], CLI_TIMEOUT_MS)
      await waitUntil('the window to open the Session link', LAUNCH_TIMEOUT_MS, () =>
        warm.page.evaluate((id) => window.location.href.includes(id), sessionId),
      )
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
      const run: BenchRun = {
        cold: coldSample,
        warm: {
          windowReadyMs: warm.windowReadyMs,
          backendReadyMs: warm.backendReadyMs,
          marks: marksAfterSpawn(warm.started),
          idle: memory(app, warm),
        },
      }
      return { run, proof }
    } finally {
      await stop(app, profile, warm)
    }
  } finally {
    await provider.close()
    keepLogs(profile, input.logs, input.index)
  }
}
