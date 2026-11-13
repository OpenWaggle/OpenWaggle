/**
 * One A/B sample of a built OpenWaggle (scripts/perf-gate/ab-run.ts), on a new scratch profile:
 *
 * 1. a cold launch (new profile, empty compile cache) until the chat is ready;
 * 2. idle, then the resident memory of every app process by role (scripts/bench/app-processes.ts);
 * 3. one turn against a local fake provider through `openwaggle run`, shown in the window;
 * 4. idle, then memory again;
 * 5. quit, then a warm launch of the same profile until the chat is ready, and quit.
 */
import fs from 'node:fs'
import path from 'node:path'
import { configureFakeProvider, FAKE_MODEL_REFERENCE } from '../perf/lib/fake-openai-provider'
import { type AppMemory, listProcesses, sampleAppMemory } from '../bench/app-processes'
import { proveFakeProviderRun, startBenchFakeProvider, waitUntil } from '../bench/app-proof'
import {
  createScratchProfile,
  type InstalledElectronApp,
  runAppCli,
  type ScratchProfile,
  stopElectronApp,
  stopProcessesUnder,
} from '../bench/electron-installed-app'
import { type Launched, type LaunchTimings, launchUntilChatReady } from './ab-launch'

const CLI_TIMEOUT_MS = 180_000
const HOST_EXIT_TIMEOUT_MS = 15_000
const TURN_TIMEOUT_MS = 120_000

export interface MemorySample {
  readonly rssBytes: number
  readonly processCount: number
  readonly byRole: Readonly<Record<string, number>>
}

export interface AbSample {
  readonly build: string
  readonly order: number
  readonly cold: LaunchTimings
  readonly warm: LaunchTimings
  readonly idle: MemorySample
  readonly afterTurn: MemorySample
  readonly turnMs: number
}

function memory(app: InstalledElectronApp, launched: Launched) {
  const pid = launched.started.child.pid
  const sampled: AppMemory = sampleAppMemory({
    rootPids: pid === undefined ? [] : [pid],
    installPaths: [app.installRoot],
  })
  const byRole: Record<string, number> = {}
  for (const [role, total] of Object.entries(sampled.byRole)) byRole[role] = total.rssBytes
  return { rssBytes: sampled.rssBytes, processCount: sampled.processCount, byRole }
}

function hostRunning(app: InstalledElectronApp) {
  const root = app.installRoot.toLowerCase()
  return listProcesses().some(
    (row) =>
      row.command.includes('session-host-internal') && row.command.toLowerCase().includes(root),
  )
}

/** Quits the window, stops the Host and waits for it to exit, then kills what is left. */
async function stop(app: InstalledElectronApp, profile: ScratchProfile, launched: Launched) {
  launched.inspector.close()
  await launched.browser.close().catch(() => undefined)
  await stopElectronApp(launched.started)
  await runAppCli(app, profile, ['host', 'stop'], CLI_TIMEOUT_MS).catch(() => undefined)
  await waitUntil(
    'the Session Host to exit',
    HOST_EXIT_TIMEOUT_MS,
    async () => !hostRunning(app),
  ).catch(() => undefined)
  stopProcessesUnder([app.installRoot])
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Measures one sample of `app` in `root`; `idleMs` is the wait before each memory reading. */
export async function measureSample(input: {
  readonly app: InstalledElectronApp
  readonly build: string
  readonly order: number
  readonly root: string
  readonly idleMs: number
}) {
  const { app } = input
  const profile = createScratchProfile(
    path.join(input.root, `${String(input.order)}-${input.build}`),
  )
  const project = path.join(profile.root, 'project')
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, 'README.md'), '# Performance Gate project\n')
  const provider = await startBenchFakeProvider()
  await configureFakeProvider(profile.piAgentDir, provider.baseUrl)
  try {
    const cold = await launchUntilChatReady(app, profile)
    let idle: MemorySample
    let afterTurn: MemorySample
    let turnMs: number
    try {
      await delay(input.idleMs)
      idle = memory(app, cold)
      const turn = await proveFakeProviderRun({
        cli: (args) => runAppCli(app, profile, args, CLI_TIMEOUT_MS),
        page: cold.page,
        project,
        model: FAKE_MODEL_REFERENCE,
        timeoutMs: TURN_TIMEOUT_MS,
      })
      turnMs = turn.runMs
      await delay(input.idleMs)
      afterTurn = memory(app, cold)
    } finally {
      await stop(app, profile, cold)
    }
    const warm = await launchUntilChatReady(app, profile)
    await stop(app, profile, warm)
    return {
      build: input.build,
      order: input.order,
      cold: cold.timings,
      warm: warm.timings,
      idle,
      afterTurn,
      turnMs,
    }
  } finally {
    await provider.close()
    fs.rmSync(profile.root, { recursive: true, force: true })
  }
}
